import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload, type JsonValue } from "@oboapp/source-sdk";
import { createToploSource } from "../dist/esm/toplo.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { parseIncidents } from "../dist/esm/parser.js";

const originalFetch = globalThis.fetch;
const originalTimezone = process.env.TZ;
process.env.TZ = "UTC";
const listing = readFileSync(new URL("./fixtures/legacy-listing.html", import.meta.url), "utf8");
const expected: unknown = JSON.parse(readFileSync(new URL("./fixtures/legacy-content.json", import.meta.url), "utf8"));
const identifier = "https://toplo.bg/incidents/item-1";
const point = { type: "Feature", geometry: { type: "Point", coordinates: [23.32, 42.7] }, properties: {} };

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});
process.once("exit", () => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

function listingFetch(html = listing) {
  return mock.fn<typeof globalThis.fetch>(async () => new Response(html));
}

function withGeometry(value: JsonValue): string {
  return listing.replace(/var geoJsonString = '.+?'/, `var geoJsonString = '${JSON.stringify(value)}'`);
}

test("matches the frozen pre-refactor listing and content contract without fetching synthetic URLs", async () => {
  const fetch = listingFetch();
  const source = createToploSource({ fetch });
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: [{ identifier }] });
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0]?.arguments[0], "https://toplo.bg/accidents-and-maintenance");
  assert.deepEqual(fetch.mock.calls[0]?.arguments[1]?.headers, { Accept: "text/html" });
  await source.close?.();
  assert.equal(fetch.mock.calls[0]?.arguments[1]?.signal?.aborted, true);
  await assert.rejects(source.fetchItem({ identifier }), /Missing listing incident/);
  await assert.rejects(source.discoverItems(), /closed/);
});

test("preserves literal identifiers, deduplicates first-seen listing entries and isolates instance caches", async () => {
  const changedIdentifier = "https://toplo.bg/incidents/Case%2fItem?x=1&y=2";
  const block = listing.match(/var geoJsonString[\s\S]+?if \(geoJsonString\) \{ \}/)?.[0];
  assert.ok(block);
  const html = listing.replace("}</script>", `${block}\n}</script>`).replaceAll('"ContentItemId":"item-1"', '"ContentItemId":"Case%2fItem?x=1&y=2"');
  const source = createToploSource({ fetch: listingFetch(html) });
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: changedIdentifier }]);
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected);
  await assert.rejects(source.fetchItem({ identifier: changedIdentifier.toLowerCase() }), /Missing listing incident/);
  const unrelated = createToploSource({ fetch: listingFetch(html) });
  await assert.rejects(unrelated.fetchItem(page.items[0]!), /Missing listing incident/);
  await source.close?.();
  await unrelated.close?.();
});

test("keeps large listing content outside the bounded discovery payload", async () => {
  const largePoint = { ...point, properties: { note: "x".repeat(MAX_DISCOVERY_PAYLOAD_BYTES + 1) } };
  const largeListing = withGeometry([largePoint]).replace('"ContentItemId":"item-1"', '"ContentItemId":"large"');
  const secondBlock = listing.match(/var geoJsonString[\s\S]+?if \(geoJsonString\) \{ \}/)?.[0];
  const fetch = listingFetch(largeListing.replace("}</script>", `${secondBlock}\n}</script>`));
  const source = createToploSource({ fetch });
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: "https://toplo.bg/incidents/large" }, { identifier }]);
  for (const item of page.items) {
    assert.equal(Object.hasOwn(item, "payload"), false);
    assert.ok(serializeDiscoveryPayload({ identifier: item.identifier }).length < 256);
  }
  const content = await source.fetchItem(page.items[0]!);
  assert.ok(JSON.stringify(content.geoJson).length > MAX_DISCOVERY_PAYLOAD_BYTES);
  assert.deepEqual(await source.fetchItem(page.items[1]!), expected);
  assert.equal(fetch.mock.callCount(), 1);
  await source.close?.();
});

