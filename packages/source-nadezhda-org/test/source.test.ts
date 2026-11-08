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

const indexUrl = "https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F";
const identifier = "https://nadezhda.sofia.bg/news/Test%2fPost/?x=1&y=2#notice";
const detailHtml = `<div class="justify-content-center"><div><h1 class="pl-2">Page &amp; title</h1><div class="bg-white mt-2"><small class="pl-2">09.06.2026</small><div class="p-2"><h2>Repair</h2><p>Water <strong>stops</strong> <a href="https://example.com/plan.pdf">Plan</a>.</p><script>noise</script><style>noise</style><nav>noise</nav><div class="breadcrumb">noise</div><footer>noise</footer><p>Keep this.</p></div></div></div></div>`;

// Frozen from the legacy generic extractor and Markdown builder on this fixture.
const legacyContent = {
  title: "Page & title",
  datePublished: "2026-06-09T00:00:00.000Z",
  message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep this.",
};

function card(url = identifier, title = "Listing title"): string {
  return `<li class="shadow-sm"><a href="${url}">${title}</a><small>01.01.2020</small></li>`;
}

function listing(cards: string): string {
  return `<ul>${cards}</ul>`;
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

test("deduplicates exact news identifiers and rejects off-host and non-news paths", async () => {
  const fixture = browserFixture(indexUrl, listing([
    card(),
    card(identifier, "Later duplicate title"),
    card("https://example.com/news/other/"),
    card("https://nadezhda.sofia.bg/newsletter/other/"),
    card("https://nadezhda.sofia.bg/other/?next=/news/"),
    card(identifier, ""),
  ].join("")), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [{ identifier }]);
  } finally {
    await source.close?.();
  }
});

test("requires the detail title and content instead of replacing them with listing metadata", async () => {
  const fixture = browserFixture(indexUrl, listing(card()), `<div class="justify-content-center"><div><div class="bg-white mt-2"><div class="p-2"><p>Body.</p></div></div></div></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml(`<div class="justify-content-center"><div><h1 class="pl-2">Detail title</h1></div></div>`);
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
  const fixture = browserFixture(indexUrl, listing(card()), `<div class="justify-content-center"><div><section><h1 class="pl-2">First DOM title</h1><small class="pl-2">09/06/26</small><div class="p-2"><p>First DOM body.</p></div></section><h1 class="pl-2">Later title</h1><div class="bg-white mt-2"><div class="p-2">Later body.</div></div></div></div>`);
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
    id: "nadezhda-org",
    url: indexUrl,
    name: 'Столична община, Район "Надежда"',
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
