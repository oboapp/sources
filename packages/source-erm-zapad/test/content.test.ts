import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContent } from "../dist/esm/content.js";
import { buildGeoJSON, buildMarkdownMessage, buildPlainTextMessage, buildTitle } from "../dist/esm/builders.js";
import { parseBulgarianDateTime } from "../dist/esm/date-utils.js";
import { deduplicatePinRecords } from "../dist/esm/deduplication.js";
import { extractPinRecords } from "../dist/esm/extractors.js";
import { groupPinsByEventId } from "../dist/esm/grouping.js";
import { parseTimespans } from "../dist/esm/timespan-parsing.js";
import type { PinRecord, RawIncident } from "../dist/esm/types.js";

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
const fixture = JSON.parse(readFileSync(new URL("./fixtures/provider.json", import.meta.url), "utf8")) as {
  responses: Record<string, Record<string, RawIncident>>;
};
const expected = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8")) as {
  identifier: string;
  content: Record<string, unknown>;
}[];

function pin(overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    lat: 42.700932,
    lon: 23.323422,
    eventId: "SF_0001",
    typedist: "планирано",
    city_name: "София",
    cities: "София",
    begin_event: "04.10.2026 10:00",
    end_event: "04.10.2026 12:00",
    ...overrides,
  };
}

test("matches independently frozen legacy content after global deduplication and grouping", () => {
  const pins = Object.values(fixture.responses).flatMap((response) => {
    return Object.values(response).flatMap(extractPinRecords);
  });
  const grouped = groupPinsByEventId(deduplicatePinRecords(pins));
  assert.deepEqual([...grouped.keys()], ["SF_0001", "SF_0010"]);
  assert.deepEqual(buildContent(grouped.get("SF_0001")!, now), expected[0]!.content);
  assert.deepEqual(buildContent(grouped.get("SF_0010")!, now), expected[1]!.content);
  assert.equal(grouped.get("SF_0010")?.length, 2);
});

test("rounds the provider center to six decimals and ignores polygon vertices", () => {
  assert.deepEqual(extractPinRecords(fixture.responses.SOF1!.first!), [pin({ eventId: "SF_0009" })]);
  for (const coordinates of [{ lat: "invalid" }, { lon: "" }, { lat: "", lon: "" }]) {
    assert.deepEqual(extractPinRecords({ ...fixture.responses.SOF1!.first!, ...coordinates }), []);
  }
});

test("deduplicates every legacy key field and retains the lowest alphanumeric event ID", () => {
  assert.deepEqual(deduplicatePinRecords([]), []);
  const first = pin({ eventId: "SF_10" });
  const lower = pin({ eventId: "SF_1" });
  assert.equal(deduplicatePinRecords([first, lower, pin({ eventId: "SF_2" })])[0], lower);
  assert.equal(deduplicatePinRecords([lower, { ...lower }])[0], lower);
  const different: Partial<PinRecord>[] = [
    { lat: 42.700933 },
    { lon: 23.323423 },
    { typedist: "непланирано" },
    { begin_event: "04.10.2026 10:01" },
    { end_event: "04.10.2026 12:01" },
    { city_name: "Друго място" },
    { cities: "Други места" },
  ];
  for (const change of different) {
    assert.equal(deduplicatePinRecords([lower, pin(change)]).length, 2);
  }
});

test("groups surviving points in their original order", () => {
  const first = pin();
  const second = pin({ lat: 42.71 });
  const other = pin({ eventId: "SF_0002" });
  const grouped = groupPinsByEventId([first, other, second]);
  assert.deepEqual([...grouped], [["SF_0001", [first, second]], ["SF_0002", [other]]]);
  assert.equal(groupPinsByEventId([]).size, 0);
});

test("preserves empty optional labels and complete geometry properties", () => {
  const minimal = pin({ city_name: "", begin_event: "", end_event: "", typedist: "Авария" });
  assert.equal(buildTitle(minimal), "Авария - SF_0001");
  assert.equal(buildPlainTextMessage(minimal), "Авария\n\nМрежов код: SF_0001");
  assert.equal(buildMarkdownMessage(minimal), "**Авария**\n\n**Мрежов код:** SF_0001");
  assert.equal(buildTitle(pin({ eventId: "" })), "планирано - София");
  assert.equal(buildGeoJSON([]), null);
  assert.deepEqual(buildGeoJSON([minimal]), {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [23.323422, 42.700932] },
      properties: {
        eventId: "SF_0001",
        cityName: "",
        eventType: "Авария",
        startTime: "",
        endTime: "",
      },
    }],
  });
});

