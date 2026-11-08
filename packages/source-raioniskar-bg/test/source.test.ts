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

const indexUrl = "https://raioniskar.bg/?c=pages/static&template=home&lang=bg";
const identifier = "https://raioniskar.bg/?c=important_messages/show/Ab%2f01&lang=bg";
const detailHtml = `<h1 class="title">Page &amp; title</h1><div class="date-and-category">09.06.2026</div><div class="articles view"><h2>Repair</h2><p>Water <strong>stops</strong> <a href="https://example.com/plan.pdf">Plan</a>.</p><script>noise</script><style>noise</style><nav>noise</nav><div class="bottomNav">noise</div><footer>noise</footer><p>Keep this.</p></div>`;

// Frozen from the legacy generic extractor and Markdown builder on this fixture.
const legacyContent = {
  title: "Page & title",
  datePublished: "2026-06-09T00:00:00.000Z",
  message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep this.",
};

function card(url = identifier, title = "Listing title"): string {
  return `<div class="article"><h2 class="title"><a href="${url}">${title}</a></h2><div class="date-and-category">01.01.2020</div></div>`;
}

function listing(cards: string): string {
  return `<div class="articles list type-important_messages">${cards}</div>`;
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

test("keeps literal duplicate query identifiers and filters out other message sections", async () => {
  const fixture = browserFixture(indexUrl, listing([
    card(),
    card(identifier, "Later duplicate title"),
    card("https://raioniskar.bg/?c=news/show/1&lang=bg"),
    card("https://raioniskar.bg/?c=important_messages/list&lang=bg"),
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
  const fixture = browserFixture(indexUrl, listing(card()), `<div class="articles view"><p>Body.</p></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml(`<h1 class="title">Detail title</h1>`);
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
  const fixture = browserFixture(indexUrl, listing(card()), `<h1 class="title">First DOM title</h1><h1 class="title">Later title</h1><div class="date-and-category">09/06/26</div><div class="articles view"><p>First DOM body.</p></div><div class="articles view">Later body.</div>`);
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
    id: "raioniskar-bg",
    url: indexUrl,
    name: 'Столична община, Район "Искър"',
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
