import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceWithDependencies, FEED_URL } from "../dist/esm/browser.js";
import { extractDateCandidate, isDateRelevant, parseBulgarianDateOrRange, parsePancharevoDateToIso } from "../dist/esm/dates.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { browserFixture } from "./browser-fixture.js";

const indexUrl = "https://www.pancharevo.org/gradska-i-okolna-sreda/planovi-remonti";
const identifier = "https://www.pancharevo.org/%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82%D0%B8-%D0%B8-%D0%B8%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0/2300-%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82?x=1&y=2#notice";
const modernIdentifier = `${indexUrl}/v-zmozni-sa-smusenia-na-elektrozahranvaneto-v-casti-ot-rajon-pancarevo`;
const listingHtml = readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
const detailHtml = readFileSync(new URL("./fixtures/detail.html", import.meta.url), "utf8");
const currentFeedXml = readFileSync(new URL("./fixtures/feed.xml", import.meta.url), "utf8");
const modernDetailHtml = readFileSync(new URL("./fixtures/modern-detail.html", import.meta.url), "utf8");
const now = new Date("2026-11-15T12:00:00.000Z");

function freezeDate() {
  mock.timers.enable({ apis: ["Date"], now });
}

function feedItem(url: string, title = "Ремонт", date = "Thu, 05 Nov 2026 14:49:15 +0200"): string {
  return `<item><title><![CDATA[${title}]]></title><link><![CDATA[${url}]]></link><pubDate>${date}</pubDate><description></description></item>`;
}

function mockFeed(items: string[], status = 200) {
  return mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    assert.equal(input, FEED_URL);
    return new Response(`<rss><channel>${items.join("")}</channel></rss>`, { status });
  });
}

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test("preserves literal identifiers and the legacy article content with one browser", async () => {
  freezeDate();
  const fetchFeed = mockFeed([feedItem(identifier)]);
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.discoverItems(), { items: [{ identifier }] });
    assert.deepEqual(await source.fetchItem({ identifier }), {
      title: "Спиране на водоподаването",
      datePublished: new Date(2026, 10, 13).toISOString(),
      message: "## Спиране на водоподаването\n\nНа 13 ноември (петък) 2026 г. ще се извърши ремонт.\n\n## Ремонт\n\nВода **няма да има**. [План](https://example.com/plan.pdf)\n\nЗапази това.",
    });
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fetchFeed.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 2);
    assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
    assert.ok(fixture.document.querySelector("nav"));
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("filters pagination and other paths while preserving matching paths on other hosts", async () => {
  freezeDate();
  const otherHost = identifier.replace("www.pancharevo.org", "example.com");
  mockFeed([
    feedItem(identifier),
    feedItem(`${identifier.split("?")[0]}?start=4`),
    feedItem("https://www.pancharevo.org/contacts"),
    feedItem(otherHost),
    feedItem(identifier, ""),
    feedItem(identifier),
  ]);
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [{ identifier }, { identifier: otherHost }]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("filters title event dates while ignoring feed publication dates", async () => {
  freezeDate();
  mockFeed([
    feedItem(`${identifier}current`, "Ремонт 14-16.11.2026"),
    feedItem(`${identifier}title`, "Ремонт 15.11.2026"),
    feedItem(`${identifier}past`, "Ремонт 14.11.2026"),
    feedItem(`${identifier}future`, "Ремонт 16.11.2026"),
    feedItem(`${identifier}unknown`),
    feedItem(`${identifier}invalid`, "Ремонт 31.11.2026"),
    feedItem(`${identifier}badmonth`, "Ремонт 15 несъществуващ 2026"),
  ]);
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual((await source.discoverItems()).items, [
      { identifier: `${identifier}current` },
      { identifier: `${identifier}title` },
      { identifier: `${identifier}unknown` },
      { identifier: `${identifier}invalid` },
      { identifier: `${identifier}badmonth` },
    ]);
  } finally {
    await source.close?.();
  }
});

test("discovers the current feed without backfilling its six past dated notices", async () => {
  freezeDate();
  mock.method(globalThis, "fetch", async () => {
    return new Response(currentFeedXml);
  });
  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml);
  const source = createSourceWithDependencies(fixture);
  const expected = {
    items: [
      { identifier: modernIdentifier },
      { identifier: `${indexUrl}/poradi-profilaktika-na-v-zdusni-elektroprovodi-sa-v-zmozni-smusenia-na-elektrozahranvaneto-v-casti-ot-rajon-pancarevo` },
      { identifier: `${indexUrl}/vremenno-zatrudnenie-na-dvizhenieto-v-s-bistritsa` },
    ],
  };
  try {
    assert.equal((currentFeedXml.match(/<item>/g) ?? []).length, 9);
    assert.deepEqual(await source.discoverItems(), expected);
    assert.deepEqual(await source.discoverItems(), expected);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
    assert.equal(fixture.delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
});

test("uses the modern article publication datetime and cleans its body", async () => {
  mockFeed([feedItem(modernIdentifier)]);
  const discoveryFixture = browserFixture(indexUrl, listingHtml, modernDetailHtml);
  const discoverySource = createSourceWithDependencies(discoveryFixture);
  const page = await discoverySource.discoverItems();
  const item = JSON.parse(JSON.stringify(page.items[0]));
  await discoverySource.close?.();

  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.fetchItem(item), {
      title: 'Възможни са смущения на електрозахранването в части от район "Панчарево"',
      datePublished: "2026-11-05T14:49:15.000Z",
      message: "ЕРМ Запад уведомява, че в периода **06-10.11.2026 г.** ще бъде извършена профилактика на въздушни електропроводи към ВЕЦ „Кокаляне“.\n\nВъзможни са смущения в селата Бистрица, Долни Пасарел, Герман, Лозен, Кокаляне и Панчарево.\n\n[Планирани прекъсвания](https://ermzapad.bg/bg/za-klienta/prekusvania/)",
    });
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
    assert.ok(fixture.document.querySelector(".share-buttons"));
  } finally {
    await source.close?.();
  }
});

