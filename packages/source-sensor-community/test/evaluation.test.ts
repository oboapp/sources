import assert from "node:assert/strict";
import { test } from "node:test";
import { airQualityIndex } from "../dist/esm/aqi.js";
import { buildGrid, contains } from "../dist/esm/grid.js";
import type { Reading } from "../dist/esm/index.js";
import { filterOutliers } from "../dist/esm/outliers.js";

function reading(hour: number, p1: number, p2: number): Reading {
  return { sensorId: 1, lat: 42, lng: 23, timestamp: new Date(Date.UTC(2026, 9, 4, hour)), p1, p2 };
}

test("averages within each UTC hour, weighs recent hours more and rounds the worst pollutant", () => {
  const samples = [reading(8, 0, 0), reading(10, 0, 30), reading(10, 0, 60)];
  // The most recent hour's PM2.5 average is 45. Its weight is 1, the earlier
  // nonempty hour has weight 0.5. The resulting concentration is 30 (index 4.2).
  assert.equal(airQualityIndex(samples), 4.2);
  assert.equal(airQualityIndex([...samples].reverse()), 4.2);
  assert.equal(airQualityIndex([reading(1, 100, 0)]), 5);
  assert.equal(airQualityIndex([reading(1, 0, 800)]), 6);
  assert.equal(airQualityIndex([reading(0, 0, 0)]), 1);
  assert.equal(airQualityIndex([]), 0);
});

test("rejects invalid concentrations and statistical outliers in either pollutant", () => {
  const normal = reading(0, 100, 75);
  const invalid = [reading(0, -1, 75), reading(0, 100, -1), reading(0, 999.91, 75),
    reading(0, 100, 999.91), reading(0, Number.NaN, 75), reading(0, 100, Number.POSITIVE_INFINITY)];
  assert.deepEqual(filterOutliers([...invalid, normal]), [normal]);
  assert.deepEqual(filterOutliers([normal, normal, normal, normal, normal, reading(0, 999, 75),
    reading(0, 100, 999)]), [normal, normal, normal, normal, normal]);
  assert.deepEqual(filterOutliers([reading(0, 999.9, 999.9)]), [reading(0, 999.9, 999.9)]);
});

test("retains row-major IDs and assigns shared boundaries to the first matching cell", () => {
  const bounds = { south: 42.605, west: 23.188, north: 42.83, east: 23.528 };
  const cells = buildGrid(bounds);
  assert.equal(cells.length, 49);
  const boundary = cells[0]!.bounds;
  assert.equal(cells.find((cell) => contains(cell, boundary.north, boundary.east))?.id, "r0c0");
  assert.equal(cells.find((cell) => contains(cell, 42.7, 23.32))?.id, "r2c2");
  assert.equal(cells.find((cell) => contains(cell, 50, 23)), undefined);
  assert.throws(() => buildGrid({ ...bounds, east: Number.POSITIVE_INFINITY }), /bounds/);
  assert.throws(() => buildGrid({ ...bounds, west: bounds.east }), /bounds/);
});
