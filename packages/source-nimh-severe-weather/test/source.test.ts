import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { afterEach, mock, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload } from "@oboapp/source-sdk";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { createNimhSource } from "../dist/esm/nimh.js";

const activeHtml = readFileSync(new URL("./fixtures/active-entities.html", import.meta.url), "utf8");
const rawHtml = readFileSync(new URL("./fixtures/active-entities-input.html", import.meta.url), "utf8");
const noDangerHtml = readFileSync(new URL("./fixtures/no-danger.html", import.meta.url), "utf8");
const expected = JSON.parse(readFileSync(new URL("./fixtures/active-entities.expected.json", import.meta.url), "utf8")) as {
  identifier: string;
  content: Record<string, unknown>;
};

function browserFixture(html = activeHtml, status = 200) {
  const response = { ok: () => status >= 200 && status < 300, status: () => status };
  const page = {
    goto: mock.fn(async (...args: Parameters<Page["goto"]>) => {
      void args;
      return response;
    }),
    content: mock.fn(async () => html),
  };
  const close = mock.fn(async () => {});
  const newPage = mock.fn(async () => page);
  const instance = { newPage, close } as unknown as Browser;
  const launchBrowser = mock.fn(async () => instance);
  return { page, response, close, newPage, instance, launchBrowser };
}

afterEach(() => {
  mock.restoreAll();
});

test("preserves independently frozen browser content and identifier without navigating synthetic URLs", async () => {
  const fixture = browserFixture();
  const source = createNimhSource(fixture);
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: [{ identifier: expected.identifier }] });
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected.content);
  assert.deepEqual(await source.fetchItem({ identifier: expected.identifier }), expected.content);
  assert.equal(fixture.launchBrowser.mock.callCount(), 1);
  assert.deepEqual(fixture.page.goto.mock.calls[0]?.arguments, [metadata.url, {
    waitUntil: "networkidle",
    timeout: 30_000,
  }]);
  assert.equal(fixture.page.goto.mock.callCount(), 1);
  assert.equal(fixture.close.mock.callCount(), 1);
  await source.close?.();
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /closed/);
  await assert.rejects(source.discoverItems(), /closed/);
});

test("retains the browser serialization identity boundary for HTML entities", async () => {
  const raw = createNimhSource(browserFixture(rawHtml));
  const serialized = createNimhSource(browserFixture(activeHtml));
  assert.equal((await raw.discoverItems()).items[0]?.identifier,
    "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-02-01&h=1662e0b8e108");
  assert.equal((await serialized.discoverItems()).items[0]?.identifier, expected.identifier);
  await raw.close?.();
  await serialized.close?.();
});

test("returns no candidates for the captured no-danger provider page", async () => {
  const fixture = browserFixture(noDangerHtml);
  const source = createNimhSource(fixture);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  assert.equal(fixture.close.mock.callCount(), 1);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /Missing/);
  await source.close?.();
});

test("isolates listing caches and preserves exact identifiers", async () => {
  const source = createNimhSource(browserFixture());
  const other = createNimhSource(browserFixture());
  await source.discoverItems();
  await assert.rejects(other.fetchItem({ identifier: expected.identifier }), /Missing/);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier.replace("&date=", "&DATE=") }), /Missing/);
  await source.close?.();
  await other.close?.();
});

test("clears cached warnings when rediscovery becomes warning-free or fails", async () => {
  const fixture = browserFixture();
  const source = createNimhSource(fixture);
  await source.discoverItems();
  fixture.page.content.mock.mockImplementation(async () => noDangerHtml);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /Missing/);
  fixture.page.content.mock.mockImplementation(async () => activeHtml);
  await source.discoverItems();
  fixture.page.goto.mock.mockImplementation(async () => {
    throw new Error("network failure");
  });
  await assert.rejects(source.discoverItems(), /network failure/);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /Missing/);
  assert.equal(fixture.close.mock.callCount(), 4);
  await source.close?.();
});

test("keeps large listing content outside the discovery payload limit", async () => {
  const large = "Силен вятър ".repeat(MAX_DISCOVERY_PAYLOAD_BYTES);
  const fixture = browserFixture(activeHtml.replace("прогноза за: 01.02.2026", `прогноза за: 01.02.2026 ${large}`));
  const source = createNimhSource(fixture);
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: expected.identifier }]);
  assert.ok(serializeDiscoveryPayload(page.items[0]).length < 256);
  assert.ok((await source.fetchItem(page.items[0]!)).message.length > MAX_DISCOVERY_PAYLOAD_BYTES);
  await source.close?.();
});

for (const status of [403, 404, 429, 500]) {
  test(`rejects HTTP ${status} before extracting content and closes Chromium`, async () => {
    const fixture = browserFixture(activeHtml, status);
    const source = createNimhSource(fixture);
    await assert.rejects(source.discoverItems(), new RegExp(`HTTP ${status}`));
    assert.equal(fixture.page.content.mock.callCount(), 0);
    assert.equal(fixture.close.mock.callCount(), 1);
    await source.close?.();
  });
}

test("rejects malformed pages with an observable warning and closes Chromium", async () => {
  const warn = mock.fn<(message: string) => void>();
  const fixture = browserFixture("<html>Provider error</html>");
  const source = createNimhSource({ ...fixture, warn });
  await assert.rejects(source.discoverItems(), /Failed to parse/);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(fixture.close.mock.callCount(), 1);
  await source.close?.();
});

