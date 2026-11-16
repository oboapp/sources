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
<link>https://rayon-oborishte.bg/Test%2fPost/?x=1&amp;y=2</link>
<pubDate>Tue, 09 Jun 2026 11:13:10 +0000</pubDate>
<description><![CDATA[Feed body]]></description>
</item></channel></rss>`;
const identifier = "https://rayon-oborishte.bg/Test%2fPost/?x=1&y=2";
const noticesFeedUrl =
  "https://rayon-oborishte.bg/feed/";

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

test("uses the root feed when it is available", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === noticesFeedUrl) {
      return new Response(xml);
    }
    return new Response("Unsupported Media Type", { status: 415 });
  };
  const fixture = browserFixture("");
  const launchBrowser = mock.fn(async () => fixture.browser);
  const source = createHybridSource({ launchBrowser, delay: async () => {} });

  assert.deepEqual(await source.discoverItems(), {
    items: [{
      identifier,
      payload: { title: "Feed & title", date: "2026-06-09T11:13:10.000Z" },
    }],
  });
  assert.deepEqual(requestedUrls, [noticesFeedUrl]);
  assert.equal(launchBrowser.mock.callCount(), 0);
  await source.close?.();
});

test("preserves identifiers and converts cleaned page content with RSS date", async () => {
  globalThis.fetch = async () => new Response(xml);
  const fixture = browserFixture('<h1>Page title</h1><article><p>Hello <strong>world</strong>.</p><nav>Navigation</nav><div class="sharedaddy">Share</div><script>bad()</script></article>');
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {});
  const source = createHybridSource({ launchBrowser, delay });
  const page = await source.discoverItems();
  assert.equal(launchBrowser.mock.callCount(), 0);
  assert.equal(page.items[0]?.identifier, identifier);
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
  const fixture = browserFixture("<article><p>Body</p></article>");
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
  for (const changed of [xml.replace("rayon-oborishte.bg/Test", "example.com/Test"), xml.replace("Tue, 09 Jun 2026 11:13:10 +0000", "invalid")]) {
    assert.deepEqual(extractFeedItems(changed), []);
  }
});

test("reports RSS and API HTTP failures before launching the browser", async () => {
  for (const status of [404, 503]) {
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return new Response("unavailable", { status });
    };
    const fixture = browserFixture("");
    const launchBrowser = mock.fn(async () => fixture.browser);
    const source = createHybridSource({ launchBrowser, delay: async () => {} });

    await assert.rejects(source.discoverItems(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`RSS feed returned ${status} for ${noticesFeedUrl}`));
      assert.ok(error.message.includes(`WordPress posts API returned ${status}`));
      return true;
    });
    assert.equal(requestedUrls[0], noticesFeedUrl);
    assert.equal(requestedUrls.length, 2);
    assert.equal(launchBrowser.mock.callCount(), 0);
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 0);
  }
});

test("exposes isolated CommonJS metadata", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.equal(metadata.id, "rayon-oborishte-bg");
  assert.equal(metadata.url, "https://rayon-oborishte.bg/");
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
});
