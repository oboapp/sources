import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Window } from "happy-dom";
import type { HybridDependencies } from "@oboapp/source-web-utils";
import { createSource, createSourceWithDependencies } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";

type Browser = Awaited<ReturnType<HybridDependencies["launchBrowser"]>>;

const identifier = "https://sredec-sofia.org/Test%2fPost/?x=1&y=2#notice";
const emptyFeed = "<rss><channel></channel></rss>";
const xml = `<rss><channel><item>
  <title>Feed &amp; title</title>
  <link>https://sredec-sofia.org/Test%2fPost/?x=1&amp;y=2#notice</link>
  <pubDate>Tue, 08 Sep 2026 12:39:00 +0000</pubDate>
  <description><![CDATA[Feed excerpt]]></description>
</item></channel></rss>`;

function browserFixture(html: string, failNavigation = false) {
  const window = new Window();
  window.document.write(html);
  const events: string[] = [];
  const closePage = mock.fn(async () => {
    events.push("page-close");
  });
  const closeBrowser = mock.fn(async () => undefined);
  const route = mock.fn(async (...args: unknown[]) => {
    void args;
  });
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
    evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) => {
      const originalDocument = globalThis.document;
      const originalElement = globalThis.HTMLElement;
      Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
      try {
        return callback(argument);
      } finally {
        Object.assign(globalThis, { document: originalDocument, HTMLElement: originalElement });
      }
    },
  };
  const newPage = mock.fn(async () => page);
  return {
    browser: { newPage, close: closeBrowser } as unknown as Browser,
    closePage,
    closeBrowser,
    goto,
    route,
    newPage,
    events,
  };
}

function listingDependencies() {
  let first = true;
  return {
    now: () => new Date("2026-10-26T12:00:00Z"),
    delay: async () => undefined,
    fetchFeed: async () => {
      if (first) {
        first = false;
        return xml;
      }
      return emptyFeed;
    },
  };
}

test("returns one complete discovery page, then fetches exact Sredets content with the feed date", async () => {
  const fixture = browserFixture(`
    <h1>Unrelated heading</h1>
    <h1 class="single-post-title">Page title</h1>
    <time class="updated">Invalid page date</time>
    <article><p>Unrelated article body</p></article>
    <div class="single-blog-content entry">
      <h2>Repair</h2><p>Road repair <a href="https://example.com/plan.pdf">Plan</a></p>
      <script>unwantedScript()</script><style>.unwantedStyle{display:none}</style>
    </div>
  `);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const delay = mock.fn(async () => {
    fixture.events.push("detail-delay");
  });
  const source = createSourceWithDependencies({ launchBrowser, delay }, listingDependencies());

  const page = await source.discoverItems();
  assert.equal(page.nextCursor, undefined);
  assert.deepEqual(page.items, [{
    identifier,
    payload: { title: "Feed & title", date: "2026-09-08T12:39:00.000Z" },
  }]);
  assert.equal(launchBrowser.mock.callCount(), 0);

  assert.deepEqual(await source.fetchItem(page.items[0]!), {
    title: "Page title",
    datePublished: "2026-09-08T12:39:00.000Z",
    message: "## Repair\n\nRoad repair [Plan](https://example.com/plan.pdf)",
  });
  assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
  assert.equal(fixture.route.mock.calls[0]?.arguments[0], "**/*");
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(delay.mock.callCount(), 1);
  assert.deepEqual(fixture.events, ["page-close", "detail-delay"]);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("falls back to the RSS title, retains Sredets-specific content, and reuses one browser", async () => {
  const fixture = browserFixture(`
    <h1>Unrelated heading</h1>
    <div class="single-blog-content entry"><p>Body</p><nav>Keep navigation</nav><p class="sharedaddy">Keep sharing</p></div>
  `);
  const launchBrowser = mock.fn(async () => fixture.browser);
  const source = createSourceWithDependencies({
    launchBrowser,
    delay: async () => undefined,
  }, listingDependencies());
  const item = (await source.discoverItems()).items[0]!;

  const content = await source.fetchItem(item);
  assert.equal(content.title, "Feed & title");
  assert.equal(content.message, "Body\n\nKeep navigation\n\nKeep sharing");
  await source.fetchItem(item);
  assert.equal(launchBrowser.mock.callCount(), 1);
  assert.equal(fixture.newPage.mock.callCount(), 2);
  assert.equal(fixture.closePage.mock.callCount(), 2);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

for (const [name, html, failNavigation] of [
  ["missing page content", '<h1 class="single-post-title">Title</h1><article>Wrong body</article>', false],
  ["navigation failure", "", true],
] as const) {
  test(`closes its page after ${name} without claiming feed excerpts as complete content`, async () => {
    const fixture = browserFixture(html, failNavigation);
    const delay = mock.fn(async () => undefined);
    const source = createSourceWithDependencies({
      launchBrowser: async () => fixture.browser,
      delay,
    }, listingDependencies());
    const item = (await source.discoverItems()).items[0]!;

    await assert.rejects(source.fetchItem(item));

    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(delay.mock.callCount(), 0);
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  });
}

test("does not launch a browser when a later category makes eager discovery fail", async () => {
  let requests = 0;
  const launchBrowser = mock.fn(async () => browserFixture("").browser);
  const source = createSourceWithDependencies({
    launchBrowser,
    delay: async () => undefined,
  }, {
    now: () => new Date("2026-10-26T12:00:00Z"),
    delay: async () => undefined,
    fetchFeed: async () => {
      requests++;
      if (requests === 1) {
        return xml;
      }
      if (requests === 2) {
        return emptyFeed;
      }
      throw new Error("Next category unavailable");
    },
  });

  await assert.rejects(source.discoverItems(), /Next category unavailable/);
  assert.equal(requests, 3);
  assert.equal(launchBrowser.mock.callCount(), 0);
  await source.close?.();
});

test("publishes matching ESM/CommonJS factories and browser-safe literal catalog metadata", async () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "sredec-sofia-org",
    url: "https://sredec-sofia.org/",
    name: 'Столична община, Район "Средец"',
    localities: ["bg.sofia"],
  });

  const metadataPath = fileURLToPath(new URL("../dist/cjs/metadata.js", import.meta.url));
  const child = spawnSync(process.execPath, ["-e", `
    const { metadata } = require(process.argv[1]);
    const runtimeModules = Object.keys(require.cache).filter((key) => /playwright|source-web-utils|turndown/.test(key));
    console.log(JSON.stringify({ metadata, runtimeModules }));
  `, metadataPath], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { metadata, runtimeModules: [] });
  const source = await createSource({ locality: "bg.sofia" });
  await source.close?.();
});
