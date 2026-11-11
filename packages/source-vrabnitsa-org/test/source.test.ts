import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceWithDependencies } from "../dist/esm/browser.js";
import { parsePublicationDate } from "../dist/esm/date.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { browserFixture } from "./browser-fixture.js";

const indexUrl = "https://vrabnitsa.sofia.bg/aktualno/news";
const identifier = "https://vrabnitsa.sofia.bg/aktualno/news/Test%2fPost/?x=1&y=2";
const detailHtml = `<h1 class="article-title">Page &amp; title</h1>
  <time datetime="2026-03-12T10:22:16+02:00">Публикувано: 10 март 2026</time>
  <div class="article-body"><h2>Repair</h2><p>Water <strong>stops</strong> <a href="https://example.com/plan.pdf">Plan</a>.</p>
  <script>noise</script><style>noise</style><div class="article-aside">noise</div><div class="pager">noise</div>
  <div class="icons">noise</div><div class="btn-group">noise</div><div class="navigation">noise</div><p>Keep this.</p></div>`;

// Frozen from the original extractor, date parser and Markdown conversion.
const legacyContent = {
  title: "Page & title",
  datePublished: "2026-03-12T08:22:16.000Z",
  message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep this.",
};

function card(url = identifier, title = "Listing title"): string {
  return `<article class="blog-card so_article"><h3 class="blog-card__title"><a href="${url}">${title}</a></h3><time>01 януари 2020</time></article>`;
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("preserves literal identifiers, datetime precedence, cleanup and one browser session", async () => {
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const page = await source.discoverItems();
    assert.deepEqual(page, { items: [{ identifier }] });
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [indexUrl, { waitUntil: "domcontentloaded" }]);
    assert.deepEqual(await source.fetchItem(page.items[0]!), legacyContent);
    assert.deepEqual(fixture.goto.mock.calls[1]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
    assert.ok(fixture.document.querySelector(".navigation"), "cleanup keeps the provider DOM intact");
    assert.ok(fixture.document.querySelector("script"));
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("keeps legacy URL filtering, duplicate order, encoded spelling and broad host matching", async () => {
  const encoded = "https://vrabnitsa.sofia.bg/%61ktualno/news/encoded";
  const malformed = "https://vrabnitsa.sofia.bg/aktualno/news/invalid%zz";
  const otherHost = "https://example.com/aktualno/news/legacy-accepted";
  const fixture = browserFixture(indexUrl, [
    card(),
    card(identifier, "Later title"),
    card("https://vrabnitsa.sofia.bg/aktualno/news/page/2"),
    card("https://vrabnitsa.sofia.bg/aktualno/news/post#comments"),
    card("https://vrabnitsa.sofia.bg/aktualno/news/post%23comments"),
    card("https://vrabnitsa.sofia.bg/aktualno/careers/post"),
    card(encoded),
    card(malformed),
    card(otherHost),
    card(identifier, ""),
    `<article class="blog-card"><h3 class="blog-card__title"><a href="${identifier}">Wrong card class</a></h3></article>`,
  ].join(""), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [
      { identifier },
      { identifier },
      { identifier: encoded },
      { identifier: malformed },
      { identifier: otherHost },
    ]);
  } finally {
    await source.close?.();
  }
});

test("reads normalized visible dates when the datetime attribute is empty", async () => {
  const fixture = browserFixture(indexUrl, card(), `<h1 class="article-title">Detail title</h1><time datetime="  "> Публикувано:\n 12\tмарт 2026 </time><div class="article-body"><p>Body.</p></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.fetchItem({ identifier }), {
      title: "Detail title",
      datePublished: new Date(2026, 2, 12, 0, 0, 0, 0).toISOString(),
      message: "Body.",
    });
  } finally {
    await source.close?.();
  }
});

test("retains an invalid datetime attribute over valid visible text and falls back to scan time", async () => {
  const now = new Date("2026-11-11T10:00:00.000Z");
  mock.timers.enable({ apis: ["Date"], now });
  const fixture = browserFixture(indexUrl, card(), `<h1 class="article-title">Detail title</h1><time datetime="invalid">12 март 2026</time><div class="article-body"><p>Body.</p></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.fetchItem({ identifier }), {
      title: "Detail title",
      datePublished: "2026-11-11T10:00:00.000Z",
      message: "Body.",
    });
  } finally {
    await source.close?.();
  }
});

test("preserves ISO, prefix, Bulgarian month and invalid-date conversion", () => {
  const now = new Date("2026-11-11T10:00:00.000Z");
  mock.timers.enable({ apis: ["Date"], now });
  assert.equal(parsePublicationDate("2026-03-12T10:22:16+02:00"), "2026-03-12T08:22:16.000Z");
  assert.equal(parsePublicationDate("пУбЛиКуВаНо: 2026-03-12T10:22:16+02:00"), "2026-03-12T08:22:16.000Z");
  assert.equal(parsePublicationDate("12 март 2026"), new Date(2026, 2, 12).toISOString());
  assert.equal(parsePublicationDate("Публикувано: 12 МАРТ 2026"), new Date(2026, 2, 12).toISOString());
  for (const invalid of ["", "Публикувано:   ", "31 февруари 2026", "12 unknown 2026", "not a date"]) {
    assert.equal(parsePublicationDate(invalid), "2026-11-11T10:00:00.000Z");
  }
});

test("requires detail title and content without listing metadata fallback", async () => {
  const fixture = browserFixture(indexUrl, card(), `<div class="article-body"><p>Body.</p></div>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml(`<h1 class="article-title">Detail title</h1>`);
    await assert.rejects(source.fetchItem(item), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 3);
    assert.equal(fixture.delay.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("retries a failed detail in the same session and paces failed attempts", async () => {
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    fixture.failNextDetail();
    await assert.rejects(source.fetchItem(item), /Detail navigation failed/);
    assert.deepEqual(await source.fetchItem(item), legacyContent);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 3);
    assert.equal(fixture.delay.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("handles an empty listing without opening detail pages", async () => {
  const fixture = browserFixture(indexUrl, "<main>No posts.</main>", detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.discoverItems(), { items: [] });
    assert.equal(fixture.goto.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("exports the historical identity through ESM and CommonJS", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "vrabnitsa-org",
    url: indexUrl,
    name: 'Столична община, Район "Връбница"',
    localities: ["bg.sofia"],
  });
});

test("loads ESM and CommonJS catalog metadata without collection dependencies", async () => {
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
  const esmMetadata = readFileSync(new URL("../dist/esm/metadata.js", import.meta.url), "utf8");
  assert.doesNotMatch(esmMetadata, /\bimport\s|\bfrom\s+["']/);
  assert.deepEqual((await import("../dist/esm/metadata.js")).metadata, metadata);
});

test("matches independently frozen legacy output for captured public pages", async () => {
  const captured = JSON.parse(readFileSync(new URL("./fixtures/legacy.json", import.meta.url), "utf8")) as {
    detailUrl: string;
    items: { identifier: string }[];
    content: { title: string; datePublished: string; message: string };
  };
  const listing = readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
  const detail = readFileSync(new URL("./fixtures/detail.html", import.meta.url), "utf8");
  const fixture = browserFixture(indexUrl, listing, detail);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, captured.items);
    assert.deepEqual(await source.fetchItem({ identifier: captured.detailUrl }), captured.content);
  } finally {
    await source.close?.();
  }
});
