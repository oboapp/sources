import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import type { Browser, Route } from "playwright";
import { chromium } from "playwright";
import { Window } from "happy-dom";
import type { DiscoveredItem } from "@oboapp/source-sdk";
import { createHybridSource, type HybridSourceOptions } from "../dist/esm/index.js";

const originalDocument = globalThis.document;
const originalElement = globalThis.HTMLElement;
const identifier = "https://example.com/Keep%2fSpelling/?x=1&y=2#section";
const date = "2026-06-09T08:13:10.000Z";
const item: DiscoveredItem = { identifier, payload: { title: "Feed title", date } };

const options: HybridSourceOptions = {
  discoverItems: async () => [{ url: identifier, title: "Feed title", date }],
  selectors: { TITLE: "h1, .fallback-title", CONTENT: "article, .fallback-content" },
  unwantedElements: ["script", "style", "nav", ".share"],
};

function browserFixture(html = '<h1>Page title</h1><article><p>Body</p></article>') {
  const window = new Window();
  window.document.write(html);
  const closePage = mock.fn(async () => {
    return undefined;
  });
  const closeBrowser = mock.fn(async () => {
    return undefined;
  });
  const goto = mock.fn(async (...args: [string, unknown]) => {
    void args;
    return undefined;
  });
  const route = mock.fn(async (...args: [string, (route: Route) => Promise<void>]) => {
    void args;
    return undefined;
  });
  const evaluate = mock.fn(async (callback: (argument: unknown) => unknown, argument: unknown) => {
    Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
    try {
      return callback(argument);
    } finally {
      Object.assign(globalThis, { document: originalDocument, HTMLElement: originalElement });
    }
  });
  const page = { close: closePage, goto, route, evaluate };
  const newPage = mock.fn(async () => page);
  const browser = { newPage, close: closeBrowser } as unknown as Browser;
  const launchBrowser = mock.fn(async () => browser);
  const delay = mock.fn(async () => {
    return undefined;
  });
  return { window, page, browser, newPage, launchBrowser, delay, closePage, closeBrowser, goto, route, evaluate };
}

afterEach(() => {
  Object.assign(globalThis, { document: originalDocument, HTMLElement: originalElement });
  mock.restoreAll();
});

test("discovery keeps first exact identifiers and only bounded feed metadata without a browser", async () => {
  const fixture = browserFixture();
  const discovery = mock.fn(async () => [
    { url: identifier, title: "First title", date, contentHtml: "Full body stays out of discovery payload" },
    { url: identifier, title: "Later title", date: "2026-07-01" },
    { url: "https://example.com/other", title: "Other", date },
  ]);
  const source = createHybridSource({ ...options, discoverItems: discovery }, fixture);
  assert.deepEqual(await source.discoverItems(), {
    items: [
      { identifier, payload: { title: "First title", date } },
      { identifier: "https://example.com/other", payload: { title: "Other", date } },
    ],
  });
  await source.close?.();
  assert.equal(discovery.mock.callCount(), 1);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  assert.equal(fixture.closeBrowser.mock.callCount(), 0);
});

