import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload, type JsonValue } from "@oboapp/source-sdk";
import {
  FacebookContentError,
  parseFacebookPost,
  readDiscoveryPayload,
  toDiscoveredItem,
  toSourceContent,
} from "../dist/esm/content.js";

const pageId = "1234567890";
const id = `${pageId}_9876543210`;
const message = "\n  Ремонт на ул. „Оборище“  \n\nВодата ще бъде спряна от 10:00 до 12:00 ч.\n";
const permalink = "https://www.facebook.com/AnotherPageNumber/posts/Case%2fPost?locale=bg_BG&value=%2f";
const rawPost = {
  id,
  message,
  created_time: "2026-11-06T11:30:00+03:00",
  updated_time: "2026-11-06T09:00:00+0000",
  permalink_url: permalink,
};
const photo = {
  type: "photo",
  target: { id: "4567890123" },
  url: "https://www.facebook.com/photo/?fbid=4567890123",
  media: {
    image: {
      src: "https://scontent.example.fbcdn.net/photo.jpg?signature=synthetic-private-value",
      width: 1080,
      height: 720,
    },
  },
};

test("normalizes Graph timestamps while preserving the original Bulgarian text and literal permalink", () => {
  const post = parseFacebookPost(rawPost, pageId);
  assert.deepEqual(post, {
    id,
    pageId,
    message,
    publishedAt: "2026-11-06T08:30:00.000Z",
    updatedAt: "2026-11-06T09:00:00.000Z",
    permalink,
    attachments: [],
    reviewReasons: [],
  });
  assert.deepEqual(toSourceContent(post), {
    title: "Ремонт на ул. „Оборище“",
    message,
    datePublished: "2026-11-06T08:30:00.000Z",
    deepLinkUrl: permalink,
  });
});

test("limits the title while keeping the full original notice", () => {
  const longMessage = `\n${"Ж".repeat(220)}\nСледващ ред`;
  const content = toSourceContent(parseFacebookPost({ ...rawPost, message: longMessage }, pageId));
  assert.equal(content.title, "Ж".repeat(180));
  assert.equal(content.message, longMessage);
});

test("keeps Unicode characters intact at the title boundary", () => {
  const original = `${"Ж".repeat(179)}\u{1F6A7}Още текст\rСледващ ред`;
  const content = toSourceContent(parseFacebookPost({ ...rawPost, message: original }, pageId));
  assert.equal(content.title, `${"Ж".repeat(179)}\u{1F6A7}`);
  assert.equal(content.message, original);
});

test("rejects malformed and foreign post identities with a controlled diagnostic", () => {
  for (const value of [null, {}, { id: "invalid-private-value" }, { id: "999_9876543210" }]) {
    assert.throws(() => {
      parseFacebookPost(value, pageId);
    }, (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "invalid_post_id");
      assert.equal(error.message.includes("private-value"), false);
      return true;
    });
  }
});

test("keeps posts with missing or malformed text available for review", () => {
  for (const invalidMessage of [undefined, null, 42, { private: "synthetic-value" }]) {
    const post = parseFacebookPost({ ...rawPost, message: invalidMessage }, pageId);
    assert.equal(post.id, id);
    assert.equal(post.message, undefined);
    assert.ok(post.reviewReasons.includes("missing_text"));
    if (invalidMessage !== undefined) {
      assert.ok(post.reviewReasons.includes("invalid_text"));
    }
    assert.throws(() => {
      toSourceContent(post);
    }, (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "missing_text");
      assert.equal(error.post?.id, id);
      assert.equal(error.post?.message, undefined);
      return true;
    });
  }
});

test("records media-only notices without treating an attachment title as original text", () => {
  const post = parseFacebookPost({
    ...rawPost,
    message: undefined,
    attachments: { data: [{ ...photo, title: "Изображение с текст" }] },
  }, pageId);
  assert.ok(post.reviewReasons.includes("media_only"));
  assert.deepEqual(post.attachments, [{
    type: "photo",
    id: "4567890123",
    url: "https://www.facebook.com/photo/?fbid=4567890123",
    width: 1080,
    height: 720,
  }]);
  assert.equal(JSON.stringify(post).includes("synthetic-private-value"), false);
});

