import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { MAX_DISCOVERY_PAYLOAD_BYTES, serializeDiscoveryPayload } from "@oboapp/source-sdk";

test("round-trips full-feed and synthetic-identifier discovery context without normalization", () => {
  const payload = { identifier: "https://toplo.bg/incidents/A%2fb?x=1&y=2", title: "Авария", html: "<p>Топло</p>", coordinates: [23.3, 42.7], active: true, until: null };
  assert.deepEqual(JSON.parse(serializeDiscoveryPayload(payload)), payload);
});

test("counts UTF-8 bytes and JSON syntax at the exact limit", () => {
  const ascii = "a".repeat(MAX_DISCOVERY_PAYLOAD_BYTES - 2);
  assert.equal(new TextEncoder().encode(serializeDiscoveryPayload(ascii)).length, MAX_DISCOVERY_PAYLOAD_BYTES);
  assert.throws(() => serializeDiscoveryPayload(ascii + "a"), RangeError);
  assert.throws(() => serializeDiscoveryPayload("я".repeat(MAX_DISCOVERY_PAYLOAD_BYTES / 2)), RangeError);
  assert.throws(() => serializeDiscoveryPayload("\n".repeat(MAX_DISCOVERY_PAYLOAD_BYTES / 2)), RangeError);
});

test("rejects silent JSON data loss and non-JSON objects", () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol("x"), new Date(), new Map(), new Set(), /x/, { x: undefined }, [undefined], new Array(2)]) {
    assert.throws(() => serializeDiscoveryPayload(value), TypeError);
  }
});

test("does not invoke getters or toJSON hooks", () => {
  let invoked = false;
  const getter = { get value() { invoked = true; return "x"; } };
  const hook = { toJSON() { invoked = true; return "x"; } };
  assert.throws(() => serializeDiscoveryPayload(getter), TypeError);
  assert.throws(() => serializeDiscoveryPayload(hook), TypeError);
  assert.equal(invoked, false);
  class CustomArray extends Array { toJSON() { invoked = true; return "lost"; } }
  assert.throws(() => serializeDiscoveryPayload(new CustomArray(1, 2)), TypeError);
  assert.equal(invoked, false);
});

test("rejects hidden/symbol data and array properties that JSON would drop", () => {
  const hidden = Object.defineProperty({}, "secret", { value: 1 });
  const symbol = { [Symbol("secret")]: 1 };
  const extra = Object.assign([1], { extra: 2 });
  const sparseWithExtra = Object.assign(new Array(1), { extra: 2 });
  for (const value of [hidden, symbol, extra, sparseWithExtra]) assert.throws(() => serializeDiscoveryPayload(value), TypeError);
});

test("rejects cycles and excessive nesting but allows shared subtrees", () => {
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => serializeDiscoveryPayload(cycle), TypeError);
  let deep = null;
  for (let i = 0; i < 66; i++) deep = [deep];
  assert.throws(() => serializeDiscoveryPayload(deep), RangeError);
  const shared = { x: "same" };
  assert.deepEqual(JSON.parse(serializeDiscoveryPayload([shared, shared])), [shared, shared]);
});

test("preserves null-prototype records and unusual keys as data", () => {
  const payload = JSON.parse('{"__proto__":{"safe":true},"constructor":"value"}');
  assert.deepEqual(JSON.parse(serializeDiscoveryPayload(payload)), payload);
  assert.equal(serializeDiscoveryPayload(Object.assign(Object.create(null), { x: 1 })), '{"x":1}');
});

test("supports existing CommonJS consumers and isolated metadata imports", async () => {
  const require = createRequire(import.meta.url);
  assert.equal(require("@oboapp/source-sdk").serializeDiscoveryPayload({ x: 1 }), '{"x":1}');
  assert.deepEqual(Object.keys(await import("@oboapp/source-sdk/metadata")), []);
  assert.deepEqual(Object.keys(require("@oboapp/source-sdk/metadata")), []);
});
