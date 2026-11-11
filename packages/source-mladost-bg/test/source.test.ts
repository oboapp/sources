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

const indexUrl = "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti";
const identifier = "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti/Test%2fPost/?x=1&y=2";
const detailHtml = `<h1 class="article-title">Page &amp; title</h1><time datetime="2020-01-01">09 Юни 2026</time><div class="article-body"><h2>Repair</h2><p>Water <strong>stops</strong> <a href="https://example.com/plan.pdf">Plan</a>.</p><script>noise</script><style>noise</style><nav>Keep navigation</nav><p>Keep this.</p></div>`;

function card(url = identifier, title = "Listing title"): string {
  return `<article class="blog-card"><a href="${url}">Read</a><h3 class="blog-card__title">${title}</h3><time>01 Януари 2020</time></article>`;
}

function expectedContent() {
  return {
    title: "Page & title",
    datePublished: new Date(2026, 5, 9).toISOString(),
    message: "## Repair\n\nWater **stops** [Plan](https://example.com/plan.pdf).\n\nKeep navigation\n\nKeep this.",
  };
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("preserves exact identifiers, detail content and local-midnight month dates", async () => {
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const discovered = await source.discoverItems();
    assert.deepEqual(discovered, { items: [{ identifier }] });
    assert.deepEqual(await source.fetchItem(discovered.items[0]!), expectedContent());
    assert.deepEqual(fixture.goto.mock.calls.map((call) => {
      return call.arguments;
    }), [
      [indexUrl, { waitUntil: "domcontentloaded" }],
      [identifier, { waitUntil: "domcontentloaded" }],
    ]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
    assert.ok(fixture.document.querySelector("script"), "cleanup leaves the provider DOM intact");
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("retains duplicate discovery URLs and excludes missing titles and other sections", async () => {
  const fixture = browserFixture(indexUrl, [
    card(),
    card(identifier, "Second title"),
    card(identifier, ""),
    card("https://mladost.bg/gradska-i-okolna-sreda/news/other"),
    '<article class="blog-card"><h3 class="blog-card__title">Missing link</h3></article>',
  ].join(""), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.discoverItems(), { items: [{ identifier }, { identifier }] });
  } finally {
    await source.close?.();
  }
});

test("uses the detail title and body rather than listing metadata", async () => {
  const fixture = browserFixture(indexUrl, card(), '<time>09 Юни 2026</time><div class="article-body">Body</div>');
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    await assert.rejects(source.fetchItem(item), /title/i);
    fixture.setDetailHtml('<h1 class="article-title">Detail title</h1>');
    await assert.rejects(source.fetchItem(item), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 3);
    assert.equal(fixture.delay.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("falls back to scan time for missing, unknown-month and invalid calendar dates", async () => {
  const now = new Date("2026-11-11T10:00:00Z");
  mock.timers.enable({ apis: ["Date"], now });
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    for (const dateText of ["", "09 unknown 2026", "31 Февруари 2026", "2026-06-09"]) {
      fixture.setDetailHtml(`<h1 class="article-title">Detail</h1><time>${dateText}</time><div class="article-body">Body</div>`);
      assert.equal((await source.fetchItem({ identifier })).datePublished, now.toISOString());
    }
  } finally {
    await source.close?.();
  }
});

test("retries failed detail requests within one browser session", async () => {
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    const item = (await source.discoverItems()).items[0]!;
    fixture.failNextDetail();
    await assert.rejects(source.fetchItem(item), /Detail navigation failed/);
    assert.deepEqual(await source.fetchItem(item), expectedContent());
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 3);
    assert.equal(fixture.delay.mock.callCount(), 3);
  } finally {
    await source.close?.();
  }
});

test("closes and paces a failed listing before releasing the browser", async () => {
  const fixture = browserFixture(indexUrl, card(), detailHtml);
  mock.method(fixture, "launchBrowser", async () => {
    throw new Error("Browser unavailable");
  });
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.discoverItems(), /Browser unavailable/);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 0);
});

test("exports historical catalog metadata and both runtime module formats", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.equal(metadata.id, "mladost-bg");
  assert.equal(metadata.name, 'Столична община, Район "Младост"');
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
  assert.ok(metadata.url.includes("%d0%b2%d1%81%d0%b8%d1%87%d0%ba%d0%b8"));
});

test("loads metadata without importing the collection runtime", () => {
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

test("matches independently frozen legacy output for captured public pages", async () => {
  const captured = JSON.parse(readFileSync(new URL("./fixtures/legacy.json", import.meta.url), "utf8")) as {
    frozenTime: string;
    detailUrl: string;
    items: { identifier: string }[];
    content: { title: string; datePublished: string; message: string };
  };
  // The legacy month parser retains its scan-time fallback for visible published prefixes.
  mock.timers.enable({ apis: ["Date"], now: new Date(captured.frozenTime) });
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
