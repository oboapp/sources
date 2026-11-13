import { after, afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceWithDependencies } from "../dist/esm/browser.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { browserFixture } from "./browser-fixture.js";

const originalTimezone = process.env.TZ;
process.env.TZ = "Europe/Sofia";

const indexUrl = "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8";
const legacy = JSON.parse(readFileSync(new URL("./fixtures/legacy.json", import.meta.url), "utf8")) as {
  identifier: string;
  content: { title: string; datePublished: string; message: string };
};
const listingHtml = readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
const detailHtml = readFileSync(new URL("./fixtures/detail.html", import.meta.url), "utf8");

function card(url: string, title = "Listing title"): string {
  return `<div class="card"><a class="card__title" href="${url}">${title}</a><div class="card__meta">01 Януари 2020</div></div>`;
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

after(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

test("matches the literal legacy identifier, detail date and cleaned Markdown fixture", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  try {
    const discovered = await source.discoverItems();
    assert.deepEqual(discovered, { items: [{ identifier: legacy.identifier }] });
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [indexUrl, { waitUntil: "domcontentloaded" }]);
    assert.deepEqual(await source.fetchItem(discovered.items[0]!), legacy.content);
    assert.deepEqual(fixture.goto.mock.calls[1]?.arguments, [legacy.identifier, { waitUntil: "domcontentloaded" }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
    assert.ok(fixture.document.querySelector("img"), "cleanup preserves the provider DOM");
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("keeps numeric news URLs byte for byte and preserves repeated listing entries", async () => {
  const trailingSlash = "https://www.mvr.bg/sdvr/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/90207/";
  const fixture = browserFixture(indexUrl, [
    card(legacy.identifier),
    card(legacy.identifier, "Repeated article"),
    card(trailingSlash),
    card(`${legacy.identifier}?tag=1`),
    card(`${legacy.identifier}#notice`),
    card("https://www.mvr.bg/sdvr/press/90207"),
    card(`${indexUrl}/category`),
    card(`${indexUrl}?tag=1`),
    card(`${indexUrl}/90300`, ""),
  ].join(""), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [
      { identifier: legacy.identifier },
      { identifier: legacy.identifier },
      { identifier: trailingSlash },
    ]);
  } finally {
    await source.close?.();
  }
});

test("returns an empty discovery page when no eligible articles exist", async () => {
  const fixture = browserFixture(indexUrl, "<main>No news</main>", detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.discoverItems(), { items: [] });
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("requires detail title and content without substituting the listing title", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, '<article class="page-content"><p>Body</p></article>');
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml('<h1 class="page-title">Article title</h1>');
    await assert.rejects(source.fetchItem(item), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 3);
    assert.equal(fixture.delay.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("uses local-midnight Bulgarian dates and the legacy fallback for invalid dates", async () => {
  const now = new Date("2026-11-13T14:00:00.000Z");
  mock.timers.enable({ apis: ["Date"], now });
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    for (const dateText of ["", "31 Февруари 2026", "09 Unknown 2026", "09.06.2026"]) {
      fixture.setDetailHtml(`<header class="page-content__header"><small>${dateText}</small><h1 class="page-title">Article</h1></header><article class="page-content"><p>Body</p></article>`);
      assert.deepEqual(await source.fetchItem({ identifier: legacy.identifier }), {
        title: "Article",
        datePublished: now.toISOString(),
        message: "Body",
      });
    }
    fixture.setDetailHtml('<header class="page-content__header"><small>09 ЯНУАРИ 2026</small><h1 class="page-title">Article</h1></header><article class="page-content"><p>Body</p></article>');
    assert.equal((await source.fetchItem({ identifier: legacy.identifier })).datePublished, "2026-01-08T22:00:00.000Z");
  } finally {
    await source.close?.();
  }
});

test("closes a failed listing page and reuses the browser on a later discovery attempt", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  fixture.failNextListing();
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.discoverItems(), /Listing navigation failed/);
    assert.deepEqual((await source.discoverItems()).items, [{ identifier: legacy.identifier }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("reports unsuccessful HTTP responses and retries detail failures in the same session", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    fixture.setNavigationStatus(503);
    await assert.rejects(source.discoverItems(), /HTTP 503/);
    const item = (await source.discoverItems()).items[0]!;
    fixture.setNavigationStatus(403);
    await assert.rejects(source.fetchItem(item), /HTTP 403/);
    fixture.failNextDetail();
    await assert.rejects(source.fetchItem(item), /Detail navigation failed/);
    assert.deepEqual(await source.fetchItem(item), legacy.content);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 5);
    assert.equal(fixture.delay.mock.callCount(), 5);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("exports the existing source identity through ESM and CommonJS entrypoints", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "sdvr-mvr-bg",
    url: indexUrl,
    name: "СДВР",
    localities: ["bg.sofia"],
  });
});

test("loads catalog metadata without loading browser or content dependencies", () => {
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