test("keeps text notices usable when unsupported video attachments need review", () => {
  const post = parseFacebookPost({
    ...rawPost,
    attachments: { data: [{ type: "video_inline", target: { id: "555666777" } }] },
  }, pageId);
  assert.ok(post.reviewReasons.includes("unsupported_media"));
  assert.equal(toSourceContent(post).message, message);
});

test("retains usable text and flags malformed attachment details", () => {
  const post = parseFacebookPost({
    ...rawPost,
    attachments: {
      data: [{ ...photo, media: { image: { width: "invalid", height: -1 } } }],
    },
  }, pageId);
  assert.ok(post.reviewReasons.includes("incomplete_attachment"));
  assert.equal(post.attachments[0]?.width, undefined);
  assert.equal(post.attachments[0]?.height, undefined);
  assert.equal(toSourceContent(post).message, message);
});

test("flattens album references and flags incomplete attachment pagination", () => {
  for (const pagination of ["outer", "inner"]) {
    const post = parseFacebookPost({
      ...rawPost,
      attachments: {
        data: [{
          type: "album",
          target: { id: "111222333" },
          subattachments: {
            data: [photo],
            ...(pagination === "inner" ? { paging: { next: "https://graph.facebook.com/private-next" } } : {}),
          },
        }],
        ...(pagination === "outer" ? { paging: { next: "https://graph.facebook.com/private-next" } } : {}),
      },
    }, pageId);
    assert.equal(post.attachments.length, 2);
    assert.ok(post.reviewReasons.includes("incomplete_attachment"));
    assert.equal(JSON.stringify(post).includes("private-next"), false);
  }
});

test("omits CDN and unsafe attachment URLs but retains safe references", () => {
  for (const url of [
    "https://video.example.fbcdn.net/private.mp4",
    "https://example.fbsbx.com/private.jpg",
    "javascript:synthetic-private-value",
    "https://user:password@example.com/private",
  ]) {
    const post = parseFacebookPost({
      ...rawPost,
      attachments: { data: [{ type: "photo", target: { id: "111222333" }, url }] },
    }, pageId);
    assert.equal(post.attachments[0]?.url, undefined);
    assert.equal(post.attachments[0]?.id, "111222333");
    assert.equal(JSON.stringify(post).includes(url), false);
  }
});

test("strips credential parameters from public references", () => {
  const post = parseFacebookPost({
    ...rawPost,
    permalink_url: "https://www.facebook.com/permalink.php?story_fbid=123&id=456&access_token=synthetic-secret#token=synthetic-secret",
    attachments: {
      data: [{ type: "link", url: "https://example.com/notice?appsecret_proof=synthetic-proof&lang=bg" }],
    },
  }, pageId);
  assert.equal(new URL(post.permalink ?? "").searchParams.has("access_token"), false);
  assert.equal(new URL(post.permalink ?? "").hash, "");
  assert.equal(post.attachments[0]?.url, "https://example.com/notice?lang=bg");
  assert.equal(JSON.stringify(post).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(post).includes("synthetic-proof"), false);
});

test("requires a valid publication time without substituting an update time", () => {
  for (const created_time of [undefined, "invalid", "2026-02-31T10:00:00Z", "2026-11-06"]) {
    const post = parseFacebookPost({ ...rawPost, created_time }, pageId);
    assert.equal(post.publishedAt, undefined);
    assert.equal(post.updatedAt, "2026-11-06T09:00:00.000Z");
    assert.throws(() => {
      toSourceContent(post);
    }, (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "missing_publication_time");
      assert.equal(error.post?.message, undefined);
      return true;
    });
  }
});

