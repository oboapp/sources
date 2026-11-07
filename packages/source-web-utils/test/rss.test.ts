import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import {
  fetchFeedXml,
  parseRssFeedItems,
  RssFeedHttpError,
  stripWordPressFeedAttribution,
} from "../dist/esm/rss.js";

const originalFetch = globalThis.fetch;
const url = "https://example.com/Feed%2fPost/?x=1&y=2#section";
const date = "Tue, 09 Jun 2026 11:13:10 +0300";

function feed(item: string): string {
  return `<rss><channel><item>${item}</item></channel></rss>`;
}

const item = `<title><![CDATA[Road &amp; water]]></title>
  <link>https://example.com/Feed%2fPost/?x=1&amp;y=2#section</link>
  <pubDate>${date}</pubDate>`;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("retains URL escape spelling, query and fragment while decoding feed entities", () => {
  assert.deepEqual(parseRssFeedItems(feed(item), { hostname: "example.com" }), [{
    url,
    title: "Road & water",
    date: "2026-06-09T08:13:10.000Z",
    contentHtml: undefined,
  }]);
});

test("filters missing and invalid fields without losing later valid entries", () => {
  const invalid = [
    item.replace("Road &amp; water", ""),
    item.replace(/<link>[\s\S]*?<\/link>/, ""),
    item.replace("https://example.com/Feed%2fPost/?x=1&amp;y=2#section", "not a URL"),
    item.replace("example.com", "other.example.com"),
    item.replace(date, "invalid date"),
    item.replace(/<pubDate>[\s\S]*?<\/pubDate>/, ""),
  ];
  const xml = `<rss><channel>${invalid.map((value) => `<item>${value}</item>`).join("")}
    <item>${item}</item></channel></rss>`;
  assert.equal(parseRssFeedItems(xml, { hostname: "example.com" }).length, 1);
  assert.equal(parseRssFeedItems(xml, { hostname: "example.com" })[0]?.url, url);
});

test("supports configured tags, content transforms and explicit query removal", () => {
  const xml = feed(`<headline>Repairs</headline><source.link>${url}</source.link>
    <published>${date}</published><content:encoded><![CDATA[<p>Keep &amp; link</p>]]></content:encoded>`);
  const transform = mock.fn((html: string) => `${html}<p>Added</p>`);
  assert.deepEqual(parseRssFeedItems(xml, {
    hostname: "example.com",
    titleTag: "headline",
    linkTag: "source.link",
    dateTag: "published",
    contentTag: "content:encoded",
    stripQuery: true,
    contentTransform: transform,
  }), [{
    url: "https://example.com/Feed%2fPost/",
    title: "Repairs",
    date: "2026-06-09T08:13:10.000Z",
    contentHtml: "<p>Keep & link</p><p>Added</p>",
  }]);
  assert.deepEqual(transform.mock.calls[0]?.arguments, ["<p>Keep & link</p>"]);
});

test("retains configured content without a transform and omits absent content", () => {
  const xml = feed(`${item}<description><![CDATA[<p>Body</p>]]></description>`);
  assert.equal(parseRssFeedItems(xml, { contentTag: "description" })[0]?.contentHtml, "<p>Body</p>");
  assert.equal(parseRssFeedItems(xml)[0]?.contentHtml, undefined);
  assert.deepEqual(parseRssFeedItems("<rss><channel></channel></rss>"), []);
});

test("removes only the final WordPress attribution paragraph", () => {
  assert.equal(stripWordPressFeedAttribution(
    '<p>Notice</p><p>Публикуван за пръв път на <a href="https://example.com">Example</a></p><p>After</p>',
  ), "<p>Notice</p><p>After</p>");
  assert.equal(stripWordPressFeedAttribution("  <p>Notice</p>  "), "<p>Notice</p>");
  assert.equal(stripWordPressFeedAttribution("Notice публикуван за пръв път на Example"), "Notice");
  assert.equal(stripWordPressFeedAttribution("<p>Notice</p><p>публикуван за пръв път на Example"), "<p>Notice</p>");
});

test("sends compatibility headers and clears its timeout after reading RSS", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const fetchMock = mock.fn(async (input: string | URL | Request, options?: RequestInit) => {
    assert.equal(input, "https://example.com/feed/");
    assert.deepEqual(options?.headers, {
      "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    });
    signal = options?.signal ?? undefined;
    return new Response(feed(item));
  });
  globalThis.fetch = fetchMock;

  assert.equal(await fetchFeedXml("https://example.com/feed/"), feed(item));
  assert.equal(fetchMock.mock.callCount(), 1);
  context.mock.timers.tick(30_001);
  assert.equal(signal?.aborted, false);
});

test("returns a status-bearing HTTP error for pagination and clears the timer", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => {
    signal = options?.signal ?? undefined;
    return new Response("Missing", { status: 404 });
  };
  await assert.rejects(fetchFeedXml("https://example.com/feed/?paged=2"), (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 404);
    assert.equal(error.url, "https://example.com/feed/?paged=2");
    assert.equal(error.message, "RSS feed returned 404 for https://example.com/feed/?paged=2");
    assert.equal(error.name, "RssFeedHttpError");
    return true;
  });
  context.mock.timers.tick(30_001);
  assert.equal(signal?.aborted, false);
});

test("rejects successful HTML/error pages and clears the timer after body failure", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => new Response("<html>Access denied</html>");
  await assert.rejects(fetchFeedXml("https://example.com/feed/"), /does not look like RSS/);

  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => {
    signal = options?.signal ?? undefined;
    const response = new Response();
    mock.method(response, "text", async () => {
      throw new Error("Connection closed during body read");
    });
    return response;
  };
  await assert.rejects(fetchFeedXml("https://example.com/feed/"), /Connection closed during body read/);
  context.mock.timers.tick(30_001);
  assert.equal(signal?.aborted, false);
});

test("aborts stalled fetches at the configured timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(new Error("Feed request aborted"));
      }, { once: true });
    });
  };
  const request = fetchFeedXml("https://example.com/feed/", 25);
  const rejected = assert.rejects(request, /Feed request aborted/);
  context.mock.timers.tick(24);
  assert.equal(signal?.aborted, false);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test("exposes equivalent CommonJS RSS helpers", () => {
  const require = createRequire(import.meta.url);
  const commonJs = require("../dist/cjs/rss.js") as typeof import("../dist/esm/rss.js");
  assert.equal(commonJs.parseRssFeedItems(feed(item))[0]?.url, url);
  const error = new commonJs.RssFeedHttpError(503, "https://example.com/feed/");
  assert.equal(error.status, 503);
});
