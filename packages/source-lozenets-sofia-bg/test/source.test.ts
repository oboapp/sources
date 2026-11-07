import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, Route } from "playwright";
import { Window } from "happy-dom";
import { createSourceWithDependencies } from "../dist/esm/hybrid.js";
import { metadata } from "../dist/esm/metadata.js";

const originalFetch = globalThis.fetch;
const identifier = "https://lozenets.sofia.bg/Test%2fPost/?x=1&y=2";
const feedUrl = "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/";
const articleHtml = "<h1 class=\"single-post-title\">Page &amp; title</h1><div class=\"meta-date\"><time>stale date</time></div><div class=\"single-blog-content entry\"><h2>Repair</h2><p>Water <strong>stops</strong> <a href=\"https://example.com/plan.pdf\">Plan</a>.</p><script>noise</script><style>noise</style><nav>noise</nav><div class=\"wpex-social-share\">noise</div><div class=\"related-posts\">noise</div><div class=\"navigation\">noise</div><div class=\"comments\">Keep this.</div></div>";

// Frozen from the legacy extractor and buildWebPageSourceDocument on this fixture.
const legacyContent = {
  title: "Page & title",
  datePublished: "2026-06-09T11:13:10.000Z",
  message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep this.",
};

function feed(items = [{
  url: identifier,
  title: "Feed &amp; title",
  date: "Tue, 09 Jun 2026 11:13:10 +0000",
}]): string {
  return `<rss><channel>${items.map((item) => `<item>
    <title>${item.title}</title>
    <link>${item.url.replaceAll("&", "&amp;")}</link>
    <pubDate>${item.date}</pubDate>
    <description><![CDATA[<p>Feed excerpt must not replace article content.</p>]]></description>
  </item>`).join("")}</channel></rss>`;
}

