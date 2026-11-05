import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Browser } from "playwright";
import { Window } from "happy-dom";
import { createHybridSource } from "../dist/esm/hybrid.js";
import { extractFeedItems } from "../dist/esm/extractors.js";
import { metadata } from "../dist/esm/metadata.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

const xml = `<rss><channel><item>
<title>Feed &amp; title</title>
<link>https://so-slatina.org/Test%2fPost/?x=1&amp;y=2</link>
<pubDate>Tue, 09 Jun 2026 11:13:10 +0000</pubDate>
<description><![CDATA[Feed body]]></description>
</item></channel></rss>`;
const identifier = "https://so-slatina.org/Test%2fPost/?x=1&y=2";

function browserFixture(html: string, failNavigation = false) {
  const window = new Window();
  window.document.write(html);
  const originalDocument = globalThis.document;
  const originalElement = globalThis.HTMLElement;
  const closePage = mock.fn(async () => {});
  const closeBrowser = mock.fn(async () => {});
  const route = mock.fn(async () => {});
  const goto = mock.fn(async (...args: unknown[]) => {
    void args;
    if (failNavigation) {
      throw new Error("Navigation failed");
    }
  });
  const page = {
    route,
    goto,
    close: closePage,
    evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => {
      Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
      try {
        return callback(arg);
      } finally {
        Object.assign(globalThis, { document: originalDocument, HTMLElement: originalElement });
      }
    },
  };
  const newPage = mock.fn(async () => page);
  return { browser: { newPage, close: closeBrowser } as unknown as Browser, closePage, closeBrowser, route, goto, newPage };
}

test("preserves identifiers and converts cleaned page content with RSS date", async () => {
  const fetchFeed = mock.fn<typeof globalThis.fetch>(async () => new Response(xml));
  globalThis.fetch = fetchFeed;
  const fixture = browserFixture(`
    <h1>Other title</h1>
    <div class="blog-heading"><h1>Page title</h1></div>
    <div id="content"><article><div class="item-content">
      <p>Hello <strong>world</strong>.</p>
      <nav>Navigation</nav><div class="sharedaddy">Share</div>
      <div class="post-views">Views</div><div class="blog-meta">Metadata</div>
      <script>bad()</script>
    </div></article></div>
  `);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {});
  const source = createHybridSource({ launchBrowser, delay });
  const page = await source.discoverItems();
  assert.equal(launchBrowser.mock.callCount(), 0);
  assert.equal(page.items[0]?.identifier, identifier);
  assert.equal(fetchFeed.mock.calls[0]?.arguments[0], "https://so-slatina.org/feed/");
  assert.equal(
    new Headers(fetchFeed.mock.calls[0]?.arguments[1]?.headers).get("Accept"),
    "application/rss+xml, application/xml, text/xml, */*",
  );
  assert.deepEqual(await source.fetchItem(page.items[0]!), {
    title: "Page title",
    datePublished: "2026-06-09T11:13:10.000Z",
    message: "Hello **world**.",
  });
  assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
  assert.equal(delay.mock.callCount(), 1);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("uses the feed title if the page has none and reuses the browser", async () => {
  globalThis.fetch = async () => new Response(xml);
  const fixture = browserFixture('<div id="content"><article><div class="item-content"><p>Body</p></div></article></div>');
  const launchBrowser = mock.fn(async () => fixture.browser);
  const source = createHybridSource({ launchBrowser, delay: async () => {} });
  const item = (await source.discoverItems()).items[0]!;
  assert.equal((await source.fetchItem(item)).title, "Feed & title");
  await source.fetchItem(item);
  assert.equal(launchBrowser.mock.callCount(), 1);
  await source.close?.();
});

test("closes failed pages and reports missing content without falling back to the feed body", async () => {
  globalThis.fetch = async () => new Response(xml);
  for (const fixture of [browserFixture("<h1>Title</h1>"), browserFixture("", true)]) {
    const source = createHybridSource({ launchBrowser: async () => fixture.browser, delay: async () => {} });
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item));
    assert.equal(fixture.closePage.mock.callCount(), 1);
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("deduplicates and filters the feed using legacy URL and date rules", async () => {
  const entry = /<item>[\s\S]*?<\/item>/.exec(xml)?.[0];
  globalThis.fetch = async () => new Response(xml.replace("</channel>", `${entry}</channel>`));
  const source = createHybridSource();
  assert.equal((await source.discoverItems()).items.length, 1);
  assert.equal(extractFeedItems(xml)[0]?.contentHtml, undefined);
  for (const changed of [xml.replace("so-slatina.org/Test", "example.com/Test"), xml.replace("Tue, 09 Jun 2026 11:13:10 +0000", "invalid")]) {
    assert.deepEqual(extractFeedItems(changed), []);
  }
});

test("rejects missing feed metadata before launching a browser", async () => {
  const launchBrowser = mock.fn(async () => browserFixture("").browser);
  const source = createHybridSource({
    launchBrowser,
    delay: async () => {},
  });

  await assert.rejects(
    source.fetchItem({ identifier, payload: { title: "Title" } }),
    /Missing feed metadata/,
  );
  assert.equal(launchBrowser.mock.callCount(), 0);
});

test("propagates feed failures and exposes isolated CommonJS metadata", async () => {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const source = createHybridSource();
  await assert.rejects(source.discoverItems(), /503/);
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.equal(metadata.id, "so-slatina-org");
  assert.equal(metadata.url, "https://so-slatina.org/");
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
});
