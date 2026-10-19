/** UTF-8 JSON limit, including quotes, escapes and property names. */
export const MAX_DISCOVERY_PAYLOAD_BYTES = 256 * 1024;
export const MAX_DISCOVERY_PAYLOAD_DEPTH = 64;

/** Reject values JSON.stringify would silently drop/coerce or serialize through user code. */
function validate(value: unknown, ancestors: Set<object>, depth: number): void {
  if (depth > MAX_DISCOVERY_PAYLOAD_DEPTH) throw new RangeError("Discovery payload exceeds maximum depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new TypeError("Discovery payload must contain only JSON values");
  if (ancestors.has(value)) throw new TypeError("Discovery payload contains a cycle");
  const isArray = Array.isArray(value);
  if (isArray && Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("Discovery payload arrays must be plain arrays");
  }
  if (!isArray && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Discovery payload objects must be plain objects");
  }
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (isArray && keys.length !== value.length + 1) throw new TypeError("Discovery payload arrays must be dense and have no extra properties");
  for (const key of keys) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("Discovery payload properties must be enumerable JSON data");
    }
    if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
      throw new TypeError("Discovery payload arrays cannot have extra properties");
    }
    validate(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

/** Validate before durable registration. On failure, do not advance the discovery cursor. */
export function serializeDiscoveryPayload(payload: unknown): string {
  validate(payload, new Set(), 0);
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_DISCOVERY_PAYLOAD_BYTES) {
    throw new RangeError("Discovery payload exceeds 256 KiB; reduce context or fetch content by identifier");
  }
  return serialized;
}