test("propagates discovery failure before opening any provider page", async () => {
  const fixture = browserFixture();
  const source = createHybridSource({
    ...options,
    discoverItems: async () => {
      throw new Error("Listing unavailable");
    },
  }, fixture);
  await assert.rejects(source.discoverItems(), /Listing unavailable/);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("cleans a cloned DOM and retains page-title, RSS-date, links and Markdown conventions", async () => {
  const html = '<h1> Page title </h1><article><h2>Repair</h2><p>See <a href="https://example.com/plan.pdf">plan</a>.</p><pre><code>one\ntwo</code></pre><script>bad()</script><style>.hidden{}</style><nav>Nav</nav><div class="share">Share</div></article>';
  const fixture = browserFixture(html);
  const source = createHybridSource(options, fixture);
  assert.deepEqual(await source.fetchItem(item), {
    title: "Page title",
    datePublished: date,
    message: "## Repair\n\nSee [plan](https://example.com/plan.pdf).\n\n```\none\ntwo\n```",
  });
  assert.deepEqual(fixture.goto.mock.calls[0]?.arguments, [identifier, { waitUntil: "domcontentloaded" }]);
  assert.ok(fixture.window.document.querySelector("script"));
  assert.ok(fixture.window.document.querySelector(".share"));
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 1);
  await source.close?.();
});

test("comma selectors use document order and empty page titles fall back to RSS", async () => {
  const fixture = browserFixture('<div class="fallback-title">Earlier title</div><h1>Later title</h1><div class="fallback-content"><p>Earlier body</p></div><article><p>Later body</p></article>');
  const source = createHybridSource(options, fixture);
  assert.deepEqual(await source.fetchItem(item), {
    title: "Earlier title", datePublished: date, message: "Earlier body",
  });
  fixture.window.document.querySelectorAll("h1, .fallback-title").forEach((element) => {
    element.remove();
  });
  assert.equal((await source.fetchItem(item)).title, "Feed title");
  assert.equal(fixture.launchBrowser.mock.callCount(), 1);
  assert.equal(fixture.newPage.mock.callCount(), 2);
  await source.close?.();
});

test("permits an empty cleanup list and blocks only image, media and font requests", async () => {
  const fixture = browserFixture('<h1>Title</h1><article><p>Body</p><nav>Retained</nav></article>');
  const source = createHybridSource({ ...options, unwantedElements: [] }, fixture);
  assert.equal((await source.fetchItem(item)).message, "Body\n\nRetained");
  const handler = fixture.route.mock.calls[0]?.arguments[1];
  assert.ok(handler);
  for (const resource of ["image", "media", "font", "document", "script"]) {
    const abort = mock.fn(async () => {
      return undefined;
    });
    const continueRequest = mock.fn(async () => {
      return undefined;
    });
    const request = {
      request: () => ({ resourceType: () => resource }),
      abort,
      continue: continueRequest,
    } as unknown as Route;
    await handler(request);
    assert.equal(abort.mock.callCount(), ["image", "media", "font"].includes(resource) ? 1 : 0);
    assert.equal(continueRequest.mock.callCount(), ["image", "media", "font"].includes(resource) ? 0 : 1);
  }
  await source.close?.();
});

test("rejects malformed discovery context before launching a browser", async () => {
  const fixture = browserFixture();
  const source = createHybridSource(options, fixture);
  for (const payload of [undefined, null, [], "text", {}, { title: "", date }, { title: "Title" }, { title: "Title", date: "" }, { title: 1, date }, { title: "Title", date: 1 }]) {
    const invalid = { identifier, ...(payload === undefined ? {} : { payload }) } as DiscoveredItem;
    await assert.rejects(source.fetchItem(invalid), /Missing feed metadata/);
  }
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("missing content fails without feed-body fallback and closes the page", async () => {
  const fixture = browserFixture("<h1>Title</h1>");
  const source = createHybridSource(options, fixture);
  await assert.rejects(source.fetchItem({ ...item, payload: { title: "Feed", date, contentHtml: "Fallback" } }), /Failed to extract content/);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 0);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("routing, navigation and extraction failures close the page and leave browser cleanup available", async () => {
  for (const operation of ["route", "goto", "evaluate"] as const) {
    const fixture = browserFixture();
    const failure = new Error(`${operation} failed`);
    mock.method(fixture.page, operation, async () => {
      throw failure;
    });
    const source = createHybridSource(options, fixture);
    await assert.rejects(source.fetchItem(item), failure);
    assert.equal(fixture.closePage.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 0);
    await source.close?.();
    assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  }
});

test("browser launch failure can be retried without retaining an unopened session", async () => {
  const fixture = browserFixture();
  let firstAttempt = true;
  const launch = mock.method(fixture, "launchBrowser", async () => {
    if (firstAttempt) {
      firstAttempt = false;
      throw new Error("Browser launch failed");
    }
    return fixture.browser;
  });
  const source = createHybridSource(options, fixture);
  await assert.rejects(source.fetchItem(item), /Browser launch failed/);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 0);
  assert.equal((await source.fetchItem(item)).message, "Body");
  assert.equal(launch.mock.callCount(), 2);
  await source.close?.();
});

test("an unexpected non-element content clone fails and closes the detail page", async () => {
  const fixture = browserFixture();
  const article = fixture.window.document.querySelector("article");
  assert.ok(article);
  mock.method(article, "cloneNode", () => fixture.window.document.createTextNode("Unexpected clone"));
  const source = createHybridSource(options, fixture);
  await assert.rejects(source.fetchItem(item), /Failed to extract content/);
  assert.equal(fixture.closePage.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 0);
  await source.close?.();
});

test("detail page close failure stops a successful result and leaves browser cleanup available", async () => {
  const fixture = browserFixture();
  mock.method(fixture.page, "close", async () => {
    throw new Error("Page close failed");
  });
  const source = createHybridSource(options, fixture);
  await assert.rejects(source.fetchItem(item), /Page close failed/);
  assert.equal(fixture.delay.mock.callCount(), 0);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("page creation failure still allows the source browser to be closed", async () => {
  const fixture = browserFixture();
  mock.method(fixture.browser, "newPage", async () => {
    throw new Error("New page failed");
  });
  const source = createHybridSource(options, fixture);
  await assert.rejects(source.fetchItem(item), /New page failed/);
  assert.equal(fixture.closePage.mock.callCount(), 0);
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
});

test("reuses one browser until close and can start a fresh session afterward", async () => {
  const fixture = browserFixture();
  const source = createHybridSource(options, fixture);
  await source.fetchItem(item);
  await source.fetchItem(item);
  assert.equal(fixture.launchBrowser.mock.callCount(), 1);
  await source.close?.();
  await source.close?.();
  assert.equal(fixture.closeBrowser.mock.callCount(), 1);
  await source.fetchItem(item);
  assert.equal(fixture.launchBrowser.mock.callCount(), 2);
  await source.close?.();
});

test("failed browser close clears the old session so a retry can start another browser", async () => {
  const fixture = browserFixture();
  mock.method(fixture.browser, "close", async () => {
    throw new Error("Close failed");
  });
  const source = createHybridSource(options, fixture);
  await source.fetchItem(item);
  await assert.rejects(async () => {
    await source.close?.();
  }, /Close failed/);
  await source.fetchItem(item);
  assert.equal(fixture.launchBrowser.mock.callCount(), 2);
});

test("default browser launch keeps production flags and a two-second successful-fetch delay", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = browserFixture();
  const launch = mock.method(chromium, "launch", async () => fixture.browser);
  let reportPageClosed: () => void = () => {
    throw new Error("Page-close synchronization is not initialized");
  };
  const pageClosed = new Promise<void>((resolve) => {
    reportPageClosed = resolve;
  });
  mock.method(fixture.page, "close", async () => {
    reportPageClosed();
  });
  const source = createHybridSource(options);
  let settled = false;
  const fetched = source.fetchItem(item).then((content) => {
    settled = true;
    return content;
  });
  await pageClosed;
  await Promise.resolve();
  assert.equal(settled, false);
  context.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(settled, false);
  context.mock.timers.tick(1);
  assert.equal((await fetched).message, "Body");
  assert.deepEqual(launch.mock.calls[0]?.arguments, [{
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  }]);
  await source.close?.();
});

test("exposes the browser source factory to CommonJS consumers", () => {
  const require = createRequire(import.meta.url);
  const commonJs = require("../dist/cjs/index.js") as typeof import("../dist/esm/index.js");
  assert.equal(typeof commonJs.createHybridSource, "function");
});
