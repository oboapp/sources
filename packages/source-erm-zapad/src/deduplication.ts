import type { PinRecord } from "./types.js";

/** Select the lowest event ID for matching pins across every municipality. */
export function deduplicatePinRecords(records: PinRecord[]): PinRecord[] {
  const uniqueMap = new Map<string, PinRecord>();
  for (const record of records) {
    const key = `${record.lat.toFixed(6)},${record.lon.toFixed(6)},${record.typedist},${record.begin_event},${record.end_event},${record.city_name},${record.cities}`;
    const existing = uniqueMap.get(key);
    if (existing && record.eventId >= existing.eventId) {
      continue;
    }
    uniqueMap.set(key, record);
  }
  return Array.from(uniqueMap.values());
}
