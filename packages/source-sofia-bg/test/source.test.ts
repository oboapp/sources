import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import { chromium, type Browser } from "playwright";
import { articleUrlKey, createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { discoverListing } from "../dist/esm/listing.js";

const repairs = "https://www.sofia.bg/bg/repairs-and-traffic-changes";
const news = "https://www.sofia.bg/bg/news";
const rss = "https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss";
const listed = "https://www.sofia.bg/bg/web/guest/w/7983928";
const newsId = "https://www.sofia.bg/news/-/asset_publisher/abc/content/id/123";
const title = "Ремонт на улица";
const feed = `<rss><channel><item><title>News &amp; traffic</title>
  <link>${newsId}?tracking=1#body</link><dc:date>2026-10-02T10:00:00+03:00</dc:date>
  </item></channel></rss>`;
const asset = '<h1 class="asset-title">Article</h1><div class="asset-content"><p>Road <b>work</b></p><script>noise()</script></div>';
const fragments = '<main id="main-content"><div class="component-paragraph text-break"></div><div class="component-paragraph text-break"><p>News article</p><nav>noise</nav></div></main>';

function listing(path: string, headline: string, next?: string): string {
  return `<main id="main-content">
    <a href="${path}"><span class="date">02.10.2026</span><div class="news-title">${headline}</div></a>
    <a href="https://example.org/w/abc"><span class="date">02.10.2026</span><div class="news-title">External</div></a>
    <a href="/w/invalid"><span class="date">31.02.2026</span><div class="news-title">Invalid date</div></a>
    ${next ? `<a title="Следваща страница" href="${next}">Next</a>` : ""}</main>`;
}

function provider(t: TestContext, pages: Map<string, string | number>, xml: string | number) {
  const requests: string[] = [];
  const closed: string[] = [];
  const rssFetch = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, rss);
    assert.ok(new Headers(options.headers).get("Accept")?.includes("application/rss+xml"));
    return typeof xml === "number" ? new Response("", { status: xml }) : new Response(xml);
  });
  const browser = {
    async newPage() {
      const window = new Window();
      let current = "";
      return {
        async route() {},
        async goto(url: string, options: { waitUntil: string }) {
          current = url;
          requests.push(url);
          assert.equal(options.waitUntil, "domcontentloaded");
          const result = pages.get(url);
          assert.notEqual(result, undefined, url);
          const status = typeof result === "number" ? result : 200;
          if (typeof result === "string") {
            window.document.body.innerHTML = result;
          }
          return { ok: () => status < 400, status: () => status };
        },
        async evaluate(fn: (arg: unknown) => unknown, arg: unknown) {
          const old = { document: globalThis.document, Element: globalThis.Element, HTMLElement: globalThis.HTMLElement };
          Object.assign(globalThis, { document: window.document, Element: window.Element, HTMLElement: window.HTMLElement });
          try {
            return fn(arg);
          } finally {
            Object.assign(globalThis, old);
          }
        },
        async close() {
          closed.push(current);
          await window.happyDOM.close();
        },
      };
    },
    close: t.mock.fn(),
  };
  const launch = t.mock.method(chromium, "launch", async () => browser as unknown as Browser);
  return { requests, closed, rssFetch, launch, browser };
}

test("preserves literal listing and RSS identifiers, date priority, content and pacing", async (t) => {
  const next = repairs + "?cur=2";
  const known = "https://www.sofia.bg/w/known";
  const fixtures = new Map([
    [repairs, listing(listed + "?tracking=1#body", title, next)],
    [next, listing(known, "Known title", repairs + "?cur=3")],
    [listed, asset],
    [newsId, fragments],
  ]);
  const { browser, requests, launch, closed } = provider(t, fixtures, feed);
  const source = createSource({ locality: "bg.sofia" }, { isKnownArticle: (url) => url === known });
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: [
    { identifier: listed, payload: { title } }, { identifier: known, payload: { title: "Known title" } },
    { identifier: newsId, payload: { title: "News & traffic" } },
  ] });
  assert.deepEqual(await source.fetchItem(page.items[0]!), {
    title: "Article", datePublished: "2026-10-02T00:00:00.000Z", message: "Road **work**",
  });
  assert.deepEqual(await source.fetchItem(page.items[2]!), {
    title: "News & traffic", datePublished: "2026-10-02T07:00:00.000Z", message: "News article",
  });
  assert.deepEqual(requests, [repairs, next, listed, newsId]);
  assert.deepEqual(closed, [next, listed, newsId]);
  assert.equal(launch.mock.callCount(), 1);
  await source.close?.();
  assert.equal(browser.close.mock.callCount(), 1);
  await assert.rejects(source.fetchItem(page.items[0]!), /not discovered/);
});