test("reports malformed pages through the default warning callback", async () => {
  const warn = mock.method(globalThis.console, "warn", () => {});
  const source = createNimhSource(browserFixture("Provider error"));
  await assert.rejects(source.discoverItems(), /Failed to parse/);
  assert.equal(warn.mock.callCount(), 1);
  await source.close?.();
});

test("propagates browser launch failures", async () => {
  const source = createNimhSource({
    launchBrowser: async () => {
      throw new Error("launch failed");
    },
  });
  await assert.rejects(source.discoverItems(), /launch failed/);
  await source.close?.();
});

test("closes the browser when page creation or content collection fails", async () => {
  for (const stage of ["page", "content"]) {
    const fixture = browserFixture();
    if (stage === "page") {
      fixture.newPage.mock.mockImplementation(async () => {
        throw new Error("page failed");
      });
    } else {
      fixture.page.content.mock.mockImplementation(async () => {
        throw new Error("content failed");
      });
    }
    const source = createNimhSource(fixture);
    await assert.rejects(source.discoverItems(), /failed/);
    assert.equal(fixture.close.mock.callCount(), 1);
    await source.close?.();
  }
});

test("rejects pagination cursors before opening Chromium", async () => {
  const fixture = browserFixture();
  const source = createNimhSource(fixture);
  await assert.rejects(source.discoverItems("unexpected"), /pagination/);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  await source.close?.();
});

test("rejects pre-cancelled scans without launching Chromium", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const fixture = browserFixture();
  const source = createNimhSource({ ...fixture, signal: controller.signal });
  await assert.rejects(source.discoverItems(), /cancelled/);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  await source.close?.();
});

test("cancellation closes an active browser and discards its content", async () => {
  const fixture = browserFixture();
  const controller = new AbortController();
  fixture.page.goto.mock.mockImplementation(async () => {
    controller.abort(new Error("cancelled"));
    return fixture.response;
  });
  const source = createNimhSource({ ...fixture, signal: controller.signal });
  await assert.rejects(source.discoverItems(), /cancelled/);
  assert.equal(fixture.close.mock.callCount(), 1);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /cancelled/);
  await source.close?.();
});

test("closes a browser that finishes launching after the source was closed", async () => {
  const fixture = browserFixture();
  let finishLaunch: (browser: Browser) => void = () => {
    throw new Error("Launch has not started");
  };
  const source = createNimhSource({
    launchBrowser: () => new Promise<Browser>((resolve) => {
      finishLaunch = resolve;
    }),
  });
  const discovery = assert.rejects(source.discoverItems(), /closed/);
  await source.close?.();
  finishLaunch(fixture.instance);
  await discovery;
  assert.equal(fixture.close.mock.callCount(), 1);
  assert.equal(fixture.newPage.mock.callCount(), 0);
});

test("rejects cancellation during browser cleanup before caching a warning", async () => {
  const fixture = browserFixture();
  const controller = new AbortController();
  fixture.close.mock.mockImplementation(async () => {
    controller.abort(new Error("cancelled during cleanup"));
  });
  const source = createNimhSource({ ...fixture, signal: controller.signal });
  await assert.rejects(source.discoverItems(), /cancelled during cleanup/);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /cancelled during cleanup/);
});

test("rejects close during browser cleanup before caching a warning", async () => {
  const fixture = browserFixture();
  const source = createNimhSource(fixture);
  fixture.close.mock.mockImplementation(async () => {
    await source.close?.();
  });
  await assert.rejects(source.discoverItems(), /closed/);
  await assert.rejects(source.fetchItem({ identifier: expected.identifier }), /closed/);
});

test("cancellation cleanup failures are observable without an unhandled rejection", async () => {
  const fixture = browserFixture();
  const controller = new AbortController();
  const warn = mock.fn<(message: string) => void>();
  fixture.close.mock.mockImplementation(async () => {
    throw new Error("close failed");
  });
  fixture.page.goto.mock.mockImplementation(async () => {
    controller.abort(new Error("cancelled"));
    return fixture.response;
  });
  const source = createNimhSource({ ...fixture, signal: controller.signal, warn });
  await assert.rejects(source.discoverItems(), /cancelled/);
  assert.match(warn.mock.calls[0]?.arguments[0] ?? "", /close failed/);
  await source.close?.();
});

test("factory supports the selected locality and owns its pinned browser runtime", async () => {
  const fixture = browserFixture();
  const launch = mock.method(chromium, "launch", async () => fixture.instance);
  const source = await createSource({ locality: "bg.sofia" });
  assert.deepEqual((await source.discoverItems()).items, [{ identifier: expected.identifier }]);
  assert.deepEqual(launch.mock.calls[0]?.arguments, [{
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  }]);
  await source.close?.();
  assert.throws(() => createSource({ locality: "bg.plovdiv" }), /Unsupported NIMH locality/);
});

test("factory forwards cancellation and CommonJS exports remain usable", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const source = await createSource({ locality: "bg.sofia", signal: controller.signal });
  await assert.rejects(source.discoverItems(), /cancelled/);
  await source.close?.();
  const require = createRequire(import.meta.url);
  const commonjs = require("../dist/cjs/index.js") as { createSource: typeof createSource };
  assert.equal(typeof commonjs.createSource, "function");
});

test("metadata stays isolated from browser runtime and preserves the source identity", () => {
  assert.deepEqual(metadata, {
    id: "nimh-severe-weather",
    name: "НИМХ - Опасно време",
    url: "https://weather.bg/obshtini/index.php?z=u&o=SOF",
    localities: ["bg.sofia"],
  });
  const output = execFileSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    require("./dist/cjs/metadata.js");
    assert.equal(Object.keys(require.cache).some((file) => file.includes("playwright")), false);
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(output, "");
});
