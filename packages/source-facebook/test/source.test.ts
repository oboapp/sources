import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { CreateSource, DiscoveredItem } from "@oboapp/source-sdk";
import facebook, { configure, FacebookApiError, FacebookContentError } from "../dist/esm/index.js";
import { createFacebookMetadata } from "../dist/esm/metadata.js";

const now = new Date("2026-11-06T10:00:00.000Z");
const options = {
  id: "oborishte-facebook",
  name: 'Район "Оборище" (Facebook)',
  pageId: "101",
  localities: ["bg.sofia"],
  apiVersion: "v25.0",
  getAccessToken: () => "synthetic-token-oborishte",
};

function post(pageId = "101", postId = "1") {
  return {
    id: `${pageId}_${postId}`,
    message: "Временно затваряне на ул. Оборище.\nДвижението се възстановява в 18:00 ч.",
    created_time: "2026-11-05T12:00:00+0200",
    updated_time: "2026-11-05T13:00:00+02:00",
    permalink_url: `https://www.facebook.com/999/posts/${postId}?substory_index=123`,
  };
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

function queueFetch(responses: Response[]) {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    const response = responses.shift();
    assert.ok(response, "Unexpected HTTP request");
    return response;
  };
  return { fetch, requests, now: () => now };
}

test("exposes independent configured source factories through the requested default API", async () => {
  let tokenReads = 0;
  const firstRuntime = queueFetch([json({ data: [post()] })]);
  const secondRuntime = queueFetch([json({ data: [post("202")] })]);
  const first = facebook.configure({ ...options, getAccessToken: () => {
    tokenReads++;
    return "synthetic-token-oborishte";
  } }, firstRuntime);
  const second = facebook.configure({
    ...options,
    id: "studentski-facebook",
    name: 'Район "Студентски" (Facebook)',
    pageId: "202",
    getAccessToken: () => "synthetic-token-studentski",
  }, secondRuntime);
  assert.equal(tokenReads, 0);
  const sdkFactory: CreateSource = first.createSource;
  const firstSource = await sdkFactory({ locality: "bg.sofia" });
  const secondSource = second.createSource({ locality: "bg.sofia" });
  assert.equal(tokenReads, 0);
  const firstPage = await firstSource.discoverItems();
  const secondPage = await secondSource.discoverItems();
  assert.equal(firstPage.items[0]?.identifier, "facebook:101:101_1");
  assert.equal(secondPage.items[0]?.identifier, "facebook:202:202_1");
  assert.equal(first.metadata.id, "oborishte-facebook");
  assert.equal(second.metadata.id, "studentski-facebook");
  assert.equal(firstRuntime.requests[0]?.url.pathname, "/v25.0/101/published_posts");
  assert.equal(secondRuntime.requests[0]?.url.pathname, "/v25.0/202/published_posts");
  assert.equal(new Headers(firstRuntime.requests[0]?.init?.headers).get("Authorization"), "Bearer synthetic-token-oborishte");
  assert.equal(new Headers(secondRuntime.requests[0]?.init?.headers).get("Authorization"), "Bearer synthetic-token-studentski");
  await firstSource.close?.();
  await secondSource.close?.();
});

test("hands a bounded listing item to a fresh source instance without another HTTP request", async () => {
  const runtime = queueFetch([json({ data: [post()] })]);
  const configured = configure(options, runtime);
  const first = configured.createSource({ locality: "bg.sofia" });
  const page = await first.discoverItems();
  const item = page.items[0];
  assert.ok(item);
  const copied: DiscoveredItem = JSON.parse(JSON.stringify(item));
  await first.close?.();
  const second = configured.createSource({ locality: "bg.sofia" });
  assert.deepEqual(await second.fetchItem(copied), {
    title: "Временно затваряне на ул. Оборище.",
    message: post().message,
    datePublished: "2026-11-05T10:00:00.000Z",
    deepLinkUrl: post().permalink_url,
  });
  assert.equal(item.observedAt, "2026-11-05T11:00:00.000Z");
  assert.equal(runtime.requests.length, 1);
  await second.close?.();
});

