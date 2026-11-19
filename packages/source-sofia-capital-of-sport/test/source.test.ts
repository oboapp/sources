import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Window } from "happy-dom";
import type { Browser } from "playwright";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";

const identifier = "https://sofia2018.bg/2026/06/sport%2fnotice/?x=1&y=2#detail";
const category = "https://sofia2018.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/";

function item(url: string, title: string): string {
  return `<item><title>${title}</title><link>${url.replaceAll("&", "&amp;")}</link>
    <pubDate>Mon, 15 Jun 2026 06:31:18 +0000</pubDate><description>Short excerpt</description></item>`;
}

test("discovers unique News links and uses the full article with the RSS date", async (t) => {
  const xml = `<rss><channel>${item(identifier, "Event &amp; sport")}${item(identifier, "Duplicate")}
    ${item("https://elsewhere.example/news", "Other provider")}</channel></rss>`;
  const request = t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, category);
    return new Response(xml);
  });
  const window = new Window();
  const saved = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
  t.after(() => {
    Object.assign(globalThis, saved);
    return window.happyDOM.close();
  });
  window.document.body.innerHTML = `<p class="entry-content">Wrong page region</p>
    <article class="post"><header class="entry-header"><h1>Article title</h1></header>
    <time class="published">August 2000</time><div class="entry-content">
    <header>Remove</header><p>Race <strong>route</strong>.</p><footer>Remove</footer>
    <div class="share-buttons">Remove</div></div></article>`;
  let status = 200;
  const goto = t.mock.fn(async () => ({ ok: () => status < 400, status: () => status }));
  const closePage = t.mock.fn(async () => undefined);
  const close = t.mock.fn(async () => undefined);
  const page = {
    goto, close: closePage, route: async () => undefined,
    evaluate: async (read: (arg: unknown) => unknown, arg: unknown) => read(arg),
  };
  const launchBrowser = t.mock.fn(async () => ({ newPage: async () => page, close }) as unknown as Browser);
  const delay = t.mock.fn(async () => undefined);
  const source = createSource({ locality: "bg.sofia" }, { launchBrowser, delay });
  const result = await source.discoverItems();
  assert.deepEqual(result.items, [{ identifier }]);
  assert.equal(launchBrowser.mock.callCount(), 0);
  const notice = result.items[0]!;
  assert.deepEqual(await source.fetchItem(notice), {
    title: "Article title", message: "Race **route**.", datePublished: "2026-06-15T06:31:18.000Z",
  });
  window.document.querySelector("h1")?.remove();
  assert.equal((await source.fetchItem(notice)).title, "Event & sport");
  status = 403;
  await assert.rejects(source.fetchItem(notice), /HTTP 403/);
  status = 200;
  window.document.querySelector("article")?.remove();
  await assert.rejects(source.fetchItem(notice), /content/i);
  await source.close?.();
  assert.equal(request.mock.callCount(), 1);
  assert.equal(launchBrowser.mock.callCount(), 1);
  assert.equal(closePage.mock.callCount(), 4);
  assert.equal(delay.mock.callCount(), 4);
  assert.equal(close.mock.callCount(), 1);
  await assert.rejects(source.fetchItem(notice), /absent/);
});

test("keeps discovery failures distinct from an empty feed", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response("Denied", { status: 403 }));
  const source = createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), /403/);
  request.mock.mockImplementation(async () => new Response("<rss><channel></channel></rss>"));
  assert.deepEqual(await source.discoverItems(), { items: [] });
});

test("exports both module formats and the catalog identity", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("@oboapp/source-sofia-capital-of-sport").createSource, "function");
  assert.deepEqual(require("@oboapp/source-sofia-capital-of-sport/metadata").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "sofia-capital-of-sport",
    name: "София - Европейска столица на спорта",
    url: "https://sofia2018.bg/%d1%81%d1%8a%d0%b1%d0%b8%d1%82%d0%b8%d1%8f/",
    localities: ["bg.sofia"],
  });
});
