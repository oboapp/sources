import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { Window } from "happy-dom";
import {
  createBrowserSource,
  parseBulgarianDate,
  parseBulgarianMonthDate,
  type BrowserSourceOptions,
} from "../dist/esm/browser.js";

const originalGlobals = {
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  HTMLAnchorElement: globalThis.HTMLAnchorElement,
};
const identifier = "https://example.com/Keep%2fSpelling/?x=1&y=2#section";
const options: BrowserSourceOptions = {
  indexUrl: "https://example.com/listing/",
  selectors: {
    INDEX: {
      POST_CONTAINER: ".post",
      POST_LINK: "a, .non-anchor",
      POST_TITLE: "h2, h3",
      POST_DATE: "time",
    },
    POST: { TITLE: "h1, .title", DATE: "time, .date", CONTENT: "article, .body" },
  },
  unwantedElements: ["script", "style", "nav", ".share"],
};
const articleHtml = '<h1> Detail title </h1><time>09.06.2026</time><article><h2>Repair</h2><p>See <a href="https://example.com/plan.pdf">plan</a>.</p><pre><code>one\ntwo</code></pre><script>noise()</script><style>noise</style><nav>Nav</nav><div class="share">Share</div></article>';

function browserFixture(html = articleHtml, navigationStatus?: number) {
  const window = new Window({ url: options.indexUrl });
  window.document.write(html);
  const closePage = mock.fn(async () => {
    return undefined;
  });
  const closeBrowser = mock.fn(async () => {
    return undefined;
  });
  const goto = mock.fn(async (...args: [string, unknown]) => {
    void args;
    if (navigationStatus === undefined) {
      return undefined;
    }
    return {
      ok() {
        return navigationStatus >= 200 && navigationStatus < 300;
      },
      status() {
        return navigationStatus;
      },
    };
  });
  const route = mock.fn(async (...args: [string, (route: Route) => Promise<void>]) => {
    void args;
    return undefined;
  });
  const evaluate = mock.fn(async (callback: (argument: unknown) => unknown, argument: unknown) => {
    Object.assign(globalThis, {
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLAnchorElement: window.HTMLAnchorElement,
    });
    try {
      return callback(argument);
    } finally {
      Object.assign(globalThis, originalGlobals);
    }
  });
  const page = { close: closePage, goto, route, evaluate };
  const newPage = mock.fn(async () => {
    return page;
  });
  const browser = { newPage, close: closeBrowser } as unknown as Browser;
  const launchBrowser = mock.fn(async () => {
    return browser;
  });
  const delay = mock.fn(async () => {
    return undefined;
  });
  return { window, page, browser, launchBrowser, newPage, closePage, closeBrowser, goto, route, evaluate, delay };
}

afterEach(() => {
  Object.assign(globalThis, originalGlobals);
  mock.restoreAll();
});

test("listing keeps browser anchor identity and DOM order, skips incomplete containers and preserves duplicates", async () => {
  const fixture = browserFixture(`<div class="post"><a href="${identifier.replaceAll("&", "&amp;")}">Link</a><h3> Earlier title </h3><h2>Later title</h2><time>Listing date</time></div>
    <div class="post"><a href="/relative%2fPath/?q=1&amp;x=2">Link</a><h2>Relative</h2></div>
    <div class="post"><a href="${identifier.replaceAll("&", "&amp;")}">Duplicate</a><h2>Duplicate</h2></div>
    <div class="post"><h2>No link</h2></div>
    <div class="post"><a href="/untitled/">Missing title</a></div>
    <div class="post"><div class="non-anchor">Not an anchor</div><h2>Invalid</h2></div>`);
  const source = createBrowserSource(options, fixture);
  assert.deepEqual(await source.discoverItems(), {
    items: [
      { identifier },
      { identifier: "https://example.com/relative%2fPath/?q=1&x=2" },
      { identifier },
    ],
  });
  assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [options.indexUrl, { waitUntil: "domcontentloaded" }]);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 1);
  assert.equal(fixture.closeBrowser.mock.callCount(), 0);
  await source.close?.();
});

test("source filters run on literal identifiers and optional deduplication keeps first URL position", async () => {
  const fixture = browserFixture('<div class="post"><a href="/a/">A</a><h2>First</h2></div><div class="post"><a href="/b/">B</a><h2>Second</h2></div><div class="post"><a href="/a/">A</a><h2>Latest</h2></div><div class="post"><a href="/excluded/">C</a><h2>Excluded</h2></div>');
  const filter = mock.fn((url: string) => {
    return !url.includes("excluded");
  });
  for (const dedupe of ["first", "last"] as const) {
    const source = createBrowserSource({ ...options, urlFilter: filter, dedupe }, fixture);
    assert.deepEqual(await source.discoverItems(), {
      items: [{ identifier: "https://example.com/a/" }, { identifier: "https://example.com/b/" }],
    });
    await source.close?.();
  }
  assert.equal(filter.mock.callCount(), 8);
  assert.equal(filter.mock.calls[0]?.arguments[0], "https://example.com/a/");
});

