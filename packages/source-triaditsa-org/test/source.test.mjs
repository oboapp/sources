import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { extractFeedItems } from "../dist/esm/extractors.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});
const xml = `<?xml version="1.0"?><rss><channel><item>
<title>Test Post &amp; Новини</title>
<link>https://triaditza.org/Test%2fPost/?x=1&amp;y=2</link>
<pubDate>Tue, 09 Jun 2026 11:13:10 +0000</pubDate>
<content:encoded><![CDATA[<h2>Заглавие</h2><p>Test <strong>content</strong>.</p><p>Материалът е публикуван за пръв път на Район Триадица.</p>]]></content:encoded>
</item></channel></rss>`;
const expectedIdentifier = "https://triaditza.org/Test%2fPost/?x=1&y=2";

test("preserves the historical RSS identifier and Markdown output without a detail request", async () => {
  const fetch = mock.fn(async () => new globalThis.Response(xml));
  globalThis.fetch = fetch;
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.equal(page.nextCursor, undefined);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].identifier, expectedIdentifier);
  assert.deepEqual(await source.fetchItem(page.items[0]), {
    title: "Test Post & Новини", datePublished: "2026-06-09T11:13:10.000Z",
    message: "## Заглавие\n\nTest **content**.",
  });
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(fetch.mock.calls[1].arguments[0], "https://triaditza.org/feed/?post_type=announcements");
  assert.equal(fetch.mock.calls[0].arguments[1].headers.Accept, "application/rss+xml, application/xml, text/xml, */*");
  assert.ok(fetch.mock.calls[0].arguments[0].startsWith("https://triaditza.org/category/"));
});

test("matches content captured from the legacy parser and document builder", async () => {
  const fixture = JSON.parse(await readFile(new globalThis.URL("./legacy-output.json", import.meta.url), "utf8"));
  globalThis.fetch = async () => new globalThis.Response(fixture.xml);
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  const actual = await Promise.all(page.items.map(async (item) => ({ identifier: item.identifier, ...await source.fetchItem(item) })));
  assert.deepEqual(actual, fixture.expected);
});

test("filters foreign hosts, invalid dates and malformed URLs as the legacy parser does", () => {
  for (const changed of [xml.replace("triaditza.org/Test", "example.com/Test"),
    xml.replace("Tue, 09 Jun 2026 11:13:10 +0000", "invalid"),
    xml.replace("https://triaditza.org/Test%2fPost/?x=1&amp;y=2", "invalid")]) {
    assert.deepEqual(extractFeedItems(changed), []);
  }
});

test("deduplicates repeated feed entries before returning candidates", async () => {
  const entry = /<item>[\s\S]*?<\/item>/.exec(xml)[0];
  globalThis.fetch = async () => new globalThis.Response(xml.replace("</channel>", `${entry}</channel>`));
  const source = await createSource({ locality: "bg.sofia" });
  assert.equal((await source.discoverItems()).items.length, 1);
});

test("rejects missing content rather than constructing a partial message", async () => {
  const source = await createSource({ locality: "bg.sofia" });
  for (const payload of [undefined, null, [], {}, { title: "T", date: "2026-01-01", contentHtml: "" }]) {
    await assert.rejects(source.fetchItem({ identifier: expectedIdentifier, payload }), /Missing feed content/);
  }
});

test("reports HTTP and non-feed responses instead of treating failures as empty feeds", async () => {
  const source = await createSource({ locality: "bg.sofia" });
  globalThis.fetch = async () => new globalThis.Response("unavailable", { status: 503 });
  await assert.rejects(source.discoverItems(), /503/);
  globalThis.fetch = async () => new globalThis.Response("<html>challenge</html>");
  await assert.rejects(source.discoverItems(), /does not look like RSS/);
});

test("supports CommonJS and preserves catalog metadata", async () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.equal(metadata.id, "triaditsa-org");
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
});


test("combines News and announcements while preserving document links and publication dates", async () => {
  const announcements = await readFile(new globalThis.URL("./announcements.xml", import.meta.url), "utf8");
  globalThis.fetch = async (url) => {
    return new globalThis.Response(url.includes("post_type=announcements") ? announcements : xml);
  };
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].identifier, expectedIdentifier);
  const notice = await source.fetchItem(page.items[1]);
  assert.equal(notice.datePublished, "2026-10-22T09:01:52.000Z");
  assert.match(notice.title, /68134\.1006\.1969/);
  assert.match(notice.message, /https:\/\/triaditza\.org\/wp-content\/uploads\/2026\/10\/САГ26-РА50-44-02\.10\.2026\.pdf/);
  assert.match(notice.message, /ПУП-ИПЗ\.pdf/);
  assert.doesNotMatch(notice.message, /публикуван за пръв път|fusion-body|@media/);
});

test("keeps the first occurrence when the feeds share a URL", async () => {
  globalThis.fetch = async (url) => {
    return new globalThis.Response(url.includes("post_type=announcements") ? xml.replace("Test <strong>content</strong>.", "Duplicate") : xml);
  };
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.equal(page.items.length, 1);
  assert.equal((await source.fetchItem(page.items[0])).message, "## Заглавие\n\nTest **content**.");
});

test("reports an announcements failure and retries both feeds on the next scan", async () => {
  globalThis.fetch = async (url) => {
    return url.includes("post_type=announcements")
      ? new globalThis.Response("unavailable", { status: 503 })
      : new globalThis.Response(xml);
  };
  const source = await createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), /503.*post_type=announcements/);
  globalThis.fetch = async () => new globalThis.Response(xml);
  assert.equal((await source.discoverItems()).items.length, 1);
});
