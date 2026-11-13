import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload } from "@oboapp/source-sdk";
import type { SourceContent } from "@oboapp/source-sdk";
import { createSofiyskaVodaSource } from "../dist/esm/sofiyska-voda.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import type { ArcGisFeature } from "../dist/esm/types.js";

const originalFetch = globalThis.fetch;
const baseUrl = "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";
const identifier = `${baseUrl}/2/123`;
const legacyCases: Array<{ feature: ArcGisFeature; content: SourceContent }> = JSON.parse(readFileSync(
  new URL("./fixtures/legacy-content.json", import.meta.url), "utf8",
));
const feature = legacyCases[0]!.feature;
const expected = legacyCases[0]!.content;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

function featureWithId(id: number, location = "ул. Тест"): ArcGisFeature {
  return { ...feature, attributes: { ...feature.attributes, OBJECTID: id, LOCATION: location } };
}

function jsonFetch(...responses: unknown[]) {
  let index = 0;
  return mock.fn<typeof globalThis.fetch>(async () => {
    const payload = responses[index];
    index++;
    if (payload === undefined) {
      throw new Error("Unexpected provider request");
    }
    return new Response(JSON.stringify(payload));
  });
}

function waitForAbort(_url: Parameters<typeof globalThis.fetch>[0], options?: Parameters<typeof globalThis.fetch>[1]): Promise<Response> {
  return new Promise((_resolve, reject) => {
    assert.ok(options?.signal);
    if (options.signal.aborted) {
      reject(options.signal.reason);
      return;
    }
    options.signal.addEventListener("abort", () => {
      reject(options.signal?.reason);
    }, { once: true });
  });
}

test("matches legacy content from cached listing data without fetching synthetic identifiers", async () => {
  const fetch = jsonFetch({ features: [feature, feature] });
  const source = createSofiyskaVodaSource({ fetch });
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier }]);
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0]!.arguments;
  const query = new URL(String(url));
  assert.equal(query.origin + query.pathname, `${baseUrl}/2/query`);
  assert.deepEqual(Object.fromEntries(query.searchParams), {
    f: "json",
    where: "ACTIVESTATUS = 'In Progress'",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultOffset: "0",
    resultRecordCount: "1000",
    orderByFields: "START_ DESC",
  });
  assert.deepEqual(options?.headers, {
    referer: "https://gispx.sofiyskavoda.bg/WebApp.InfoCenter/?a=0&tab=0",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    dnt: "1",
  });
  await source.close?.();
  assert.equal(options?.signal?.aborted, true);
});

test("paginates current interruptions before planned interruptions and preserves first-seen content", async () => {
  const fetch = jsonFetch(
    { features: [featureWithId(123, "First"), featureWithId(123, "Duplicate")], exceededTransferLimit: true },
    { features: [featureWithId(123, "Later"), featureWithId(124)], exceededTransferLimit: false },
    { features: [featureWithId(123, "Planned")] },
  );
  const source = createSofiyskaVodaSource({ fetch });
  const first = await source.discoverItems();
  assert.deepEqual(first.items, [{ identifier }]);
  assert.ok(first.nextCursor);
  const second = await source.discoverItems(first.nextCursor);
  assert.deepEqual(second.items, [{ identifier: `${baseUrl}/2/124` }]);
  assert.ok(second.nextCursor);
  const third = await source.discoverItems(second.nextCursor);
  assert.deepEqual(third.items, [{ identifier: `${baseUrl}/3/123` }]);
  assert.equal(third.nextCursor, undefined);
  const content = await source.fetchItem(first.items[0]!);
  assert.equal(content.title, "Текущо спиране – First – Авария");
  assert.equal((await source.fetchItem(third.items[0]!)).title, "Планирано спиране – Planned – Авария");
  const queries = fetch.mock.calls.map(({ arguments: [url] }) => new URL(String(url)));
  assert.deepEqual(queries.map((url) => [url.pathname.split("/").at(-2), url.searchParams.get("resultOffset")]), [
    ["2", "0"], ["2", "1000"], ["3", "0"],
  ]);
  assert.equal(queries[2]!.searchParams.get("where"), "1=1");
  await source.close?.();
});

test("accepts empty layers and does not follow an empty page despite exceededTransferLimit", async () => {
  const fetch = jsonFetch({ features: [], exceededTransferLimit: true }, { features: [] });
  const source = createSofiyskaVodaSource({ fetch });
  const current = await source.discoverItems();
  assert.deepEqual(current.items, []);
  assert.ok(current.nextCursor);
  const planned = await source.discoverItems(current.nextCursor);
  assert.deepEqual(planned, { items: [] });
  assert.equal(fetch.mock.callCount(), 2);
  assert.ok(String(fetch.mock.calls[1]!.arguments[0]).includes("/3/query"));
  await source.close?.();
});

