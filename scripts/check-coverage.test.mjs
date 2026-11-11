import assert from "node:assert/strict";
import test from "node:test";
import { validateLcov } from "./check-coverage.mjs";

const first = "packages/source-one/src/index.ts";
const second = "packages/source-two/src/unused.ts";
const sourceFiles = new Map([[first, 3], [second, 1]]);
const firstRecord = `SF:${first}\nDA:1,1\nDA:3,0\nend_of_record\n`;
const secondRecord = `SF:${second}\nDA:1,0\nend_of_record\n`;

test("accepts one source record per file, including untested files", () => {
  assert.equal(validateLcov(firstRecord + secondRecord, sourceFiles), 2);
});

test("accepts relative Windows source paths", () => {
  assert.equal(validateLcov((firstRecord + secondRecord).replaceAll("/", "\\"), sourceFiles), 2);
});

test("requires an untested production file to remain in the report", () => {
  assert.throws(() => validateLcov(firstRecord, sourceFiles), /missing production source files/);
});

test("rejects a report containing generated, test or fixture paths", () => {
  for (const path of [
    "packages/source-one/dist/esm/index.js",
    "packages/source-one/dist/cjs/index.js",
    "packages/source-one/test/source.test.ts",
    "packages/source-one/test/fixtures/input.ts",
    "/checkout/packages/source-one/src/index.ts",
  ]) {
    assert.throws(() => validateLcov(`SF:${path}\nDA:1,1\nend_of_record\n`, sourceFiles), /non-source or non-relative path/);
  }
});

test("rejects double-counting the same TypeScript source", () => {
  assert.throws(() => validateLcov(firstRecord + firstRecord + secondRecord, sourceFiles), /duplicate records/);
});

test("rejects coverage outside the original TypeScript line range", () => {
  for (const line of ["DA:0,1", "DA:4,1", "DA:1.5,1", "DA:invalid,1"]) {
    const report = `SF:${first}\n${line}\nend_of_record\n${secondRecord}`;
    assert.throws(() => validateLcov(report, sourceFiles), /line is outside/);
  }
});

test("rejects invalid counts and duplicate mapped lines", () => {
  for (const line of ["DA:1,-1", "DA:1,invalid", "DA:1,1.5", "DA:1,1\nDA:1,1"]) {
    const report = `SF:${first}\n${line}\nend_of_record\n${secondRecord}`;
    assert.throws(() => validateLcov(report, sourceFiles), /invalid or duplicate line data/);
  }
});

test("rejects an empty report", () => {
  assert.throws(() => validateLcov("", sourceFiles), /missing production source files/);
});

test("rejects a complete report when the runtime collected no coverage", () => {
  const report = firstRecord.replace("DA:1,1", "DA:1,0") + secondRecord;
  assert.throws(() => validateLcov(report, sourceFiles), /no collected source hits/);
});