test("requires a Facebook permalink and never constructs one from the configured Page ID", () => {
  for (const permalink_url of [undefined, "invalid", "https://facebook.com.example.com/post", "javascript:alert(1)"]) {
    const post = parseFacebookPost({ ...rawPost, permalink_url }, pageId);
    assert.equal(post.permalink, undefined);
    assert.throws(() => {
      toSourceContent(post);
    }, (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "missing_permalink");
      return true;
    });
  }
});

test("transfers normalized content through a versioned bounded discovery payload", () => {
  const post = parseFacebookPost(rawPost, pageId);
  const item = toDiscoveredItem(post);
  assert.equal(item.identifier, `facebook:${pageId}:${id}`);
  assert.equal(item.observedAt, "2026-11-06T09:00:00.000Z");
  assert.ok(item.payload);
  assert.deepEqual(item.payload, { kind: "facebook-page-post", version: 1, post });
  assert.ok(Buffer.byteLength(serializeDiscoveryPayload(item.payload), "utf8") < MAX_DISCOVERY_PAYLOAD_BYTES);
  assert.deepEqual(readDiscoveryPayload(item, pageId), post);
  assert.deepEqual(toSourceContent(readDiscoveryPayload(item, pageId) ?? post), toSourceContent(post));
});

test("omits oversized UTF-8 payloads without truncating the original message", () => {
  const original = "Ж".repeat(MAX_DISCOVERY_PAYLOAD_BYTES / 2 + 1);
  const post = parseFacebookPost({ ...rawPost, message: original }, pageId);
  const item = toDiscoveredItem(post);
  assert.equal(item.identifier, `facebook:${pageId}:${id}`);
  assert.equal(item.payload, undefined);
  assert.equal(readDiscoveryPayload(item, pageId), undefined);
  assert.equal(toSourceContent(post).message, original);
});

test("omits observedAt when no valid update timestamp is available", () => {
  const post = parseFacebookPost({ ...rawPost, updated_time: "invalid" }, pageId);
  assert.equal(toDiscoveredItem(post).observedAt, undefined);
  assert.ok(post.reviewReasons.includes("invalid_update_time"));
});

test("rejects cross-Page and mismatched discovery identities", () => {
  const item = toDiscoveredItem(parseFacebookPost(rawPost, pageId));
  for (const invalidItem of [
    { ...item, identifier: `facebook:${pageId}:wrong` },
    { ...item, identifier: `facebook:999:${id}` },
  ]) {
    assert.throws(() => {
      readDiscoveryPayload(invalidItem, pageId);
    }, FacebookContentError);
  }
  assert.throws(() => {
    readDiscoveryPayload(item, "999");
  }, FacebookContentError);
});

test("rejects unknown payload versions, markers, fields, and malformed normalized values", () => {
  const post = {
    id,
    pageId,
    message,
    publishedAt: "2026-11-06T08:30:00.000Z",
    updatedAt: "2026-11-06T09:00:00.000Z",
    permalink,
    attachments: [],
    reviewReasons: [],
  };
  const payloads: JsonValue[] = [
    { kind: "facebook-page-post", version: 2, post: { ...post } },
    { kind: "other-source", version: 1, post: { ...post } },
    { kind: "facebook-page-post", version: 1, post: { ...post }, unexpected: true },
    { kind: "facebook-page-post", version: 1, post: { ...post, message: 42 } },
    { kind: "facebook-page-post", version: 1, post: { ...post, publishedAt: "2026-11-06T08:30:00+0000" } },
    { kind: "facebook-page-post", version: 1, post: { ...post, attachments: [{ url: "https://example.com/?access_token=synthetic-secret" }] } },
    { kind: "facebook-page-post", version: 1, post: { ...post, reviewReasons: ["synthetic-private-reason"] } },
  ];
  for (const payload of payloads) {
    assert.throws(() => {
      readDiscoveryPayload({ identifier: `facebook:${pageId}:${id}`, payload }, pageId);
    }, (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "invalid_payload");
      assert.equal(error.message.includes("synthetic"), false);
      return true;
    });
  }
});