test("skips unusable records without hiding later usable duplicates", async () => {
  const fetch = jsonFetch({ features: [
    null,
    123,
    { attributes: { OBJECTID: "123" }, geometry: feature.geometry },
    { attributes: { OBJECTID: 123 } },
    { geometry: feature.geometry },
    feature,
  ] });
  const warnings: string[] = [];
  const source = createSofiyskaVodaSource({ fetch, warn: (message) => {
    warnings.push(message);
  } });
  assert.deepEqual((await source.discoverItems()).items, [{ identifier }]);
  assert.deepEqual(await source.fetchItem({ identifier }), expected);
  assert.ok(warnings.length > 0);
  await source.close?.();
});

test("keeps large geometries outside bounded discovery payloads and isolates source caches", async () => {
  const rings = Array.from({ length: 30_000 }, () => [23.32, 42.7]);
  const large = { ...feature, geometry: { rings: [rings] } };
  assert.ok(JSON.stringify(large).length > MAX_DISCOVERY_PAYLOAD_BYTES);
  const fetch = jsonFetch({ features: [large] });
  const source = createSofiyskaVodaSource({ fetch });
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier }]);
  assert.ok(serializeDiscoveryPayload(page.items[0]).length < 256);
  assert.ok(JSON.stringify((await source.fetchItem(page.items[0]!)).geoJson).length > MAX_DISCOVERY_PAYLOAD_BYTES);
  assert.equal(fetch.mock.callCount(), 1);
  const unrelated = createSofiyskaVodaSource({ fetch: jsonFetch({ features: [] }) });
  await assert.rejects(unrelated.fetchItem(page.items[0]!));
  await assert.rejects(source.fetchItem({ identifier: `${identifier}?revision=1` }));
  await source.close?.();
  await unrelated.close?.();
});

test("starts a fresh scan when discovery is called again without a cursor", async () => {
  const fetch = jsonFetch({ features: [feature] }, { features: [featureWithId(124)] });
  const source = createSofiyskaVodaSource({ fetch });
  await source.discoverItems();
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: `${baseUrl}/2/124` }]);
  await assert.rejects(source.fetchItem({ identifier }));
  await source.close?.();
});

test("rejects HTTP, ArcGIS and malformed responses and permits retry in a fresh scan", async () => {
  const cases: Array<() => Promise<Response>> = [
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response(JSON.stringify({ error: { code: 500, message: "ArcGIS unavailable" } })),
    async () => new Response("not JSON"),
    async () => new Response("null"),
    async () => new Response("[]"),
    async () => new Response("{}"),
    async () => new Response(JSON.stringify({ features: null })),
    async () => new Response(JSON.stringify({ features: [], exceededTransferLimit: "true" })),
  ];
  for (const failure of cases) {
    let failed = false;
    const source = createSofiyskaVodaSource({ fetch: async () => {
      if (!failed) {
        failed = true;
        return failure();
      }
      return new Response(JSON.stringify({ features: [feature] }));
    } });
    await assert.rejects(source.discoverItems());
    assert.deepEqual((await source.discoverItems()).items, [{ identifier }]);
    await source.close?.();
  }
});

test("rejects repeated cursors and repeating provider pages without an endless pagination loop", async () => {
  const fetch = jsonFetch(
    { features: [feature], exceededTransferLimit: true },
    { features: [featureWithId(124)], exceededTransferLimit: true },
    { features: [featureWithId(124)], exceededTransferLimit: true },
  );
  const source = createSofiyskaVodaSource({ fetch });
  const first = await source.discoverItems();
  assert.ok(first.nextCursor);
  const second = await source.discoverItems(first.nextCursor);
  assert.ok(second.nextCursor);
  await assert.rejects(source.discoverItems(first.nextCursor), /cursor|repeat/i);
  assert.equal(fetch.mock.callCount(), 2);
  await assert.rejects(source.discoverItems(second.nextCursor), /repeat/i);
  assert.equal(fetch.mock.callCount(), 3);
  await source.close?.();
});

test("accepts a final duplicate page when the provider ends pagination", async () => {
  const source = createSofiyskaVodaSource({ fetch: jsonFetch(
    { features: [feature], exceededTransferLimit: true },
    { features: [feature], exceededTransferLimit: false },
  ) });
  const first = await source.discoverItems();
  assert.ok(first.nextCursor);
  const last = await source.discoverItems(first.nextCursor);
  assert.deepEqual(last.items, []);
  assert.ok(last.nextCursor);
  await source.close?.();
});

test("rejects malformed pagination cursors without making provider requests", async () => {
  const fetch = jsonFetch({ features: [feature] });
  const source = createSofiyskaVodaSource({ fetch });
  for (const cursor of ["", "invalid", "0:-1", "2:0", "0:NaN"]) {
    await assert.rejects(source.discoverItems(cursor));
  }
  assert.equal(fetch.mock.callCount(), 0);
  await source.close?.();
});

test("uses a 15-second request timeout and passes timeout cancellation to fetch", async () => {
  const timeout = new AbortController();
  const timeoutMock = mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 15_000);
    return timeout.signal;
  });
  const source = createSofiyskaVodaSource({ fetch: waitForAbort });
  const discovery = source.discoverItems();
  timeout.abort(new Error("request timeout"));
  await assert.rejects(discovery, /request timeout/);
  assert.equal(timeoutMock.mock.callCount(), 1);
  await source.close?.();
});