test("preserves legacy restoration text and timespan fallback rules", async () => {
  const untilDate = "2026-10-05T09:30:00.000Z";
  for (const value of [untilDate, "invalid", "2024-01-01T00:00:00.000Z"]) {
    const source = createToploSource({ fetch: listingFetch(listing.replace('"UntilDate":null', `"UntilDate":"${value}"`)) });
    const item = (await source.discoverItems()).items[0]!;
    const content = await source.fetchItem(item);
    assert.equal(content.timespanEnd, value === untilDate ? untilDate : "2026-10-04T08:00:00.000Z");
    assert.equal(content.message, `${(expected as { message: string }).message}\n\nОчаквано възстановяване на ${new Date(value).toLocaleString("bg-BG", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
    await source.close?.();
  }
  for (const value of ["invalid", "2024-01-01T00:00:00.000Z"]) {
    const source = createToploSource({ fetch: listingFetch(listing.replaceAll("2026-10-04T08:00:00.000Z", value)) });
    const item = (await source.discoverItems()).items[0]!;
    const before = Date.now();
    const content = await source.fetchItem(item);
    assert.equal(content.datePublished, value);
    assert.ok(Date.parse(content.timespanStart!) >= before);
    assert.ok(Date.parse(content.timespanStart!) <= Date.now());
    assert.equal(content.timespanEnd, content.timespanStart);
    await source.close?.();
  }
});

test("preserves valid features while fixing swapped coordinates and dropping invalid features", () => {
  const invalid = { ...point, geometry: { type: "Point", coordinates: [999, 999] } };
  const swapped = { ...point, geometry: { type: "Point", coordinates: [42.7, 23.32] } };
  const parsed = parseIncidents(withGeometry([invalid, swapped]));
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0]?.geoJson, { type: "FeatureCollection", features: [point] });
  assert.deepEqual(parseIncidents(withGeometry([invalid])), []);
  assert.deepEqual(parseIncidents(withGeometry({ type: "FeatureCollection", features: [point] }))[0]?.geoJson, { type: "FeatureCollection", features: [point] });
  assert.deepEqual(parseIncidents(withGeometry([]))[0]?.geoJson, { type: "FeatureCollection", features: [] });
});

test("normalizes legacy LineString and Polygon geometry and drops invalid rings or unsupported types", () => {
  const line = { ...point, geometry: { type: "LineString", coordinates: [[42.7, 23.32], [42.71, 23.33]] } };
  const polygon = { ...point, geometry: { type: "Polygon", coordinates: [[[42.7, 23.32], [42.71, 23.33], [42.72, 23.32], [42.7, 23.32]]] } };
  const parsed = parseIncidents(withGeometry([line, polygon]));
  assert.deepEqual(parsed[0]?.geoJson, { type: "FeatureCollection", features: [
    { ...point, geometry: { type: "LineString", coordinates: [[23.32, 42.7], [23.33, 42.71]] } },
    { ...point, geometry: { type: "Polygon", coordinates: [[[23.32, 42.7], [23.33, 42.71], [23.32, 42.72], [23.32, 42.7]]] } },
  ] });
  const invalidGeometries = [
    { type: "LineString", coordinates: [[23.32, 42.7]] },
    { type: "Polygon", coordinates: [[[23.32, 42.7], [23.33, 42.71], [23.32, 42.72], [23.32, 42.73]]] },
    { type: "MultiPoint", coordinates: [[23.32, 42.7]] },
  ];
  for (const geometry of invalidGeometries) {
    assert.deepEqual(parseIncidents(withGeometry([{ ...point, geometry }])), []);
  }
});

test("isolates malformed listing blocks and fails clearly for HTTP or empty listings", async () => {
  const secondBlock = listing.match(/var geoJsonString[\s\S]+?if \(geoJsonString\) \{ \}/)?.[0];
  const malformed = listing.replace('"AccidentId":"item-1"', '"AccidentId":unquoted');
  assert.equal(parseIncidents(malformed.replace("}</script>", `${secondBlock}\n}</script>`)).length, 1);
  const source = createToploSource({ fetch: async () => new Response("unavailable", { status: 503 }) });
  await assert.rejects(source.discoverItems(), /HTTP 503/);
  await source.close?.();
  for (const html of ["<html></html>", listing.replace("function parseAll()", "function unrelated()"), malformed, withGeometry(null)]) {
    const empty = createToploSource({ fetch: listingFetch(html) });
    await assert.rejects(empty.discoverItems(), /No incidents found/);
    await empty.close?.();
  }
});

test("reports malformed blocks, invalid features and coordinate corrections", () => {
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
  };
  parseIncidents(listing.replace('"AccidentId":"item-1"', '"AccidentId":unquoted'), warn);
  parseIncidents(withGeometry([
    { ...point, geometry: { type: "Point", coordinates: [999, 999] } },
    { ...point, geometry: { type: "Point", coordinates: [42.7, 23.32] } },
  ]), warn);
  assert.ok(warnings.some((message) => message.includes("Failed to parse")));
  assert.ok(warnings.some((message) => message.includes("invalid Toplo feature geometry")));
  assert.ok(warnings.some((message) => message.includes("Corrected swapped coordinates")));
});

test("passes cancellation through discovery and close aborts an active request", async () => {
  const external = new AbortController();
  const fetch = listingFetch();
  const source = createToploSource({ fetch, signal: external.signal });
  await source.discoverItems();
  external.abort();
  assert.equal(fetch.mock.calls[0]?.arguments[1]?.signal?.aborted, true);
  await source.close?.();

  const waiting = createToploSource({ fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => {
      reject(new Error("aborted"));
    });
  }) });
  const discovery = waiting.discoverItems();
  await waiting.close?.();
  await assert.rejects(discovery, /aborted/);
});

test("exposes the SDK factory and isolated CommonJS metadata", async () => {
  globalThis.fetch = listingFetch();
  const source = await createSource({ locality: "bg.sofia" });
  const item = (await source.discoverItems()).items[0]!;
  assert.deepEqual(await source.fetchItem(item), expected);
  await source.close?.();
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../dist/cjs/index.js").createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "toplo-bg",
    url: "https://toplo.bg/accidents-and-maintenance",
    name: "Топлофикация София",
    localities: ["bg.sofia"],
    emergent: true,
  });
});