test("rejects failed feed HTTP responses and paces attempts without launching Chromium", async () => {
  mockFeed([], 403);
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.discoverItems(), /RSS feed returned 403/);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("rejects feed network failures and preserves the original cause", async () => {
  const cause = new Error("Connection reset");
  const failure = new TypeError("fetch failed", { cause });
  mock.method(globalThis, "fetch", async () => {
    throw failure;
  });
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.discoverItems(), (error) => {
      assert.equal(error, failure);
      return true;
    });
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("rejects article HTTP errors and paces a successful retry", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml);
  fixture.setResponseStatus(404);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier: modernIdentifier }), /HTTP 404/);
    fixture.setResponseStatus(200);
    assert.equal((await source.fetchItem({ identifier: modernIdentifier })).datePublished, "2026-11-05T14:49:15.000Z");
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("rejects a missing modern article body even when the page has other content", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, `<main><article id="article_view_news"><h1 class="article-title">Ремонт</h1><time datetime="2026-11-05T16:49:15+02:00">05 Ноември 2026</time></article><nav>Навигация</nav><p>Други новини</p></main>`);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier: modernIdentifier }), /content/i);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("rejects missing or invalid modern publication datetimes without using event dates", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml.replace(' datetime="2026-11-05T16:49:15+02:00"', ""));
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier: modernIdentifier }), /publication datetime/i);
    const invalidDatetimes = [
      "invalid",
      "2026-11-05",
      "11/05/2026",
      "2026-11-05T16:49:15",
      "2026-02-30T16:49:15+02:00",
    ];
    for (const datetime of invalidDatetimes) {
      fixture.setDetailHtml(modernDetailHtml.replace("2026-11-05T16:49:15+02:00", datetime));
      await assert.rejects(source.fetchItem({ identifier: modernIdentifier }), /publication datetime/i, datetime);
    }
    assert.equal(fixture.closePage.mock.callCount(), invalidDatetimes.length + 1);
    assert.equal(fixture.delay.mock.callCount(), invalidDatetimes.length + 1);
  } finally {
    await source.close?.();
  }
});

test("accepts a leap-day publication timestamp with fractional seconds and an offset", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml.replace("2026-11-05T16:49:15+02:00", "2024-02-29T00:15:30.123+02:00"));
  const source = createSourceWithDependencies(fixture);
  try {
    const content = await source.fetchItem({ identifier: modernIdentifier });
    assert.equal(content.datePublished, "2024-02-28T22:15:30.123Z");
  } finally {
    await source.close?.();
  }
});

test("rejects a missing modern article title instead of using the site header", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, modernDetailHtml.replace(/<h1 class="article-title">[\s\S]*?<\/h1>/, ""));
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier: modernIdentifier }), /title/i);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("preserves the title fallback when the detail date selector is empty", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, `<article class="item-page"><h2 itemprop="name">Ремонт 12-14.11.2026</h2><div itemprop="articleBody"><section>Body.</section></div></article>`);
  const source = createSourceWithDependencies(fixture);
  try {
    assert.deepEqual(await source.fetchItem({ identifier }), {
      title: "Ремонт 12-14.11.2026",
      datePublished: new Date(2026, 10, 12).toISOString(),
      message: "## Ремонт 12-14.11.2026\n\nBody.",
    });
  } finally {
    await source.close?.();
  }
});

