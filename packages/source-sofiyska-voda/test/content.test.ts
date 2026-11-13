import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContent, getFeatureUrl } from "../dist/esm/content.js";
import type { ArcGisFeature, LayerConfig } from "../dist/esm/types.js";

const layer: LayerConfig = {
  id: 2,
  name: "Текущи спирания",
  titlePrefix: "Текущо спиране",
};
const feature: ArcGisFeature = {
  attributes: {
    OBJECTID: 123,
    LOCATION: "ул. Тест",
    START_: Date.parse("2026-10-04T08:00:00Z"),
    ALERTEND: Date.parse("2026-10-04T12:00:00Z"),
    LASTUPDATE: Date.parse("2026-10-04T09:00:00Z"),
  },
  geometry: { x: 23.32, y: 42.7 },
};
const currentDate = new Date("2026-11-13T10:00:00.000Z");
const now = () => new Date(currentDate);

test("leaves platform fields to Obo while marking complete water content", () => {
  const content = buildContent(feature, layer, now);
  assert.ok(content);
  for (const field of ["url", "sourceType", "locality", "crawledAt", "processed"]) {
    assert.equal(Object.hasOwn(content, field), false);
  }
  assert.equal(content.deepLinkUrl, "");
  assert.deepEqual(content.categories, ["water"]);
  assert.equal(content.isRelevant, true);
});

test("preserves layer-specific historical ArcGIS identifiers", () => {
  const base = "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";
  assert.equal(getFeatureUrl(2, 123), `${base}/2/123`);
  assert.equal(getFeatureUrl(3, 123), `${base}/3/123`);
  assert.equal(getFeatureUrl(2, 0), `${base}/2/0`);
});

test("skips features without numeric identity or usable geometry", () => {
  for (const value of [
    { geometry: { x: 23.32, y: 42.7 } },
    { attributes: { OBJECTID: 1 } },
    { attributes: { OBJECTID: 1 }, geometry: null },
    { attributes: { OBJECTID: 1 }, geometry: {} },
    { attributes: { OBJECTID: 1 }, geometry: { paths: [[[23.32, 42.7]]] } },
    JSON.parse('{"attributes":{"OBJECTID":"123"},"geometry":{"x":23.32,"y":42.7}}'),
  ]) {
    assert.equal(buildContent(value, layer, now), null);
  }
});

test("preserves polygon precedence, coordinate order, dimensions and provider properties", () => {
  const content = buildContent({
    attributes: {
      OBJECTID: 1,
      ALERTID: "alert",
      ALERTTYPE: "  Авария  ",
      ACTIVESTATUS: "  In   Progress ",
      LOCATION: "  ул.   Тест ",
      SOFIADISTRICT: 0,
    },
    geometry: {
      rings: [[[23.32, 42.7, 5], [23.33, 42.7, 5], [23.33, 42.71, 5], [23.32, 42.7, 5]]],
      paths: [[[1, 2], [3, 4]]],
      x: 1,
      y: 2,
    },
  }, layer, now);
  assert.ok(content);
  assert.deepEqual(content.geoJson, {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[23.32, 42.7], [23.33, 42.7], [23.33, 42.71], [23.32, 42.7]]],
      },
      properties: {
        layerId: 2,
        layerName: "Текущи спирания",
        titlePrefix: "Текущо спиране",
        alertId: "alert",
        status: "In Progress",
        alertType: "Авария",
        location: "ул. Тест",
        district: 0,
      },
    }],
  });
  assert.equal(content.title, "Текущо спиране – ул. Тест – Авария");
  assert.equal(content.message.includes("Район на СО (ID)"), false);
});

test("keeps only the first path with at least two points", () => {
  const content = buildContent({
    attributes: { OBJECTID: 1 },
    geometry: {
      paths: [
        [[1, 2]],
        [[23.32, 42.7, 99], [23.33, 42.71, 99]],
        [[23.34, 42.72], [23.35, 42.73]],
      ],
      x: 1,
      y: 2,
    },
  }, layer, now);
  assert.ok(content);
  const collection = content.geoJson as { features: Array<{ geometry: unknown }> };
  assert.deepEqual(collection.features[0]?.geometry, {
    type: "LineString",
    coordinates: [[23.32, 42.7], [23.33, 42.71]],
  });
});

test("uses point geometry after empty or single-point paths and filters empty properties", () => {
  const content = buildContent({
    attributes: { OBJECTID: 1, ALERTID: null, ALERTTYPE: "", ACTIVESTATUS: "  ", LOCATION: null },
    geometry: { paths: [[[23.33, 42.71]]], x: 23.32, y: 42.7 },
  }, layer, now);
  assert.ok(content);
  assert.deepEqual(content.geoJson, {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [23.32, 42.7] },
      properties: { layerId: 2, layerName: "Текущи спирания", titlePrefix: "Текущо спиране" },
    }],
  });
  assert.equal(content.title, "Текущо спиране");
});

