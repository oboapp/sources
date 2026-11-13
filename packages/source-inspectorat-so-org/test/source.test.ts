import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceWithDependencies } from "../dist/esm/browser.js";
import { parseInspectoratDate } from "../dist/esm/dates.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { browserFixture } from "./browser-fixture.js";

const indexUrl = "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8";
const identifier = "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/?newsid=%D0%BC%D0%B8%D0%B5%D0%BD%D0%B5%2f%D0%BF%D0%BE%D0%B4%D0%BB%D0%B5%D0%B7&x=1#notice";
const listingHtml = readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
const detailHtml = readFileSync(new URL("./fixtures/detail.html", import.meta.url), "utf8");
const legacyContent = {
  title: "Миене на подлези & улици",
  datePublished: "2026-06-08T22:00:00.000Z",
  message: "### Ограничение\n\nДвижението е **ограничено**. [План](https://example.com/plan.pdf)\n\nИзползвай обходния маршрут.",
};

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("preserves literal identifiers, last duplicate date, cleaned Markdown and one browser session", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const discovered = await source.discoverItems();
    assert.deepEqual(discovered, { items: [{ identifier }] });
    assert.deepEqual(await source.fetchItem(discovered.items[0]!), legacyContent);
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [indexUrl, { waitUntil: "domcontentloaded" }]);
    assert.deepEqual(fixture.goto.mock.calls[1]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
    assert.ok(fixture.document.querySelector(".article-info"), "cleanup preserves the original DOM");
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("prefers the detail date and preserves the legacy fixed-offset timestamp", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml.replace("<h2>", '<time>10/6/26</time><h2>'));
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    assert.equal((await source.fetchItem(item)).datePublished, "2026-06-09T22:00:00.000Z");
  } finally {
    await source.close?.();
  }
});

test("retains malformed-escape URLs accepted by the legacy newsid filter", async () => {
  const malformedIdentifier = "https://inspectorat-so.org/?newsid=%ZZ";
  const malformedListing = `<article class="newsContent"><a class="titleLink" href="${malformedIdentifier}"><h2>Notice</h2></a></article>`;
  const fixture = browserFixture(indexUrl, malformedListing, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [{ identifier: malformedIdentifier }]);
  } finally {
    await source.close?.();
  }
});

test("retries failed details while closing and pacing every attempted page", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
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
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("requires a detail title and content", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml.replace(/<h2>.*<\/h2>/, ""));
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml('<section itemprop="articleBody"><div class="col-md-12"><h2>Title</h2></div></section>');
    await assert.rejects(source.fetchItem(item), /content/i);
  } finally {
    await source.close?.();
  }
});

test("parses numeric dates, short months, listing fallback and year rollover", () => {
  const reference = new Date("2026-04-01T12:00:00+03:00");
  assert.equal(parseInspectoratDate("6/4/26", "", reference), "2026-04-05T22:00:00.000Z");
  assert.equal(parseInspectoratDate("", "06 апр.", reference), "2026-04-05T22:00:00.000Z");
  assert.equal(parseInspectoratDate("29 дек.", "", new Date("2026-01-05T12:00:00+02:00")), "2025-12-28T22:00:00.000Z");
  assert.equal(parseInspectoratDate("13 АВГ.", "", new Date("2026-08-15T12:00:00Z")), "2026-08-12T22:00:00.000Z");
});

test("retains current-time fallback for invalid and whitespace detail dates", () => {
  const now = new Date("2026-04-01T12:00:00Z");
  mock.timers.enable({ apis: ["Date"], now });
  for (const candidate of ["unknown", "99.99.2026", "12 неизвестен", "99 апр.", " "]) {
    assert.equal(parseInspectoratDate(candidate, "06 апр."), now.toISOString());
  }
  assert.equal(parseInspectoratDate(""), now.toISOString());
});

test("exports matching ESM and CommonJS factories and browser-safe metadata", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "inspectorat-so-org",
    url: indexUrl,
    name: "Столичен инспекторат",
    localities: ["bg.sofia"],
  });
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
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(actual), metadata);
});