test("returns one provider page per discovery and terminates on absent next even with a cursor", async () => {
  const runtime = queueFetch([
    json({ data: [post()], paging: {
      next: "https://untrusted.example/collect?access_token=never-copy",
      cursors: { after: "next-page" },
    } }),
    json({ data: [post("101", "2")], paging: { cursors: { after: "terminal" } } }),
  ]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  const first = await source.discoverItems();
  assert.equal(runtime.requests.length, 1);
  assert.equal(first.nextCursor, "next-page");
  const second = await source.discoverItems(first.nextCursor);
  assert.equal(second.nextCursor, undefined);
  assert.equal(runtime.requests[1]?.url.hostname, "graph.facebook.com");
  assert.equal(runtime.requests[1]?.url.searchParams.get("after"), "next-page");
  assert.equal(runtime.requests[1]?.url.searchParams.has("access_token"), false);
  assert.equal(JSON.stringify(first).includes("never-copy"), false);
  await source.close?.();
});

test("uses a fixed seven-day scan window and supports disabling its date filter", async () => {
  let currentTime = now;
  const runtime = queueFetch([
    json({ data: [], paging: { next: "present", cursors: { after: "next-page" } } }),
    json({ data: [] }),
    json({ data: [] }),
  ]);
  const source = configure(options, { ...runtime, now: () => currentTime }).createSource({ locality: "bg.sofia" });
  await source.discoverItems();
  currentTime = new Date("2026-11-07T10:00:00.000Z");
  await source.discoverItems("next-page");
  const expectedSince = String(now.getTime() / 1000 - 7 * 86400);
  assert.equal(runtime.requests[0]?.url.searchParams.get("since"), expectedSince);
  assert.equal(runtime.requests[1]?.url.searchParams.get("since"), expectedSince);
  assert.equal(runtime.requests[0]?.url.searchParams.get("limit"), "25");
  const unfiltered = configure({ ...options, lookbackDays: 0 }, runtime).createSource({ locality: "bg.sofia" });
  await unfiltered.discoverItems();
  assert.equal(runtime.requests[2]?.url.searchParams.has("since"), false);
  await source.close?.();
  await unfiltered.close?.();
});

test("refetches oversized listing content by provider identity without truncating text", async () => {
  const longPost = { ...post(), message: "Съобщение ".repeat(40000) };
  const runtime = queueFetch([json({ data: [longPost] }), json(longPost)]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  const item = page.items[0];
  assert.ok(item);
  assert.equal(item.payload, undefined);
  assert.equal((await source.fetchItem(item)).message, longPost.message);
  assert.equal(runtime.requests[1]?.url.pathname, "/v25.0/101_1");
  await source.close?.();
});

test("discovers textless photos and returns a typed content failure for caller review", async () => {
  const runtime = queueFetch([json({ data: [{
    ...post(),
    message: undefined,
    attachments: { data: [{ type: "photo", target: { id: "42", url: "https://www.facebook.com/photo.php?fbid=42" } }] },
  }] })]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.equal(page.items.length, 1);
  const item = page.items[0];
  assert.ok(item);
  await assert.rejects(source.fetchItem(item), (error: unknown) => {
    assert.ok(error instanceof FacebookContentError);
    assert.equal(error.code, "missing_text");
    assert.equal(error.post?.attachments[0]?.id, "42");
    return true;
  });
  await source.close?.();
});

test("rejects a detail response for a different post on the same Page", async () => {
  const runtime = queueFetch([json(post("101", "2"))]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  await assert.rejects(source.fetchItem({ identifier: "facebook:101:101_1" }), (error: unknown) => {
    assert.ok(error instanceof FacebookApiError);
    assert.equal(error.code, "invalid_post_id");
    return true;
  });
  await source.close?.();
});

test("fails authorization without leaking provider error text or retrying", async () => {
  const runtime = queueFetch([json({ error: { code: 190, message: "provider-secret-do-not-log" } })]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), (error: unknown) => {
    assert.ok(error instanceof FacebookApiError);
    assert.equal(error.code, "authorization");
    assert.equal(error.graphCode, 190);
    assert.equal(String(error).includes("provider-secret"), false);
    return true;
  });
  assert.equal(runtime.requests.length, 1);
  await source.close?.();
});

test("retries provider rate limits with bounded backoff", async () => {
  const runtime = queueFetch([
    json({ error: { code: 4 } }, 429),
    json({ error: { code: 17 } }),
    json({ data: [post()] }),
  ]);
  const delays: number[] = [];
  const source = configure(options, { ...runtime, sleep: async (milliseconds) => {
    delays.push(milliseconds);
  } }).createSource({ locality: "bg.sofia" });
  assert.equal((await source.discoverItems()).items.length, 1);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(runtime.requests.length, 3);
  await source.close?.();
});

test("respects long Retry-After delays by failing for a later scheduled run", async () => {
  const runtime = queueFetch([json({}, 429, { "Retry-After": "60" })]);
  const source = configure(options, runtime).createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), (error: unknown) => {
    assert.ok(error instanceof FacebookApiError);
    assert.equal(error.code, "retry_after");
    return true;
  });
  assert.equal(runtime.requests.length, 1);
  await source.close?.();
});

test("captures configuration values so caller mutations cannot switch Pages", async () => {
  const mutable = { ...options, localities: ["bg.sofia"] };
  const runtime = queueFetch([json({ data: [post()] })]);
  const configured = configure(mutable, runtime);
  mutable.pageId = "202";
  mutable.localities[0] = "bg.plovdiv";
  mutable.getAccessToken = () => "different-token";
  const source = configured.createSource({ locality: "bg.sofia" });
  await source.discoverItems();
  assert.equal(configured.metadata.localities[0], "bg.sofia");
  assert.equal(runtime.requests[0]?.url.pathname, "/v25.0/101/published_posts");
  assert.equal(new Headers(runtime.requests[0]?.init?.headers).get("Authorization"), "Bearer synthetic-token-oborishte");
  await source.close?.();
});

test("honors caller cancellation and close without issuing further requests", async () => {
  const runtime = queueFetch([json({ data: [post()] })]);
  const controller = new AbortController();
  const source = configure(options, runtime).createSource({ locality: "bg.sofia", signal: controller.signal });
  const page = await source.discoverItems();
  controller.abort();
  const item = page.items[0];
  assert.ok(item);
  await assert.rejects(source.fetchItem(item), FacebookApiError);
  await assert.rejects(source.discoverItems(), FacebookApiError);
  const closed = configure(options, runtime).createSource({ locality: "bg.sofia" });
  await closed.close?.();
  await assert.rejects(closed.discoverItems(), FacebookApiError);
  assert.equal(runtime.requests.length, 1);
});

test("rejects unsupported localities and invalid public configuration", () => {
  assert.throws(() => configure(options).createSource({ locality: "bg.plovdiv" }), /locality/);
  assert.throws(() => configure({ ...options, pageId: "https://example.com" }), /metadata/);
  assert.throws(() => configure({ ...options, pageSize: 101 }), /configuration/);
  assert.throws(() => configure({ ...options, apiVersion: "latest" }), /configuration/);
  assert.throws(() => createFacebookMetadata({ ...options, url: "https://example.com" }), /Page URL/);
});

test("ships both module formats and a runtime-free metadata entrypoint", () => {
  const require = createRequire(import.meta.url);
  const commonjs = require("../dist/cjs/index.js");
  assert.equal(typeof commonjs.configure, "function");
  assert.equal(typeof commonjs.default.configure, "function");
  const metadata = createFacebookMetadata(options);
  assert.equal(metadata.url, "https://www.facebook.com/101");
  assert.equal("getAccessToken" in metadata, false);
  const metadataCode = readFileSync(new URL("../dist/esm/metadata.js", import.meta.url), "utf8");
  assert.doesNotMatch(metadataCode, /(?:import\s|node:|process\.|getAccessToken|graph\.js)/);
});
