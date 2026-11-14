import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload } from "@oboapp/source-sdk";
import { createErmZapadSource, type ErmZapadDependencies } from "../dist/esm/erm-zapad.js";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";
import { discoverMunicipalities } from "../dist/esm/parser.js";
import type { RawIncident } from "../dist/esm/types.js";

const originalTimezone = process.env.TZ;
process.env.TZ = "UTC";
process.once("exit", () => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

const now = new Date("2026-10-04T12:30:00.000Z");
const listing = readFileSync(new URL("./fixtures/municipalities.html", import.meta.url), "utf8");
const liveListing = readFileSync(new URL("./fixtures/live-sofia-city-card.html", import.meta.url), "utf8");
const provider = JSON.parse(readFileSync(new URL("./fixtures/provider.json", import.meta.url), "utf8")) as {
  municipalities: { code: string; name: string }[];
  responses: Record<string, Record<string, RawIncident>>;
};
const expected = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8")) as {
  identifier: string;
  content: Record<string, unknown>;
}[];
const firstIdentifier = "https://info.ermzapad.bg/incidents/SF_0001";

afterEach(() => {
  mock.restoreAll();
});

function requestFixture(html = listing, responses: Record<string, unknown> = provider.responses) {
  const fetch = mock.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (init?.method !== "POST") {
      return new Response(html);
    }
    const code = new URLSearchParams(String(init.body)).get("gm_obstina")!;
    const payload = Object.hasOwn(responses, code) ? responses[code] : {};
    return new Response(`\uFEFF${JSON.stringify(payload)}`, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  });
  const delay = mock.fn(async (milliseconds: number, signal?: AbortSignal) => {
    void milliseconds;
    void signal;
  });
  const warn = mock.fn<(message: string) => void>();
  const dependencies: ErmZapadDependencies = { fetch, delay, warn, now: () => now };
  return { fetch, delay, warn, dependencies };
}

test("collects every municipality before globally choosing literal historical identifiers", async () => {
  const fixture = requestFixture();
  const source = createErmZapadSource(fixture.dependencies);
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: expected.map(({ identifier }) => ({ identifier })) });
  for (const item of expected) {
    assert.deepEqual(await source.fetchItem({ identifier: item.identifier }), item.content);
  }
  assert.equal(fixture.fetch.mock.callCount(), 3);
  assert.equal(fixture.delay.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.calls[0]?.arguments[0], 2_000);
  assert.equal(fixture.delay.mock.calls[0]?.arguments[1]?.aborted, false);
  assert.equal(fixture.warn.mock.callCount(), 0);
  assert.deepEqual(await source.fetchItem(page.items[0]!), expected[0]!.content);
  assert.equal(fixture.fetch.mock.callCount(), 3);
  await source.close?.();
});

test("preserves the provider POST contract, MIME mismatch and UTF-8 BOM", async () => {
  const fixture = requestFixture();
  const source = createErmZapadSource(fixture.dependencies);
  await source.discoverItems();
  for (const call of fixture.fetch.mock.calls) {
    assert.equal(call.arguments[0], "https://info.ermzapad.bg/webint/vok/avplan.php");
    assert.equal(call.arguments[1]?.signal?.aborted, false);
  }
  assert.equal(fixture.fetch.mock.calls[0]?.arguments[1]?.method, undefined);
  assert.deepEqual(fixture.fetch.mock.calls[1]?.arguments[1]?.headers, {
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  });
  assert.equal(fixture.fetch.mock.calls[1]?.arguments[1]?.body, "action=draw&gm_obstina=SOF1&lat=0&lon=0");
  assert.equal(fixture.fetch.mock.calls[2]?.arguments[1]?.body, "action=draw&gm_obstina=SOF2&lat=0&lon=0");
  await source.close?.();
  assert.ok(fixture.fetch.mock.calls.every((call) => call.arguments[1]?.signal?.aborted));
});

test("parses the captured Sofia-city card without selecting the adjacent Sofia region", () => {
  assert.deepEqual(discoverMunicipalities(listing), provider.municipalities);
  assert.deepEqual(discoverMunicipalities(liveListing), [
    { code: "SOF44", name: "ВИТОША" },
    { code: "SOF15", name: "ИСКЪР" },
  ]);
});