test("aborts active requests through the external signal or close and rejects work after close", async () => {
  const external = new AbortController();
  const source = createSofiyskaVodaSource({ fetch: waitForAbort, signal: external.signal });
  const discovery = source.discoverItems();
  external.abort(new Error("external cancellation"));
  await assert.rejects(discovery, /external cancellation/);
  await source.close?.();

  const waiting = createSofiyskaVodaSource({ fetch: waitForAbort });
  const active = waiting.discoverItems();
  await waiting.close?.();
  await assert.rejects(active);
  await assert.rejects(waiting.discoverItems(), /closed/i);
  await assert.rejects(waiting.fetchItem({ identifier }));
});

test("rejects a pre-aborted signal before accessing the provider", async () => {
  const external = new AbortController();
  external.abort(new Error("already cancelled"));
  const fetch = jsonFetch({ features: [feature] });
  const source = createSofiyskaVodaSource({ fetch, signal: external.signal });
  await assert.rejects(source.discoverItems(), /already cancelled/);
  assert.equal(fetch.mock.callCount(), 0);
  await source.close?.();
});

test("exposes SDK and CommonJS factories with metadata isolated from runtime imports", async () => {
  globalThis.fetch = jsonFetch({ features: [feature] });
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  await source.close?.();
  assert.deepEqual(metadata, {
    id: "sofiyska-voda",
    url: "https://sofiyskavoda.bg/water-stops",
    name: "Софийска вода",
    localities: ["bg.sofia"],
    emergent: true,
  });
  const require = createRequire(import.meta.url);
  const metadataPath = require.resolve("../dist/cjs/metadata.js");
  delete require.cache[metadataPath];
  const before = new Set(Object.keys(require.cache));
  assert.deepEqual(require(metadataPath).metadata, metadata);
  assert.deepEqual(Object.keys(require.cache).filter((key) => !before.has(key)), [metadataPath]);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
});

test("reports skipped records and invalid provider dates through the public factory's default warnings", async () => {
  const START_ = Date.parse("2024-01-01T08:00:00Z");
  const ALERTEND = Date.parse("2024-01-01T12:00:00Z");
  const warn = mock.method(globalThis.console, "warn", () => {});
  globalThis.fetch = jsonFetch({ features: [
    { geometry: feature.geometry },
    { attributes: { OBJECTID: 123 } },
    { ...feature, attributes: { ...feature.attributes, OBJECTID: 124, START_, ALERTEND } },
  ] });
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: `${baseUrl}/2/124` }]);
  const content = await source.fetchItem(page.items[0]!);
  assert.equal(content.title, expected.title);
  assert.equal(content.datePublished, expected.datePublished);
  assert.equal(content.timespanStart, expected.datePublished);
  assert.equal(content.timespanEnd, expected.datePublished);
  assert.equal(content.deepLinkUrl, "");
  assert.deepEqual(content.categories, ["water"]);
  assert.deepEqual(content.geoJson, expected.geoJson);
  const warnings = warn.mock.calls.map(({ arguments: args }) => args);
  assert.equal(warnings.length, 4);
  assert.match(String(warnings[0]?.[0]), /Skipping .*without OBJECTID/);
  assert.match(String(warnings[1]?.[0]), /Skipping .*without geometry/);
  assert.deepEqual(warnings.slice(2), [
    ["START_ outside valid range", { sourceType: "sofiyska-voda", objectId: 124, startValue: START_ }],
    ["ALERTEND outside valid range", { sourceType: "sofiyska-voda", objectId: 124, alertEnd: ALERTEND }],
  ]);
  await source.close?.();
});

test("routes warning details to an injected callback while leaving the default console unused", async () => {
  const START_ = Date.parse("2024-12-31T23:59:59Z");
  const ALERTEND = Date.parse("2024-12-30T23:59:59Z");
  const consoleWarning = mock.method(globalThis.console, "warn", () => {});
  const warnings: Array<[string, Readonly<Record<string, unknown>> | undefined]> = [];
  const source = createSofiyskaVodaSource({
    fetch: jsonFetch({ features: [
      { ...feature, attributes: { ...feature.attributes, START_, ALERTEND } },
    ] }),
    warn: (message, context) => {
      warnings.push([message, context]);
    },
  });
  const page = await source.discoverItems();
  const content = await source.fetchItem(page.items[0]!);
  assert.equal(content.timespanStart, expected.datePublished);
  assert.equal(content.timespanEnd, expected.datePublished);
  assert.deepEqual(warnings, [
    ["START_ outside valid range", { sourceType: "sofiyska-voda", objectId: 123, startValue: START_ }],
    ["ALERTEND outside valid range", { sourceType: "sofiyska-voda", objectId: 123, alertEnd: ALERTEND }],
  ]);
  assert.equal(consoleWarning.mock.callCount(), 0);
  await source.close?.();
});