test("sanitizes repeated text and keeps plain versus Markdown line formatting", () => {
  const content = buildContent({
    attributes: {
      OBJECTID: 1,
      LOCATION: "  ул.   Тест ",
      DESCRIPTION: "ул. Тест",
      ACTIVESTATUS: "In Progress",
      CONTACT: "02/123",
    },
    geometry: { x: 23.32, y: 42.7 },
  }, layer, now);
  assert.ok(content);
  assert.equal(content.message, "ул. Тест\n\nКатегория: Текущи спирания\nСтатус: In Progress\nКонтакт: 02/123");
  assert.equal(content.markdownText, "ул. Тест\n\n**Категория:** Текущи спирания  \n**Статус:** In Progress  \n**Контакт:** 02/123");
});

test("uses the injected date formatter while publication and timespans remain ISO dates", () => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const content = buildContent(feature, layer, now, formatter);
  assert.ok(content);
  assert.ok(content.message.includes("Начало: 04/10/2026, 08:00"));
  assert.ok(content.markdownText?.includes("**Край:** 04/10/2026, 12:00"));
  assert.equal(content.datePublished, "2026-10-04T09:00:00.000Z");
});

test("falls back publication dates from LASTUPDATE to START_ to the current clock", () => {
  const cases = [
    { attributes: { LASTUPDATE: 0 }, expected: "1970-01-01T00:00:00.000Z" },
    { attributes: { LASTUPDATE: null, START_: Date.parse("2026-10-04T08:00:00Z") }, expected: "2026-10-04T08:00:00.000Z" },
    { attributes: { LASTUPDATE: Number.NaN, START_: Number.POSITIVE_INFINITY }, expected: currentDate.toISOString() },
    { attributes: {}, expected: currentDate.toISOString() },
  ];
  for (const { attributes, expected } of cases) {
    const content = buildContent({ attributes: { OBJECTID: 1, ...attributes }, geometry: { x: 23.32, y: 42.7 } }, layer, now);
    assert.ok(content);
    assert.equal(content.datePublished, expected);
    assert.equal(content.timespanStart, expected);
    assert.equal(content.timespanEnd, expected);
  }
});

test("preserves both valid bounds including the 2025 boundary and reversed dates", () => {
  const start = Date.parse("2025-01-01T00:00:00Z");
  const end = Date.parse("2026-10-04T12:00:00Z");
  for (const [START_, ALERTEND] of [[start, end], [end, start]]) {
    const content = buildContent({ attributes: { OBJECTID: 1, START_, ALERTEND }, geometry: { x: 23.32, y: 42.7 } }, layer, now);
    assert.ok(content);
    assert.equal(content.timespanStart, new Date(START_!).toISOString());
    assert.equal(content.timespanEnd, new Date(ALERTEND!).toISOString());
  }
});

test("falls back both timespan bounds when either one is missing or before 2025", () => {
  const valid = Date.parse("2026-10-04T08:00:00Z");
  const old = Date.parse("2024-12-31T23:59:59.999Z");
  const LASTUPDATE = Date.parse("2026-10-05T09:00:00Z");
  for (const values of [
    { START_: valid },
    { ALERTEND: valid },
    { START_: valid, ALERTEND: old },
    { START_: old, ALERTEND: valid },
    { START_: old, ALERTEND: old },
  ]) {
    const content = buildContent({ attributes: { OBJECTID: 1, LASTUPDATE, ...values }, geometry: { x: 23.32, y: 42.7 } }, layer, now);
    assert.ok(content);
    assert.equal(content.timespanStart, "2026-10-05T09:00:00.000Z");
    assert.equal(content.timespanEnd, "2026-10-05T09:00:00.000Z");
  }
});

test("warns for truthy invalid provider timestamps and stays quiet for missing, null or zero values", () => {
  const warnings: Array<[string, Readonly<Record<string, unknown>> | undefined]> = [];
  const warn = (message: string, context?: Readonly<Record<string, unknown>>) => {
    warnings.push([message, context]);
  };
  const LASTUPDATE = Date.parse("2026-10-05T09:00:00Z");
  for (const attributes of [
    {},
    { START_: null, ALERTEND: null },
    { START_: 0, ALERTEND: 0 },
  ]) {
    const content = buildContent({
      attributes: { OBJECTID: 1, LASTUPDATE, ...attributes },
      geometry: { x: 23.32, y: 42.7 },
    }, layer, now, undefined, warn);
    assert.equal(content?.timespanStart, "2026-10-05T09:00:00.000Z");
    assert.equal(content?.timespanEnd, "2026-10-05T09:00:00.000Z");
  }
  assert.deepEqual(warnings, []);
  const START_ = 1;
  const ALERTEND = 2;
  const content = buildContent({
    attributes: { OBJECTID: 1, LASTUPDATE, START_, ALERTEND },
    geometry: { x: 23.32, y: 42.7 },
  }, layer, now, undefined, warn);
  assert.equal(content?.timespanStart, "2026-10-05T09:00:00.000Z");
  assert.equal(content?.timespanEnd, "2026-10-05T09:00:00.000Z");
  assert.deepEqual(warnings, [
    ["START_ outside valid range", { sourceType: "sofiyska-voda", objectId: 1, startValue: START_ }],
    ["ALERTEND outside valid range", { sourceType: "sofiyska-voda", objectId: 1, alertEnd: ALERTEND }],
  ]);
});