test("empty listing returns no candidates and still closes and paces the index request", async () => {
  const fixture = browserFixture("<main>No current notices</main>", 200);
  const source = createBrowserSource(options, fixture);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 1);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("HTTP listing errors fail before extraction and retain page cleanup and pacing", async () => {
  for (const status of [403, 404, 429, 500]) {
    const fixture = browserFixture("<main>No current notices</main>", status);
    const extractListing = mock.fn(async () => {
      return [{ url: identifier, title: "Unexpected listing", date: "" }];
    });
    const source = createBrowserSource({ ...options, extractListing }, fixture);
    try {
      await assert.rejects(source.discoverItems(), {
        message: `HTTP ${status} while loading ${options.indexUrl}`,
      });
      assert.equal(extractListing.mock.callCount(), 0);
      assert.equal(fixture.evaluate.mock.callCount(), 0);
      assert.equal(fixture.closePage.mock.callCount(), 1);
      assert.equal(fixture.delay.mock.callCount(), 1);
    } finally {
      await source.close?.();
    }
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("HTTP detail errors fail before content conversion and retain page cleanup and pacing", async () => {
  for (const status of [403, 404, 429, 500]) {
    const fixture = browserFixture(articleHtml, status);
    const extractDetails = mock.fn(async () => {
      return {
        title: "Unexpected title",
        dateText: "09.06.2026",
        contentHtml: "<p>Unexpected body</p>",
      };
    });
    const parsePublicationDate = mock.fn(() => {
      return "2026-06-09T00:00:00.000Z";
    });
    const source = createBrowserSource({ ...options, extractDetails, parsePublicationDate }, fixture);
    try {
      await assert.rejects(source.fetchItem({ identifier }), {
        message: `HTTP ${status} while loading ${identifier}`,
      });
      assert.equal(extractDetails.mock.callCount(), 0);
      assert.equal(parsePublicationDate.mock.callCount(), 0);
      assert.equal(fixture.evaluate.mock.callCount(), 0);
      assert.equal(fixture.closePage.mock.callCount(), 1);
      assert.equal(fixture.delay.mock.callCount(), 1);
    } finally {
      await source.close?.();
    }
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("custom listing extraction retains literal identifiers, filtering and deduplication", async () => {
  const fixture = browserFixture();
  const extractListing = mock.fn(async (page: Page) => {
    assert.equal(page, fixture.page);
    return [
      { url: identifier, title: "First title", date: "Provider date" },
      { url: "https://example.com/excluded", title: "Excluded", date: "" },
      { url: identifier, title: "Later title", date: "Later date" },
    ];
  });
  const source = createBrowserSource({
    ...options,
    extractListing,
    urlFilter(url) {
      return !url.endsWith("excluded");
    },
    dedupe: "last",
  }, fixture);
  try {
    assert.deepEqual(await source.discoverItems(), { items: [{ identifier }] });
    assert.equal(extractListing.mock.callCount(), 1);
    assert.equal(fixture.evaluate.mock.callCount(), 0);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("custom details and date parsing preserve provider values and helper Markdown conversion", async () => {
  const fixture = browserFixture();
  const dateText = "  Публикувано: 9 юни 2026  ";
  const extractDetails = mock.fn(async (page: Page) => {
    assert.equal(page, fixture.page);
    return {
      title: "Provider title",
      dateText,
      contentHtml: "<h2>Provider heading</h2><p>Keep <strong>formatting</strong>.</p>",
    };
  });
  const parsePublicationDate = mock.fn((value: string) => {
    assert.equal(value, dateText);
    return "2026-06-08T21:00:00.000Z";
  });
  const source = createBrowserSource({ ...options, extractDetails, parsePublicationDate }, fixture);
  try {
    assert.deepEqual(await source.fetchItem({ identifier }), {
      title: "Provider title",
      datePublished: "2026-06-08T21:00:00.000Z",
      message: "## Provider heading\n\nKeep **formatting**.",
    });
    assert.equal(extractDetails.mock.callCount(), 1);
    assert.equal(parsePublicationDate.mock.callCount(), 1);
    assert.equal(fixture.evaluate.mock.callCount(), 0);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
  } finally {
    await source.close?.();
  }
});

test("custom detail extraction still requires title and content before date conversion", async () => {
  for (const [title, contentHtml, expected] of [
    ["", "<p>Body</p>", /Failed to extract title/],
    ["Title", "", /Failed to extract content/],
  ] as const) {
    const fixture = browserFixture();
    const parsePublicationDate = mock.fn(() => {
      throw new Error("Invalid content must fail before date parsing");
    });
    const source = createBrowserSource({
      ...options,
      async extractDetails() {
        return { title, dateText: "Provider date", contentHtml };
      },
      parsePublicationDate,
    }, fixture);
    try {
      await assert.rejects(source.fetchItem({ identifier }), expected);
      assert.equal(parsePublicationDate.mock.callCount(), 0);
      assert.equal(fixture.closePage.mock.callCount(), 1);
      assert.equal(fixture.delay.mock.callCount(), 1);
    } finally {
      await source.close?.();
    }
  }
});

test("custom extraction and date-parser failures close pages, pace attempts and allow retry", async () => {
  for (const hook of ["extractListing", "extractDetails", "parsePublicationDate"] as const) {
    const fixture = browserFixture();
    const failure = new Error(`${hook} failed`);
    let fail = true;
    const source = createBrowserSource({
      ...options,
      async extractListing() {
        if (hook === "extractListing" && fail) {
          throw failure;
        }
        return [{ url: identifier, title: "Listing title", date: "Listing date" }];
      },
      async extractDetails() {
        if (hook === "extractDetails" && fail) {
          throw failure;
        }
        return { title: "Detail title", dateText: "Provider date", contentHtml: "<p>Body</p>" };
      },
      parsePublicationDate() {
        if (hook === "parsePublicationDate" && fail) {
          throw failure;
        }
        return "2026-06-09T00:00:00.000Z";
      },
    }, fixture);
    try {
      const attempt = () => {
        if (hook === "extractListing") {
          return source.discoverItems();
        }
        return source.fetchItem({ identifier });
      };
      await assert.rejects(attempt, failure);
      assert.equal(fixture.closePage.mock.callCount(), 1);
      assert.equal(fixture.delay.mock.callCount(), 1);
      fail = false;
      await attempt();
      assert.equal(fixture.closePage.mock.callCount(), 2);
      assert.equal(fixture.delay.mock.callCount(), 2);
      assert.equal(fixture.launchBrowser.mock.callCount(), 1);
    } finally {
      await source.close?.();
    }
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("detail output retains legacy metadata, clone cleanup and Markdown with no listing fallback", async () => {
  const fixture = browserFixture(articleHtml, 200);
  const source = createBrowserSource(options, fixture);
  assert.deepEqual(await source.fetchItem({ identifier, payload: { title: "Listing title", date: "2000-01-01" } }), {
    title: "Detail title",
    datePublished: "2026-06-09T00:00:00.000Z",
    message: "## Repair\n\nSee [plan](https://example.com/plan.pdf).\n\n```\none\ntwo\n```",
  });
  assert.ok(fixture.window.document.querySelector("script"));
  assert.ok(fixture.window.document.querySelector(".share"));
  assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 1);
  await source.close?.();
});

test("comma detail selectors follow document order and an empty cleanup list retains content", async () => {
  const fixture = browserFixture('<div class="title">Earlier title</div><h1>Later title</h1><div class="date">17/07/25</div><time>01.01.2000</time><div class="body"><p>Earlier body</p><nav>Retained</nav></div><article>Later body</article>');
  const source = createBrowserSource({ ...options, unwantedElements: [] }, fixture);
  assert.deepEqual(await source.fetchItem({ identifier }), {
    title: "Earlier title",
    datePublished: "2025-07-17T00:00:00.000Z",
    message: "Earlier body\n\nRetained",
  });
  await source.close?.();
});

test("date conversion retains short years, separators, overflow handling and current-time fallback", async (context) => {
  const now = new Date("2026-11-08T10:11:12.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const fixture = browserFixture();
  const source = createBrowserSource(options, fixture);
  const cases = [
    ["09.06.2026", "2026-06-09T00:00:00.000Z"],
    ["17.07.25", "2025-07-17T00:00:00.000Z"],
    ["17/07/2025", "2025-07-17T00:00:00.000Z"],
    ["31.02.2026", "2026-03-03T00:00:00.000Z"],
    ["", now.toISOString()],
    ["November 8, 2026", now.toISOString()],
    ["2026-01-01T00:00:00.000Z", now.toISOString()],
    ["bad.date.value", now.toISOString()],
  ];
  const time = fixture.window.document.querySelector("time");
  assert.ok(time);
  for (const [input, expected] of cases) {
    time.textContent = input;
    assert.equal((await source.fetchItem({ identifier })).datePublished, expected);
  }
  time.remove();
  assert.equal((await source.fetchItem({ identifier })).datePublished, now.toISOString());
  await source.close?.();
});

test("exported date parsers retain numeric dates and every Bulgarian month with exact date validation", (context) => {
  const now = new Date("2026-11-11T16:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const months = [
    "Януари", "Февруари", "Март", "Април", "Май", "Юни",
    "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември",
  ];
  for (const [index, month] of months.entries()) {
    assert.equal(parseBulgarianMonthDate(`  9 ${month} 2026  `), new Date(2026, index, 9).toISOString());
  }
  assert.equal(parseBulgarianMonthDate("29 февруари 2024"), new Date(2024, 1, 29).toISOString());
  for (const invalid of [
    "", "9 June 2026", "09.06.2026", "9 юни 26", "9 юни 2026 г.",
    "31 февруари 2026", "29 февруари 2026", "0 юни 2026", "32 юни 2026", "1 януари 0001",
  ]) {
    assert.equal(parseBulgarianMonthDate(invalid), now.toISOString());
  }
  assert.equal(parseBulgarianDate("09.06.2026"), "2026-06-09T00:00:00.000Z");
  assert.equal(parseBulgarianDate("17/07/25"), "2025-07-17T00:00:00.000Z");
  assert.equal(parseBulgarianDate("31.02.2026"), "2026-03-03T00:00:00.000Z");
  assert.equal(parseBulgarianDate("9 юни 2026"), now.toISOString());
});

test("month-name dates retain local midnight in UTC and Europe/Sofia including summer time", () => {
  const moduleUrl = new URL("../dist/esm/browser.js", import.meta.url).href;
  const script = [
    `import { parseBulgarianMonthDate, parseBulgarianDate } from ${JSON.stringify(moduleUrl)};`,
    'console.log(JSON.stringify([parseBulgarianMonthDate("9 януари 2026"), parseBulgarianMonthDate("9 юни 2026"), parseBulgarianDate("09.06.2026")]));',
  ].join("\n");
  for (const [timezone, expected] of [
    ["UTC", ["2026-01-09T00:00:00.000Z", "2026-06-09T00:00:00.000Z", "2026-06-09T00:00:00.000Z"]],
    ["Europe/Sofia", ["2026-01-08T22:00:00.000Z", "2026-06-08T21:00:00.000Z", "2026-06-09T00:00:00.000Z"]],
  ] as const) {
    const actual = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: timezone },
    });
    assert.deepEqual(JSON.parse(actual), expected);
  }
});

test("missing detail title and content fail without listing payload fallback and pace failures", async () => {
  for (const [html, error] of [
    ["<article>Body</article>", /Failed to extract title/],
    ["<h1>Title</h1>", /Failed to extract content/],
    ["<h1>Title</h1><article></article>", /Failed to extract content/],
  ] as const) {
    const fixture = browserFixture(html);
    const source = createBrowserSource(options, fixture);
    await assert.rejects(source.fetchItem({ identifier, payload: { title: "Listing fallback", date: "01.01.2026", contentHtml: "Fallback body" } }), error);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("a non-element content clone fails while retaining page cleanup and pacing", async () => {
  const fixture = browserFixture();
  const article = fixture.window.document.querySelector("article");
  assert.ok(article);
  mock.method(article, "cloneNode", () => {
    return fixture.window.document.createTextNode("Unexpected clone");
  });
  const source = createBrowserSource(options, fixture);
  await assert.rejects(source.fetchItem({ identifier }), /Failed to extract title/);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 1);
  await source.close?.();
});

test("resource blocking applies to listing and details and allows document, script and stylesheet requests", async () => {
  const fixture = browserFixture();
  const source = createBrowserSource(options, fixture);
  await source.discoverItems();
  await source.fetchItem({ identifier });
  assert.equal(fixture.route.mock.callCount(), 2);
  for (const call of fixture.route.mock.calls) {
    const handler = call.arguments[1];
    for (const resource of ["image", "media", "font", "document", "script", "stylesheet"]) {
      const abort = mock.fn(async () => {
        return undefined;
      });
      const continueRequest = mock.fn(async () => {
        return undefined;
      });
      await handler({
        request: () => ({ resourceType: () => resource }),
        abort,
        continue: continueRequest,
      } as unknown as Route);
      assert.equal(abort.mock.callCount(), ["image", "media", "font"].includes(resource) ? 1 : 0);
      assert.equal(continueRequest.mock.callCount(), ["image", "media", "font"].includes(resource) ? 0 : 1);
    }
  }
  await source.close?.();
});

test("listing and detail routing, navigation and extraction failures close pages and respect pacing", async () => {
  for (const operation of ["route", "goto", "evaluate"] as const) {
    for (const mode of ["listing", "detail"] as const) {
      const fixture = browserFixture();
      const failure = new Error(`${operation} failed`);
      mock.method(fixture.page, operation, async () => {
        throw failure;
      });
      const source = createBrowserSource(options, fixture);
      await assert.rejects(mode === "listing" ? source.discoverItems() : source.fetchItem({ identifier }), failure);
      assert.equal(fixture.closePage.mock.callCount(), 1);
      assert.equal(fixture.delay.mock.callCount(), 1);
      await source.close?.();
      assert.equal(fixture.closeBrowser.mock.callCount(), 1);
    }
  }
});

test("launch and page-creation failures are retryable and paced without incomplete page cleanup", async () => {
  for (const operation of ["launchBrowser", "newPage"] as const) {
    const fixture = browserFixture();
    let firstAttempt = true;
    function failFirstAttempt() {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("Opening browser page failed");
      }
    }
    if (operation === "launchBrowser") {
      mock.method(fixture, "launchBrowser", async () => {
        failFirstAttempt();
        return fixture.browser;
      });
    } else {
      mock.method(fixture.browser, "newPage", async () => {
        failFirstAttempt();
        return fixture.page as unknown as Page;
      });
    }
    const source = createBrowserSource(options, fixture);
    await assert.rejects(source.fetchItem({ identifier }), /Opening browser page failed/);
    assert.equal(fixture.closePage.mock.callCount(), 0);
    assert.equal(fixture.delay.mock.callCount(), 1);
    assert.equal((await source.fetchItem({ identifier })).title, "Detail title");
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("page-close failure prevents a successful result and still paces the attempt", async () => {
  const fixture = browserFixture();
  mock.method(fixture.page, "close", async () => {
    throw new Error("Page close failed");
  });
  const source = createBrowserSource(options, fixture);
  await assert.rejects(source.fetchItem({ identifier }), /Page close failed/);
  assert.equal(fixture.delay.mock.callCount(), 1);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("one browser serves listing and multiple details, close is idempotent and a later scan starts fresh", async () => {
  const fixture = browserFixture();
  const source = createBrowserSource(options, fixture);
  await source.discoverItems();
  await source.fetchItem({ identifier });
  await source.fetchItem({ identifier });
  assert.equal(fixture.launchBrowser.mock.callCount(), 1);
  assert.equal(fixture.newPage.mock.callCount(), 3);
  assert.equal(fixture.closePage.mock.callCount(), 3);
  assert.equal(fixture.delay.mock.callCount(), 3);
  await source.close?.();
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  await source.discoverItems();
  assert.equal(fixture.launchBrowser.mock.callCount(), 2);
  await source.close?.();
});

test("failed browser close releases the retained session and allows a fresh attempt", async () => {
  const fixture = browserFixture();
  mock.method(fixture.browser, "close", async () => {
    throw new Error("Browser close failed");
  });
  const source = createBrowserSource(options, fixture);
  await source.fetchItem({ identifier });
  await assert.rejects(async () => {
    await source.close?.();
  }, /Browser close failed/);
  await source.fetchItem({ identifier });
  assert.equal(fixture.launchBrowser.mock.callCount(), 2);
});

test("default browser flags and two-second pacing apply to the listing attempt", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = browserFixture();
  const launch = mock.method(chromium, "launch", async () => {
    return fixture.browser;
  });
  let pageClosed: () => void = () => {
    throw new Error("Page-close synchronization is not initialized");
  };
  const closed = new Promise<void>((resolve) => {
    pageClosed = resolve;
  });
  mock.method(fixture.page, "close", async () => {
    pageClosed();
  });
  const source = createBrowserSource(options);
  let settled = false;
  const discovery = source.discoverItems().then((result) => {
    settled = true;
    return result;
  });
  await closed;
  await Promise.resolve();
  context.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(settled, false);
  context.mock.timers.tick(1);
  assert.deepEqual(await discovery, { items: [] });
  assert.deepEqual(launch.mock.calls[0]?.arguments, [{
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  }]);
  await source.close?.();
});

test("browser entrypoint exposes its factory to CommonJS consumers", () => {
  const require = createRequire(import.meta.url);
  const commonJs = require("../dist/cjs/browser.js") as typeof import("../dist/esm/browser.js");
  assert.equal(typeof commonJs.createBrowserSource, "function");
});
