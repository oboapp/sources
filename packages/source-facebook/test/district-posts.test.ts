import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { configure, FacebookContentError } from "../dist/esm/index.js";
import { readDiscoveryPayload } from "../dist/esm/content.js";

interface DistrictPostFixture {
  key: string;
  district: "oborishte" | "studentski";
  pageUrl: string;
  postUrl: string | null;
  publishedAt: null;
  media: "unknown";
  message: string;
  reviewNotes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFixture(value: unknown): value is DistrictPostFixture {
  return isRecord(value) && typeof value.key === "string" &&
    (value.district === "oborishte" || value.district === "studentski") &&
    typeof value.pageUrl === "string" &&
    (typeof value.postUrl === "string" || value.postUrl === null) &&
    value.publishedAt === null && value.media === "unknown" &&
    typeof value.message === "string" && Array.isArray(value.reviewNotes) &&
    value.reviewNotes.every((note: unknown) => {
      return typeof note === "string";
    });
}

function loadFixtures(): DistrictPostFixture[] {
  const value: unknown = JSON.parse(readFileSync(new URL("./fixtures/district-posts.json", import.meta.url), "utf8"));
  if (!Array.isArray(value) || !value.every(isFixture)) {
    throw new Error("District fixtures must declare copied text and unknown provider metadata");
  }
  return value;
}

const fixtures = loadFixtures();
const modeledPublicationTime = "2026-11-01T12:00:00+0200";

function replay(entries: DistrictPostFixture[], includeModeledPublication = false) {
  const first = entries[0];
  assert.ok(first);
  assert.ok(entries.every((entry) => {
    return entry.district === first.district;
  }));
  const pageId = first.district === "oborishte" ? "101" : "202";
  let requests = 0;
  // Only text and known permalinks are copied. Provider IDs and timestamps below are modeled.
  const fetch: typeof globalThis.fetch = async (input) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.pathname, `/v25.0/${pageId}/published_posts`);
    assert.equal(url.searchParams.has("since"), false);
    return new Response(JSON.stringify({ data: entries.map((entry, index) => {
      return {
        id: `${pageId}_${index + 1}`,
        message: entry.message,
        ...(entry.postUrl === null ? {} : { permalink_url: entry.postUrl }),
        ...(includeModeledPublication ? { created_time: modeledPublicationTime } : {}),
      };
    }) }));
  };
  const configured = configure({
    id: `${first.district}-copied-text-replay`,
    name: `${first.district} fixture replay`,
    pageId,
    url: first.pageUrl,
    localities: ["bg.sofia"],
    apiVersion: "v25.0",
    lookbackDays: 0,
    getAccessToken: () => "synthetic-district-fixture-token",
  }, { fetch, now: () => new Date("2026-11-06T10:00:00.000Z") });
  return { configured, pageId, requestCount: () => requests };
}

test("copied district fixtures keep unknown publication dates and missing post links explicit", () => {
  assert.equal(fixtures.length, 6);
  assert.deepEqual(fixtures.map((entry) => entry.key), [
    "oborishte-city-ideas", "oborishte-completed-cleanup", "oborishte-school-opening",
    "studentski-waste-collection", "studentski-election-turnout", "studentski-heating-outage",
  ]);
  assert.equal(fixtures.filter((entry) => entry.postUrl !== null).length, 4);
  assert.deepEqual(fixtures.filter((entry) => entry.postUrl === null).map((entry) => entry.key), [
    "oborishte-completed-cleanup", "studentski-heating-outage",
  ]);
});

test("discovers all six copied notices unchanged for downstream relevance and date processing", async () => {
  for (const district of ["oborishte", "studentski"]) {
    const entries = fixtures.filter((entry) => entry.district === district);
    const runtime = replay(entries);
    const source = runtime.configured.createSource({ locality: "bg.sofia" });
    const page = await source.discoverItems();
    assert.equal(page.items.length, entries.length);
    for (const [index, item] of page.items.entries()) {
      const post = readDiscoveryPayload(item, runtime.pageId);
      assert.ok(post);
      assert.equal(item.identifier, `facebook:${runtime.pageId}:${runtime.pageId}_${index + 1}`);
      assert.equal(post.message, entries[index]?.message);
      assert.equal(post.publishedAt, undefined);
      assert.ok(post.reviewReasons.includes("missing_publication_time"));
    }
    assert.equal(runtime.requestCount(), 1);
    await source.close?.();
  }
});

test("never infers publication time from event dates inside copied notice text", async () => {
  for (const fixture of fixtures) {
    const runtime = replay([fixture]);
    const source = runtime.configured.createSource({ locality: "bg.sofia" });
    const item = (await source.discoverItems()).items[0];
    assert.ok(item);
    await assert.rejects(source.fetchItem(item), (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "missing_publication_time", fixture.key);
      assert.equal(error.post?.publishedAt, undefined);
      return true;
    });
    assert.equal(runtime.requestCount(), 1);
    await source.close?.();
  }
});

test("maps four known permalinks with explicitly modeled provider timestamps through a fresh instance", async () => {
  for (const fixture of fixtures.filter((entry) => entry.postUrl !== null)) {
    const runtime = replay([fixture], true);
    const first = runtime.configured.createSource({ locality: "bg.sofia" });
    const item = (await first.discoverItems()).items[0];
    assert.ok(item);
    await first.close?.();
    const second = runtime.configured.createSource({ locality: "bg.sofia" });
    const content = await second.fetchItem(item);
    const firstLine = fixture.message.split(/\r\n?|\n/).find((line) => line.trim())?.trim();
    assert.ok(firstLine);
    assert.equal(content.title, Array.from(firstLine).slice(0, 180).join(""));
    assert.equal(content.message, fixture.message);
    assert.equal(content.deepLinkUrl, fixture.postUrl);
    assert.equal(content.datePublished, "2026-11-01T10:00:00.000Z");
    assert.equal(content.categories, undefined);
    assert.equal(content.isRelevant, undefined);
    assert.equal(content.timespanStart, undefined);
    assert.equal(content.timespanEnd, undefined);
    assert.equal(runtime.requestCount(), 1);
    await second.close?.();
  }
});

test("requires post permalinks for cleanup and heating notices instead of substituting Page URLs", async () => {
  for (const fixture of fixtures.filter((entry) => entry.postUrl === null)) {
    const runtime = replay([fixture], true);
    const source = runtime.configured.createSource({ locality: "bg.sofia" });
    const item = (await source.discoverItems()).items[0];
    assert.ok(item);
    await assert.rejects(source.fetchItem(item), (error: unknown) => {
      assert.ok(error instanceof FacebookContentError);
      assert.equal(error.code, "missing_permalink", fixture.key);
      assert.equal(error.post?.permalink, undefined);
      return true;
    });
    assert.equal(runtime.requestCount(), 1);
    await source.close?.();
  }
});

test("preserves the heating notice's conflicting headline and body dates for later review", async () => {
  const fixture = fixtures.find((entry) => entry.key === "studentski-heating-outage");
  assert.ok(fixture);
  const runtime = replay([fixture]);
  const source = runtime.configured.createSource({ locality: "bg.sofia" });
  const item = (await source.discoverItems()).items[0];
  assert.ok(item);
  const post = readDiscoveryPayload(item, runtime.pageId);
  assert.ok(post);
  assert.equal(post.message, fixture.message);
  assert.ok(post.message?.split("\n")[0]?.includes("до 7 ноември"));
  assert.ok(post.message?.includes("до 20:00 ч. на 8 ноември 2026 г."));
  assert.equal(post.publishedAt, undefined);
  await source.close?.();
});