test("preserves legacy municipality selector fallbacks and ignores unrelated list items", () => {
  const html = `<div class="card-body"><h5 class="card-title">Област София-град</h5>
    <ul class="list-group">
      <li>Без код</li>
      <li onclick="other('NO')">Друго действие</li>
      <li onclick="show_obstina('EMPTY','SOF')"></li>
      <li onclick="show_obstina('FALLBACK','SOF')">Име без префикс</li>
      <li onclick="show_obstina('NORMAL','SOF')">ОБЩИНА ИСКЪР</li>
    </ul></div>`;
  assert.deepEqual(discoverMunicipalities(html), [
    { code: "FALLBACK", name: "Име без префикс" },
    { code: "NORMAL", name: "ИСКЪР" },
  ]);
  assert.deepEqual(discoverMunicipalities("<h5 class='card-title'>Област София-град</h5>"), []);
  assert.deepEqual(discoverMunicipalities("<html><body>Няма активни общини</body></html>"), []);
});

test("retains both real Iskar identifiers when the affected-cities text differs", async () => {
  const fixture = requestFixture(liveListing, {
    SOF44: JSON.parse(readFileSync(new URL("./fixtures/live-sof44-incidents.json", import.meta.url), "utf8")),
    SOF15: JSON.parse(readFileSync(new URL("./fixtures/live-sof15-incidents.json", import.meta.url), "utf8")),
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual((await source.discoverItems()).items, [
    { identifier: "https://info.ermzapad.bg/incidents/SF_3400" },
    { identifier: "https://info.ermzapad.bg/incidents/SF_7498" },
    { identifier: "https://info.ermzapad.bg/incidents/SF_7498_11" },
  ]);
  const content = await source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/SF_7498" });
  const geometry = JSON.parse(String(content.geoJson)) as { features: { geometry: { coordinates: number[] } }[] };
  assert.deepEqual(geometry.features[0]?.geometry.coordinates, [23.405539, 42.664446]);
  assert.equal(content.datePublished, "2026-11-14T11:16:00.000Z");
  assert.equal(content.timespanEnd, "2026-11-14T16:30:00.000Z");
  await source.close?.();
});

test("retains byte-for-byte provider identifiers and isolates source-instance snapshots", async () => {
  const fixture = requestFixture(listing, {
    SOF1: { incident: { ...provider.responses.SOF1!.first!, ceo: "Case%2fItem?x=1&y=2" } },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  const other = createErmZapadSource(fixture.dependencies);
  const page = await source.discoverItems();
  assert.deepEqual(page.items, [{ identifier: "https://info.ermzapad.bg/incidents/Case%2fItem?x=1&y=2" }]);
  await assert.rejects(other.fetchItem(page.items[0]!), /Missing/);
  await assert.rejects(source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/case%2fitem?x=1&y=2" }), /Missing/);
  await source.close?.();
  await other.close?.();
});

test("keeps large incident text outside the SDK discovery payload limit", async () => {
  const large = "София ".repeat(MAX_DISCOVERY_PAYLOAD_BYTES);
  const fixture = requestFixture(listing, {
    SOF1: { incident: { ...provider.responses.SOF1!.first!, city_name: large } },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  const item = (await source.discoverItems()).items[0]!;
  assert.deepEqual(item, { identifier: "https://info.ermzapad.bg/incidents/SF_0009" });
  assert.ok(serializeDiscoveryPayload(item).length < 256);
  assert.ok((await source.fetchItem(item)).message.length > MAX_DISCOVERY_PAYLOAD_BYTES);
  await source.close?.();
});

test("returns no candidates and makes no incident requests when the listing has no active municipalities", async () => {
  const fixture = requestFixture("<html><body>Няма активни общини</body></html>");
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  assert.equal(fixture.fetch.mock.callCount(), 1);
  assert.equal(fixture.delay.mock.callCount(), 0);
  await source.close?.();
});

test("skips the provider's inactive-municipality placeholder and malformed incident entries", async () => {
  const fixture = requestFixture(listing, {
    SOF1: { 1: { cities: "" }, 2: null, 3: "error", 4: { ...provider.responses.SOF1!.first!, lat: "invalid" } },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  assert.equal(fixture.warn.mock.callCount(), 4);
  assert.match(fixture.warn.mock.calls[0]?.arguments[0] ?? "", /malformed/);
  assert.match(fixture.warn.mock.calls[3]?.arguments[0] ?? "", /coordinates/);
  await source.close?.();
});

test("skips missing event IDs while preserving unrelated valid candidates", async () => {
  const fixture = requestFixture(listing, {
    SOF1: { empty: { ...provider.responses.SOF1!.first!, ceo: "" } },
    SOF2: { valid: provider.responses.SOF1!.grouped },
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual((await source.discoverItems()).items, [{ identifier: "https://info.ermzapad.bg/incidents/SF_0010" }]);
  assert.match(fixture.warn.mock.calls[0]?.arguments[0] ?? "", /event ID/);
  await source.close?.();
});

test("filters invalid event points while retaining the first original pin's text and date metadata", async () => {
  const fixture = requestFixture(listing, {
    SOF1: {
      invalidFirst: {
        ...provider.responses.SOF1!.first!,
        ceo: "SF_MIXED",
        lat: "999",
        city_name: "ПЪРВА МЕТАИНФОРМАЦИЯ",
        begin_event: "04.10.2026 08:00",
        end_event: "04.10.2026 09:00",
      },
    },
    SOF2: {
      validSecond: {
        ...provider.responses.SOF1!.grouped!,
        ceo: "SF_MIXED",
        city_name: "ВТОРА МЕТАИНФОРМАЦИЯ",
      },
    },
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual((await source.discoverItems()).items, [{ identifier: "https://info.ermzapad.bg/incidents/SF_MIXED" }]);
  const content = await source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/SF_MIXED" });
  assert.equal(content.title, "планирано - ПЪРВА МЕТАИНФОРМАЦИЯ - SF_MIXED");
  assert.equal(content.message, "планирано\n\nНаселено място: ПЪРВА МЕТАИНФОРМАЦИЯ\nНачало: 04.10.2026 08:00\nКрай: 04.10.2026 09:00\nМрежов код: SF_MIXED");
  assert.equal(content.datePublished, "2026-10-04T08:00:00.000Z");
  assert.equal(content.timespanStart, "2026-10-04T08:00:00.000Z");
  assert.equal(content.timespanEnd, "2026-10-04T09:00:00.000Z");
  assert.deepEqual(JSON.parse(String(content.geoJson)), {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [23.38, 42.65] },
      properties: {
        eventId: "SF_MIXED",
        cityName: "ВТОРА МЕТАИНФОРМАЦИЯ",
        eventType: "непланирано",
        startTime: "04.10.2026 09:00",
        endTime: "04.10.2026 11:00",
      },
    }],
  });
  await source.close?.();
});

test("skips all-invalid coordinate groups as a healthy empty scan", async () => {
  const fixture = requestFixture(listing, {
    SOF1: {
      latitude: { ...provider.responses.SOF1!.first!, ceo: "SF_LAT", lat: "999" },
      longitude: { ...provider.responses.SOF1!.first!, ceo: "SF_LON", lon: "181" },
      infinity: { ...provider.responses.SOF1!.first!, ceo: "SF_INFINITY", lat: "Infinity" },
    },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  await assert.rejects(source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/SF_LAT" }), /Missing/);
  await source.close?.();
});

test("retains globally valid swapped Sofia coordinates for platform repair", async () => {
  const fixture = requestFixture(listing, {
    SOF1: { swapped: { ...provider.responses.SOF1!.first!, ceo: "SF_SWAPPED", lat: "23.32", lon: "42.7" } },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  const item = (await source.discoverItems()).items[0]!;
  assert.deepEqual(item, { identifier: "https://info.ermzapad.bg/incidents/SF_SWAPPED" });
  const content = await source.fetchItem(item);
  const geometry = JSON.parse(String(content.geoJson)) as { features: { geometry: { coordinates: number[] } }[] };
  assert.deepEqual(geometry.features[0]?.geometry.coordinates, [42.7, 23.32]);
  await source.close?.();
});

for (const field of ["begin_event", "end_event", "city_name", "cities"] as const) {
  test(`preserves omitted versus empty ${field} in historical deduplication`, async () => {
    const empty: Partial<RawIncident> = {
      ...provider.responses.SOF1!.first!,
      ceo: "SF_EMPTY",
      begin_event: "",
      end_event: "",
      city_name: "",
      cities: "",
    };
    const omitted: Partial<RawIncident> = { ...empty, ceo: "SF_OMITTED" };
    delete omitted[field];
    const fixture = requestFixture(listing, { SOF1: { omitted, empty }, SOF2: {} });
    const source = createErmZapadSource(fixture.dependencies);
    assert.deepEqual((await source.discoverItems()).items, [
      { identifier: "https://info.ermzapad.bg/incidents/SF_OMITTED" },
      { identifier: "https://info.ermzapad.bg/incidents/SF_EMPTY" },
    ]);
    await source.close?.();
  });
}

test("accepts omitted optional text fields and preserves their JSON property omission", async () => {
  const fixture = requestFixture(listing, {
    SOF1: { minimal: { ceo: "SF_MINIMAL", lat: "42.7", lon: "23.32", typedist: "непланирано" } },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  const item = (await source.discoverItems()).items[0]!;
  assert.deepEqual(item, { identifier: "https://info.ermzapad.bg/incidents/SF_MINIMAL" });
  const content = await source.fetchItem(item);
  assert.equal(content.title, "непланирано - SF_MINIMAL");
  assert.equal(content.message, "непланирано\n\nМрежов код: SF_MINIMAL");
  assert.equal(content.markdownText, "**непланирано**\n\n**Мрежов код:** SF_MINIMAL");
  assert.equal(content.datePublished, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanStart, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanEnd, "2026-10-04T12:30:00.000Z");
  assert.deepEqual(JSON.parse(String(content.geoJson)), {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [23.32, 42.7] },
      properties: { eventId: "SF_MINIMAL", eventType: "непланирано" },
    }],
  });
  await source.close?.();
});

test("isolates present non-string optional fields from unrelated valid incidents", async () => {
  const invalid = Object.fromEntries(["begin_event", "end_event", "city_name", "cities"].map((field) => {
    return [field, { ...provider.responses.SOF1!.first!, [field]: null }];
  }));
  const fixture = requestFixture(listing, {
    SOF1: { ...invalid, valid: provider.responses.SOF1!.first },
    SOF2: {},
  });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual((await source.discoverItems()).items, [{ identifier: "https://info.ermzapad.bg/incidents/SF_0009" }]);
  assert.equal(fixture.warn.mock.callCount(), 4);
  await source.close?.();
});

for (const stage of ["listing", "municipality"]) {
  for (const status of [403, 404, 429, 503]) {
    test(`rejects ${stage} HTTP ${status} and permits a later fresh scan`, async () => {
      const fixture = requestFixture();
      fixture.fetch.mock.mockImplementationOnce(async () => new Response("unavailable", { status }), stage === "listing" ? 0 : 1);
      const source = createErmZapadSource(fixture.dependencies);
      await assert.rejects(source.discoverItems(), new RegExp(`HTTP ${status}`));
      await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /Missing/);
      assert.deepEqual((await source.discoverItems()).items, expected.map(({ identifier }) => ({ identifier })));
      await source.close?.();
    });
  }
}

test("fails an incomplete municipality scan before exposing the higher-ID partial result", async () => {
  const fixture = requestFixture();
  const source = createErmZapadSource(fixture.dependencies);
  await source.discoverItems();
  fixture.fetch.mock.mockImplementationOnce(async () => new Response("unavailable", { status: 503 }), 5);
  await assert.rejects(source.discoverItems(), /HTTP 503/);
  await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /Missing/);
  await assert.rejects(source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/SF_0009" }), /Missing/);
  assert.deepEqual((await source.discoverItems()).items, expected.map(({ identifier }) => ({ identifier })));
  await source.close?.();
});

test("clears cached incident content when a later listing has no active municipalities", async () => {
  const fixture = requestFixture();
  const source = createErmZapadSource(fixture.dependencies);
  await source.discoverItems();
  fixture.fetch.mock.mockImplementationOnce(async () => new Response("<html></html>"), 3);
  assert.deepEqual(await source.discoverItems(), { items: [] });
  await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /Missing/);
  await source.close?.();
});

for (const payload of [null, "provider error", 1]) {
  test(`rejects malformed municipality JSON shape ${JSON.stringify(payload)}`, async () => {
    const fixture = requestFixture(listing, { SOF1: payload });
    const source = createErmZapadSource(fixture.dependencies);
    await assert.rejects(source.discoverItems(), /Invalid ERM Zapad incidents/);
    await source.close?.();
  });
}

test("propagates JSON parse and network errors without caching incomplete incidents", async () => {
  const fixture = requestFixture();
  fixture.fetch.mock.mockImplementationOnce(async () => new Response("broken JSON"), 1);
  const source = createErmZapadSource(fixture.dependencies);
  await assert.rejects(source.discoverItems(), SyntaxError);
  fixture.fetch.mock.mockImplementationOnce(async () => {
    throw new Error("network failed");
  }, 2);
  await assert.rejects(source.discoverItems(), /network failed/);
  await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /Missing/);
  await source.close?.();
});

test("accepts legacy empty arrays and incident arrays returned by the provider", async () => {
  const incident: Partial<RawIncident> = { ...provider.responses.SOF1!.first! };
  delete incident.type_event;
  delete incident.grid_id;
  delete incident.points;
  const fixture = requestFixture(listing, { SOF1: [incident], SOF2: [] });
  const source = createErmZapadSource(fixture.dependencies);
  assert.deepEqual((await source.discoverItems()).items, [{ identifier: "https://info.ermzapad.bg/incidents/SF_0009" }]);
  assert.equal((await source.fetchItem({ identifier: "https://info.ermzapad.bg/incidents/SF_0009" })).title, "планирано - София - SF_0009");
  await source.close?.();
});

test("default rate limiting and warning reporting handle the inactive-provider placeholder", async () => {
  const fixture = requestFixture(listing, { SOF1: { 1: { cities: "" } }, SOF2: {} });
  mock.method(globalThis, "fetch", fixture.fetch);
  const warn = mock.method(globalThis.console, "warn", () => {});
  const source = createErmZapadSource();
  assert.deepEqual(await source.discoverItems(), { items: [] });
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(fixture.fetch.mock.callCount(), 3);
  await source.close?.();
});

test("rejects pagination cursors before starting a provider request", async () => {
  const fixture = requestFixture();
  const source = createErmZapadSource(fixture.dependencies);
  await assert.rejects(source.discoverItems("unexpected"), /pagination/);
  assert.equal(fixture.fetch.mock.callCount(), 0);
  await source.close?.();
});

test("rejects pre-cancelled scans and passes cancellation to active requests", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const fixture = requestFixture();
  const source = createErmZapadSource({ ...fixture.dependencies, signal: controller.signal });
  await assert.rejects(source.discoverItems(), /cancelled/);
  assert.equal(fixture.fetch.mock.callCount(), 0);
  await source.close?.();
});

test("closing the source aborts an in-flight request and prevents later use", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const source = createErmZapadSource({
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener("abort", () => {
        reject(requestSignal?.reason);
      }, { once: true });
    }),
  });
  const discovery = source.discoverItems();
  await source.close?.();
  await assert.rejects(discovery, /closed/);
  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(source.discoverItems(), /closed/);
  await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /closed/);
  await source.close?.();
});

test("cancellation during rate limiting aborts the incomplete scan", async () => {
  const controller = new AbortController();
  const fixture = requestFixture();
  const source = createErmZapadSource({
    ...fixture.dependencies,
    signal: controller.signal,
    delay: async () => {
      controller.abort(new Error("cancelled between municipalities"));
    },
  });
  await assert.rejects(source.discoverItems(), /cancelled between municipalities/);
  assert.equal(fixture.fetch.mock.callCount(), 2);
  await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /cancelled/);
  await source.close?.();
});

test("external cancellation aborts an active request", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const source = createErmZapadSource({
    signal: controller.signal,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener("abort", () => {
        reject(requestSignal?.reason);
      }, { once: true });
    }),
  });
  const discovery = source.discoverItems();
  controller.abort(new Error("external cancellation"));
  await assert.rejects(discovery, /external cancellation/);
  assert.equal(requestSignal?.aborted, true);
  await source.close?.();
});

for (const stage of ["listing", "JSON"]) {
  test(`cancellation during ${stage} body reading discards the snapshot`, async () => {
    const controller = new AbortController();
    const fixture = requestFixture();
    const response = new Response(stage === "listing" ? listing : JSON.stringify(provider.responses.SOF1));
    if (stage === "listing") {
      mock.method(response, "text", async () => {
        controller.abort(new Error("cancelled during body"));
        return listing;
      });
    } else {
      mock.method(response, "json", async () => {
        controller.abort(new Error("cancelled during body"));
        return provider.responses.SOF1;
      });
    }
    fixture.fetch.mock.mockImplementationOnce(async () => response, stage === "listing" ? 0 : 1);
    const source = createErmZapadSource({ ...fixture.dependencies, signal: controller.signal });
    await assert.rejects(source.discoverItems(), /cancelled during body/);
    await assert.rejects(source.fetchItem({ identifier: firstIdentifier }), /cancelled/);
    await source.close?.();
  });
}

test("sets a bounded request timeout and forwards its cancellation", async () => {
  const timeout = new AbortController();
  const timeoutCall = mock.method(AbortSignal, "timeout", () => timeout.signal);
  const source = createErmZapadSource({
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason);
      }, { once: true });
    }),
  });
  const discovery = source.discoverItems();
  assert.equal(timeoutCall.mock.calls[0]?.arguments[0], 30_000);
  timeout.abort(new Error("request timed out"));
  await assert.rejects(discovery, /request timed out/);
  await source.close?.();
});