test("uses the injected scan time when dates are missing", () => {
  const content = buildContent([pin({ begin_event: "", end_event: "" })], now);
  assert.equal(content.datePublished, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanStart, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanEnd, "2026-10-04T12:30:00.000Z");
  for (const field of ["url", "sourceType", "locality", "crawledAt", "processed"]) {
    assert.equal(Object.hasOwn(content, field), false);
  }
  assert.throws(() => buildContent([], now), /event ID/);
  assert.throws(() => buildContent([pin({ eventId: "" })], now), /event ID/);
  assert.throws(() => buildContent([pin({ lat: 999 })], now), /geometry/);
});

test("retains publication dates before the timespan cutoff and falls back only for the timespan", () => {
  const warnings: string[] = [];
  const content = buildContent([pin({ begin_event: "01.01.2024 10:00", end_event: "01.01.2024 12:00" })], now, (message) => {
    warnings.push(message);
  });
  assert.equal(content.datePublished, "2024-01-01T10:00:00.000Z");
  assert.equal(content.timespanStart, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanEnd, "2026-10-04T12:30:00.000Z");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /begin_event outside valid range/);
  assert.match(warnings[1]!, /end_event outside valid range/);
});

test("preserves start-only, end-only and end-before-start timespans", () => {
  assert.deepEqual(parseTimespans(pin({ end_event: "" }), now), {
    timespanStart: new Date("2026-10-04T10:00:00.000Z"),
    timespanEnd: new Date("2026-10-04T10:00:00.000Z"),
  });
  assert.deepEqual(parseTimespans(pin({ begin_event: "" }), now), {
    timespanStart: now,
    timespanEnd: new Date("2026-10-04T12:00:00.000Z"),
  });
  assert.deepEqual(parseTimespans(pin({ end_event: "04.10.2026 09:00" }), now), {
    timespanStart: new Date("2026-10-04T10:00:00.000Z"),
    timespanEnd: new Date("2026-10-04T09:00:00.000Z"),
  });
});

test("falls back independently for invalid start and end values and reports them", () => {
  const warnings: string[] = [];
  const content = buildContent([pin({ begin_event: "invalid", end_event: "invalid" })], now, (message) => {
    warnings.push(message);
  });
  assert.equal(content.datePublished, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanStart, "2026-10-04T12:30:00.000Z");
  assert.equal(content.timespanEnd, "2026-10-04T12:30:00.000Z");
  assert.equal(warnings.length, 3);
  const startOnly = parseTimespans(pin({ end_event: "invalid" }), now);
  assert.equal(startOnly.timespanStart.toISOString(), "2026-10-04T10:00:00.000Z");
  assert.equal(startOnly.timespanEnd.toISOString(), "2026-10-04T10:00:00.000Z");
});

test("rejects invalid calendar components while preserving the legacy trimmed format", () => {
  assert.equal(parseBulgarianDateTime(" 04.10.2026   10:00 ").toISOString(), "2026-10-04T10:00:00.000Z");
  for (const value of [
    "", "not a date", "04.00.2026 10:00", "04.13.2026 10:00", "00.10.2026 10:00",
    "32.10.2026 10:00", "04.10.2026 24:00", "04.10.2026 10:60", "31.02.2026 10:00",
  ]) {
    assert.throws(() => parseBulgarianDateTime(value), /Invalid|does not match/);
  }
});

test("retains the process timezone used by the legacy date parser", () => {
  process.env.TZ = "Europe/Sofia";
  try {
    assert.equal(parseBulgarianDateTime("04.10.2026 10:00").toISOString(), "2026-10-04T07:00:00.000Z");
    assert.equal(parseBulgarianDateTime("29.01.2026 10:00").toISOString(), "2026-01-29T08:00:00.000Z");
  } finally {
    process.env.TZ = "UTC";
  }
});