function browserFixture(html: string, failFirstNavigation = false) {
  const window = new Window();
  window.document.body.innerHTML = html;
  const originalDocument = globalThis.document;
  const originalElement = globalThis.HTMLElement;
  const closePage = mock.fn(async () => {});
  const closeBrowser = mock.fn(async () => {});
  const route = mock.fn(async (pattern: string, handler: (route: Route) => Promise<void>) => {
    void pattern;
    void handler;
  });
  const goto = mock.fn(async (...args: unknown[]) => {
    void args;
    if (failFirstNavigation) {
      failFirstNavigation = false;
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
  const browser = { newPage, close: closeBrowser } as unknown as Browser;
  return { browser, closePage, closeBrowser, route, goto, newPage, document: window.document };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

test("fetches the exact category feed and preserves legacy content and URL identity", async () => {
  const fetchFeed = mock.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(feed());
  });
  globalThis.fetch = fetchFeed;
  const fixture = browserFixture(articleHtml);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {});
  const source = createSourceWithDependencies({ launchBrowser, delay });
  try {
    const page = await source.discoverItems();
    assert.equal(fetchFeed.mock.calls[0]?.arguments[0], feedUrl);
    assert.equal(launchBrowser.mock.callCount(), 0);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.identifier, identifier);
    assert.equal(page.nextCursor, undefined);
    assert.deepEqual(await source.fetchItem(page.items[0]!), legacyContent);
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(delay.mock.callCount(), 1);
    assert.ok(fixture.document.querySelector("nav"), "cleaning must leave the original DOM intact");
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("keeps the first duplicate and filters off-host, invalid URL, title and date entries", async () => {
  globalThis.fetch = async () => new Response(feed([
    { url: identifier, title: "First title", date: "Tue, 09 Jun 2026 11:13:10 +0000" },
    { url: identifier, title: "Later duplicate", date: "Mon, 08 Jun 2026 11:13:10 +0000" },
    { url: "https://example.com/off-host", title: "Other site", date: "Tue, 09 Jun 2026 11:13:10 +0000" },
    { url: "/relative-url", title: "Relative", date: "Tue, 09 Jun 2026 11:13:10 +0000" },
    { url: "https://lozenets.sofia.bg/missing-title", title: "", date: "Tue, 09 Jun 2026 11:13:10 +0000" },
    { url: "https://lozenets.sofia.bg/bad-date", title: "Invalid date", date: "invalid" },
  ]));
  const source = createSourceWithDependencies();
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{
    identifier,
    payload: { title: "First title", date: "2026-06-09T11:13:10.000Z" },
  }]);
});

test("falls back to the RSS title, retains the RSS date, and reuses the browser", async () => {
  globalThis.fetch = async () => new Response(feed());
  const fixture = browserFixture(articleHtml.replace(/<h1[\s\S]*?<\/h1>/, ""));
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {});
  const source = createSourceWithDependencies({ launchBrowser, delay });
  try {
    const item = (await source.discoverItems()).items[0]!;
    const content = await source.fetchItem(item);
    assert.equal(content.title, "Feed & title");
    assert.equal(content.datePublished, "2026-06-09T11:13:10.000Z");
    await source.fetchItem(item);
    assert.equal(launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.newPage.mock.callCount(), 2);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
});

test("blocks expensive resources and permits document requests", async () => {
  globalThis.fetch = async () => new Response(feed());
  const fixture = browserFixture(articleHtml);
  const source = createSourceWithDependencies({
    launchBrowser: async () => fixture.browser,
    delay: async () => {},
  });
  try {
    await source.fetchItem((await source.discoverItems()).items[0]!);
    const [pattern, handler] = fixture.route.mock.calls[0]!.arguments;
    assert.equal(pattern, "**/*");
    for (const resourceType of ["image", "media", "font", "document"]) {
      const abort = mock.fn(async () => {});
      const proceed = mock.fn(async () => {});
      await handler({
        request: () => ({ resourceType: () => resourceType }),
        abort,
        continue: proceed,
      } as unknown as Route);
      assert.equal(abort.mock.callCount(), Number(resourceType !== "document"));
      assert.equal(proceed.mock.callCount(), Number(resourceType === "document"));
    }
  } finally {
    await source.close?.();
  }
});

test("closes a failed page and retries the detail in the same browser session", async () => {
  globalThis.fetch = async () => new Response(feed());
  const fixture = browserFixture(articleHtml, true);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {});
  const source = createSourceWithDependencies({ launchBrowser, delay });
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /Navigation failed/);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(delay.mock.callCount(), 0);
    assert.deepEqual(await source.fetchItem(item), legacyContent);
    assert.equal(launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("rejects missing article content and closes the page without using a feed excerpt", async () => {
  globalThis.fetch = async () => new Response(feed());
  const fixture = browserFixture('<h1 class="single-post-title">Title</h1>');
  const delay = mock.fn(async () => {});
  const source = createSourceWithDependencies({
    launchBrowser: async () => fixture.browser,
    delay,
  });
  try {
    await assert.rejects(source.fetchItem((await source.discoverItems()).items[0]!), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(delay.mock.callCount(), 0);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("propagates feed errors without opening a browser", async () => {
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  const fixture = browserFixture(articleHtml);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const source = createSourceWithDependencies({ launchBrowser, delay: async () => {} });
  try {
    await assert.rejects(source.discoverItems(), /503/);
    assert.equal(launchBrowser.mock.callCount(), 0);
  } finally {
    await source.close?.();
  }
});

test("exports the legacy identity through ESM and CommonJS entrypoints", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.equal(metadata.id, "lozenets-sofia-bg");
  assert.equal(metadata.url, "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/");
  assert.equal(metadata.name, 'Столична община, Район "Лозенец"');
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
});

test("loads catalog metadata without loading server collection dependencies", () => {
  const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
  const script = [
    'const Module = require("node:module");',
    'const load = Module._load;',
    'Module._load = function (request, ...args) {',
    '  if (request === "playwright" || request === "turndown" || request.startsWith("@oboapp/source-web-utils")) {',
    '    throw new Error("Catalog loaded collection runtime");',
    '  }',
    '  return load.call(this, request, ...args);',
    '};',
    'console.log(JSON.stringify(require("./dist/cjs/metadata.js").metadata));',
  ].join("\n");
  const actual = execFileSync(process.execPath, ["-e", script], {
    cwd: packageDirectory,
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(actual), metadata);
});
