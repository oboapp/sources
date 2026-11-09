import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceWithDependencies } from "../dist/esm/browser.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { browserFixture } from "./browser-fixture.js";

const indexUrl = "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/";
const identifier = "https://ilinden.sofia.bg/Test%2fPost/?x=1&y=2";
const detailHtml = `<h1>Page &amp; title</h1><time>09.06.2026</time><div class="entry-content"><h2>Repair</h2><p>Water <strong>stops</strong> <a href="https://example.com/plan.pdf">Plan</a>.</p><script>noise</script><style>noise</style><nav>noise</nav><div class="sharedaddy">noise</div><div class="share-buttons">noise</div><div class="navigation">noise</div><div class="post-navigation">noise</div><div class="wp-block-buttons">noise</div><div class="wp-block-social-links">noise</div><div class="related-posts">noise</div><footer>noise</footer><p>Keep this.</p></div>`;

// Frozen from the legacy generic extractor and Markdown builder on this fixture.
const legacyContent = {
  title: "Page & title",
  datePublished: "2026-06-09T00:00:00.000Z",
  message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep this.",
};

function card(url = identifier, title = "Listing title"): string {
  return `<article><a href="${url}">Read</a><h2>${title}</h2><time>01.01.2020</time></article>`;
}

function listing(cards: string): string {
  return `${cards}`;
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("discovers the existing listing and preserves exact content, detail dates and browser reuse", async () => {
  const fixture = browserFixture(indexUrl, listing(card()), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const discovered = await source.discoverItems();
    assert.deepEqual(discovered, { items: [{ identifier }] });
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [indexUrl, { waitUntil: "domcontentloaded" }]);
    assert.deepEqual(await source.fetchItem(discovered.items[0]!), legacyContent);
    assert.deepEqual(fixture.goto.mock.calls[1]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.ok(fixture.document.querySelector("nav"), "cleanup keeps the provider DOM intact");
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("keeps literal duplicate identifiers and rejects legacy category, tag, page, fragment and host exclusions", async () => {
  const fixture = browserFixture(indexUrl, listing([
    card(),
    card(identifier, "Later duplicate title"),
    card("https://ilinden.sofia.bg/category/news/"),
    card("https://ilinden.sofia.bg/%74ag/topic/"),
    card("https://ilinden.sofia.bg/page/2/"),
    card("https://ilinden.sofia.bg/post/#comments"),
    card("https://example.com/ilinden.sofia.bg/post/"),
    card("http://ilinden.sofia.bg/post/"),
    card(identifier, ""),
  ].join("")), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [{ identifier }, { identifier }]);
  } finally {
    await source.close?.();
  }
});

test("requires the detail title and content instead of replacing them with listing metadata", async () => {
  const fixture = browserFixture(indexUrl, listing(card()), `<div class="entry-content"><p>Body.</p></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml(`<h1>Detail title</h1>`);
    await assert.rejects(source.fetchItem(item), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("retries a failed detail within the same source session", async () => {
  const fixture = browserFixture(indexUrl, listing(card()), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    fixture.failNextDetail();
    await assert.rejects(source.fetchItem(item), /Detail navigation failed/);
    assert.deepEqual(await source.fetchItem(item), legacyContent);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("preserves document order for selector alternatives and short slash dates", async () => {
  const fixture = browserFixture(indexUrl, listing(card()), `<h3 class="entry-title">First DOM title</h3><h1>Later title</h1><div class="post-content"><p>First DOM body.</p></div><main>Later body.</main><div class="posted-on">09/06/26</div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const content = await source.fetchItem({ identifier });
    assert.deepEqual(content, {
      title: "First DOM title",
      datePublished: "2026-06-09T00:00:00.000Z",
      message: "First DOM body.",
    });
  } finally {
    await source.close?.();
  }
});

test("exports the existing source identity through ESM and CommonJS entrypoints", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "rayon-ilinden-bg",
    url: indexUrl,
    name: 'Столична община, Район "Илинден"',
    localities: ["bg.sofia"],
  });
});

test("loads catalog metadata without server collection dependencies", () => {
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


test("matches frozen legacy output for captured public provider pages", async () => {
  const captured = JSON.parse(readFileSync(new URL("./fixtures/legacy.json", import.meta.url), "utf8")) as {
    detailUrl: string;
    items: { identifier: string }[];
    content: { title: string; datePublished: string; message: string };
  };
  const capturedListing = readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
  const capturedDetail = readFileSync(new URL("./fixtures/detail.html", import.meta.url), "utf8");
  // Keep the legacy current-time fallback deterministic for non-numeric detail dates.
  mock.timers.enable({ apis: ["Date"], now: new Date(captured.content.datePublished) });
  const fixture = browserFixture(indexUrl, capturedListing, capturedDetail);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, captured.items);
    assert.deepEqual(await source.fetchItem({ identifier: captured.detailUrl }), captured.content);
  } finally {
    await source.close?.();
  }
});