test("prefers non-empty detail date text over a recognizable date in the title", async () => {
  freezeDate();
  const fixture = browserFixture(indexUrl, listingHtml, `<article class="item-page"><h2 itemprop="name">Ремонт 13.11.2026</h2><div itemprop="articleBody"><p>Няма посочена дата.</p></div></article>`);
  const source = createSourceWithDependencies(fixture);
  try {
    const content = await source.fetchItem({ identifier });
    assert.equal(content.datePublished, now.toISOString());
  } finally {
    await source.close?.();
  }
});

test("fails an invalid recognized detail date and permits a later retry in the same session", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, `<article class="item-page"><h2 itemprop="name">Ремонт</h2><div itemprop="articleBody"><p>31.11.2026</p></div></article>`);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier }), /Invalid date/);
    fixture.setDetailHtml(detailHtml);
    assert.equal((await source.fetchItem({ identifier })).title, "Спиране на водоподаването");
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
});

test("closes failed requests and reuses the browser for a later detail retry", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, detailHtml);
  const source = createSourceWithDependencies(fixture);
  try {
    fixture.failNextDetail();
    await assert.rejects(source.fetchItem({ identifier }), /Detail navigation failed/);
    await source.fetchItem({ identifier });
    assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    assert.equal(fixture.closePage.mock.callCount(), 2);
    assert.equal(fixture.delay.mock.callCount(), 2);
  } finally {
    await source.close?.();
  }
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("requires title and content from details", async () => {
  const fixture = browserFixture(indexUrl, listingHtml, `<article class="item-page"><div itemprop="articleBody"><p>Body.</p></div></article>`);
  const source = createSourceWithDependencies(fixture);
  try {
    await assert.rejects(source.fetchItem({ identifier }), /title/i);
    fixture.setDetailHtml(`<h1>Title only</h1>`);
    await assert.rejects(source.fetchItem({ identifier }), /content/i);
  } finally {
    await source.close?.();
  }
});

test("extracts all legacy date candidate forms", () => {
  const examples = [
    ["Ремонт 28.02-02.03.2026", "28.02-02.03.2026"],
    ["Ремонт 24-26.02.26", "24-26.02.26"],
    ["На 05.12.2025 г.", "05.12.2025"],
    ["На 27 януари (вторник) 2026 г.", "27 януари (вторник) 2026 г."],
    ["Без дата", null],
  ] as const;
  for (const [text, expected] of examples) {
    assert.equal(extractDateCandidate(text), expected);
  }
});

test("parses local-midnight ranges, month names and two-digit years", () => {
  assert.deepEqual(parseBulgarianDateOrRange("28.02-02.03.26"), {
    start: new Date(2026, 1, 28),
    end: new Date(2026, 2, 2),
  });
  assert.deepEqual(parseBulgarianDateOrRange("24-26.02.2026"), {
    start: new Date(2026, 1, 24),
    end: new Date(2026, 1, 26),
  });
  assert.equal(parsePancharevoDateToIso("27 януари (вторник) 2026 г."), new Date(2026, 0, 27).toISOString());
  assert.equal(parsePancharevoDateToIso("13.11.26"), new Date(2026, 10, 13).toISOString());
  assert.equal(parsePancharevoDateToIso("13/11/26"), "2026-11-13T00:00:00.000Z");
  assert.throws(() => parseBulgarianDateOrRange("31.02.2026"), /Invalid date/);
  assert.throws(() => parseBulgarianDateOrRange("27 непознат 2026"), /Unsupported Bulgarian month/);
  assert.throws(() => parseBulgarianDateOrRange("Няма дата"), /Unable to parse/);
});

test("compares date ranges inclusively using local calendar dates", () => {
  const range = parseBulgarianDateOrRange("12-14.11.2026");
  assert.equal(isDateRelevant(range, new Date(2026, 10, 12, 23, 59)), true);
  assert.equal(isDateRelevant(range, new Date(2026, 10, 14, 23, 59)), true);
  assert.equal(isDateRelevant(range, new Date(2026, 10, 11)), false);
  assert.equal(isDateRelevant(range, new Date(2026, 10, 15)), false);
});

test("exports the legacy identity through ESM and CommonJS", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof createSource, "function");
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "rayon-pancharevo-bg",
    url: indexUrl,
    name: 'Столична община, Район "Панчарево"',
    localities: ["bg.sofia"],
  });
});

test("loads metadata without browser collection dependencies", () => {
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