test("public factory uses HTTP and rejects unsupported localities", async () => {
  const fixture = requestFixture(listing.replace("<li onclick=\"show_obstina('SOF2','SOF'); this.disabled = true;\">община ВТОРИ РАЙОН</li>", ""));
  mock.method(globalThis, "fetch", fixture.fetch);
  const source = await createSource({ locality: "bg.sofia" });
  assert.deepEqual((await source.discoverItems()).items, [
    { identifier: "https://info.ermzapad.bg/incidents/SF_0009" },
    { identifier: "https://info.ermzapad.bg/incidents/SF_0010" },
  ]);
  assert.equal(fixture.fetch.mock.callCount(), 2);
  await source.close?.();
  assert.throws(() => createSource({ locality: "bg.plovdiv" }), /Unsupported ERM Zapad locality/);
  const controller = new AbortController();
  controller.abort(new Error("factory cancelled"));
  const cancelled = await createSource({ locality: "bg.sofia", signal: controller.signal });
  await assert.rejects(cancelled.discoverItems(), /factory cancelled/);
  await cancelled.close?.();
});

test("CommonJS exports are usable and metadata loads without collection code", () => {
  const require = createRequire(import.meta.url);
  const commonjs = require("../dist/cjs/index.js") as { createSource: typeof createSource };
  assert.equal(typeof commonjs.createSource, "function");
  assert.deepEqual(require("../dist/cjs/metadata.js").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "erm-zapad",
    url: "https://info.ermzapad.bg/webint/vok/avplan.php",
    name: "ЕРМ Запад",
    localities: ["bg.sofia"],
    emergent: true,
  });
  const output = execFileSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    require("./dist/cjs/metadata.js");
    assert.equal(Object.keys(require.cache).some((file) => /linkedom|playwright|erm-zapad[.]js/.test(file)), false);
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(output, "");
});