test("falls back to the news listing and deduplicates locale and guest aliases", async (t) => {
  const { requests } = provider(t, new Map([
    [repairs, listing(listed, title)],
    [news, listing("/w/7983928", "Another title", "https://example.org/news")],
  ]), 403);
  const warnings: string[] = [];
  const source = createSource({ locality: "bg.sofia" }, { onWarning(message) {
    warnings.push(message);
    throw new Error("warning reporter unavailable");
  } });
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: [{ identifier: listed, payload: { title } }] });
  assert.deepEqual(requests, [repairs, news]);
  assert.deepEqual(warnings, ["News RSS unavailable, using public listing"]);
  assert.equal(articleUrlKey(listed), articleUrlKey("https://www.sofia.bg/w/7983928/?tracking=1"));
  await source.close?.();
});

test("keeps ten pages when the safety-limit reporter rejects and paces nine page transitions", async (t) => {
  const pages = new Map<string, string>();
  for (let n = 1; n <= 10; n++) {
    const url = n === 1 ? repairs : `${repairs}?cur=${n}`;
    pages.set(url, listing(`/w/${n}`, `Article ${n}`, `${repairs}?cur=${n + 1}`));
  }
  const { browser, requests } = provider(t, pages, "<rss/>");
  const delay = t.mock.fn(async () => undefined);
  const onWarning = t.mock.fn(async () => {
    throw new Error("warning reporter unavailable");
  });
  const posts = await discoverListing(browser as unknown as Browser, repairs, { onWarning }, delay);
  assert.equal(posts.length, 10);
  assert.equal(requests.length, 10);
  assert.equal(delay.mock.callCount(), 9);
  assert.equal(onWarning.mock.callCount(), 1);
});

test("makes healthy news available before surfacing a failed repairs listing", async (t) => {
  const { closed } = provider(t, new Map<string, string | number>([[repairs, 403], [newsId, 503]]), feed);
  const source = createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.deepEqual(page.items.map((item) => item.identifier), [newsId]);
  await assert.rejects(source.fetchItem(page.items[0]!), /HTTP 503/);
  assert.deepEqual(closed, [repairs, newsId]);
  await assert.rejects(source.discoverItems(page.nextCursor), (error) => {
    return error instanceof AggregateError && error.errors[0]?.message.includes("HTTP 403");
  });
  await source.close?.();
});

test("reports both failed discoveries with no incomplete candidates", async (t) => {
  const { requests } = provider(t, new Map<string, string | number>([[repairs, "<div>No listing</div>"], [news, 503]]), "HTML response");
  const source = createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), (error) => {
    return error instanceof AggregateError && error.errors.length === 2 &&
      error.errors[0]?.message.includes("No dated articles") && error.errors[1]?.message.includes("HTTP 503");
  });
  await assert.rejects(source.discoverItems("unexpected"), /cursor/);
  assert.deepEqual(requests, [repairs, news]);
  await source.close?.();
});

test("closes a failed detail, retries next scan and rejects a cancelled scan", async (t) => {
  const pages = new Map([[repairs, listing(listed, title)], [listed, "<div>Empty</div>"]]);
  const { closed } = provider(t, pages, "<rss/>");
  const controller = new AbortController();
  const source = createSource({ locality: "bg.sofia", signal: controller.signal });
  await source.discoverItems();
  await assert.rejects(source.fetchItem({ identifier: listed }), /extract content/);
  pages.set(listed, asset);
  await source.discoverItems();
  assert.equal((await source.fetchItem({ identifier: listed })).title, "Article");
  assert.deepEqual(closed, [repairs, listed, repairs, listed]);
  controller.abort();
  await assert.rejects(source.discoverItems(), /abort/i);
  await source.close?.();
});

test("exports the historical catalog and both module formats", () => {
  const require = createRequire(import.meta.url);
  assert.deepEqual(metadata, {
    id: "sofia-bg", name: "Столична община", localities: ["bg.sofia"],
    url: "https://www.sofia.bg/repairs-and-traffic-changes",
  });
  assert.deepEqual(require("@oboapp/source-sofia-bg/metadata").metadata, metadata);
  assert.equal(typeof require("@oboapp/source-sofia-bg").createSource, "function");
});
