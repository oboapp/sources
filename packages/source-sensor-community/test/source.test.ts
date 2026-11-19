import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createSource, type Reading } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";

const bounds = { west: 23, east: 23.02, south: 42, north: 42.02 };
const locality = "bg.sofia";
const minute = 60_000;

function readings(now: Date, age: number, p2: number, p1: number): Reading[] {
  return [101, 102, 103].map((sensorId) => ({
    sensorId, p2, p1, lng: 23.01, lat: 42.01, timestamp: new Date(now.getTime() - age * minute),
  }));
}

test("uses the inclusive four-hour input and returns a complete literal half-hour alert", async () => {
  let end: Date | undefined;
  const source = createSource({ locality }, {
    bounds,
    async readReadings(key, start, now) {
      assert.equal(key, locality);
      assert.equal(now.getTime() - start.getTime(), 240 * minute);
      end = now;
      return readings(now, 45, 50, 100);
    },
  });
  const page = await source.discoverItems();
  assert.ok(end);
  const identifier = `sensor-community://bg.sofia/r0c0/${Math.floor(end.getTime() / (30 * minute)) * 30 * minute}`;
  assert.deepEqual(page, { items: [{ identifier }] });
  assert.deepEqual(await source.fetchItem({ identifier }), {
    title: "Влошено качество на въздуха – r0c0",
    message: "Рязко влошаване на качеството на въздуха. Европейски индекс: Много лошо. " +
      "PM2.5: 50.0, PM10: 100 μg/m³. Измерено от 3 сензора от мрежата sensor.community. " +
      "Ограничи престоя на открито, особено при дихателни или сърдечни заболявания.",
    markdownText: "**Рязко влошаване** на качеството на въздуха\n\n" +
      "Данните от гражданската мрежа [sensor.community](https://sensor.community/) показват влошаване " +
      "на качеството на въздуха в този район.\n\n- Европейски индекс за качество на въздуха: **Много лошо**\n" +
      "- PM2.5: 50.0 μg/m³\n- PM10: 100 μg/m³\n- Измерено от 3 независими сензора\n\n" +
      "⚠️ Ограничи престоя на открито, особено при дихателни или сърдечни заболявания.",
    geoJson: { type: "FeatureCollection", features: [{
      type: "Feature", properties: {}, geometry: {
        type: "Polygon", coordinates: [[[23, 42], [23.02, 42], [23.02, 42.02], [23, 42.02], [23, 42]]],
      },
    }] },
    categories: ["air-quality"], deepLinkUrl: "", isRelevant: true,
    datePublished: end.toISOString(), timespanStart: new Date(end.getTime() - 120 * minute).toISOString(),
    timespanEnd: end.toISOString(),
  });
  await source.close?.();
  await assert.rejects(source.fetchItem({ identifier }), /Unknown/);
});

const quietCases: [string, (now: Date) => Reading[]][] = [
  ["empty input", () => []],
  ["stale by one millisecond", (now) => readings(new Date(now.getTime() - 1), 45, 60, 110)],
  ["two sensors", (now) => readings(now, 0, 60, 110).slice(0, 2)],
  ["one sensor reporting three times", (now) => readings(now, 0, 60, 110).map((r) => ({ ...r, sensorId: 1 }))],
  ["outside the grid", (now) => readings(now, 0, 60, 110).map((r) => ({ ...r, lng: 24 }))],
  ["future timestamps", (now) => readings(now, -1, 60, 110)],
  ["earlier than the window", (now) => [...readings(now, 0, 30, 60), ...readings(now, 241, 30, 60)]],
  ["two halves below threshold", (now) => [...readings(now, 0, 0, 0), ...readings(now, 200, 0, 0)]],
  ["midpoint only belongs to current half", (now) => [...readings(now, 0, 30, 60), ...readings(now, 120, 30, 60)]],
  ["hard cap and invalid concentrations", (now) => [
    ...readings(now, 0, 50, 1000), ...readings(now, 0, Number.NaN, 100), ...readings(now, 0, 50, -1),
  ]],
  ["IQR filter leaves two distinct sensors", (now) => {
    const [a, b, c] = readings(now, 0, 60, 110);
    return [a!, b!, a!, b!, a!, { ...c!, p1: 999, p2: 999 }];
  }],
];
for (const [name, makeReadings] of quietCases) {
  test(`returns no alerts for ${name}`, async () => {
    const source = createSource({ locality }, {
      bounds,
      async readReadings(_key, _start, end) {
        return makeReadings(end);
      },
    });
    assert.deepEqual(await source.discoverItems(), { items: [] });
  });
}

test("a poor previous half and a poor current half produce a sustained alert", async () => {
  const source = createSource({ locality }, {
    bounds,
    async readReadings(_key, _start, end) {
      return [...readings(end, 0, 30, 60), ...readings(end, 240, 30, 60)];
    },
  });
  const page = await source.discoverItems();
  assert.equal(page.items.length, 1);
  const content = await source.fetchItem(page.items[0]!);
  assert.match(content.message, /^Продължително влошаване/);
  assert.match(content.message, /Европейски индекс: Лошо/);
  assert.match(content.message, /Хора с дихателни/);
});

test("fails a lost input read and discards obsolete scan results", async () => {
  let fail = false;
  const source = createSource({ locality }, {
    bounds,
    async readReadings(_key, _start, end) {
      if (fail) {
        throw new Error("Readings unavailable");
      }
      return readings(end, 0, 80, 150);
    },
  });
  const first = await source.discoverItems();
  assert.match((await source.fetchItem(first.items[0]!)).message, /Изключително лошо/);
  fail = true;
  await assert.rejects(source.discoverItems(), /Readings unavailable/);
  await assert.rejects(source.fetchItem(first.items[0]!), /Unknown/);
});

test("supports CommonJS and isolated catalog metadata", () => {
  const require = createRequire(import.meta.url);
  assert.deepEqual(require("@oboapp/source-sensor-community/metadata").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "sensor-community", url: "https://sensor.community/", name: "sensor.community",
    localities: [locality], experimental: true, emergent: true,
  });
  assert.equal(typeof require("@oboapp/source-sensor-community").createSource, "function");
});
