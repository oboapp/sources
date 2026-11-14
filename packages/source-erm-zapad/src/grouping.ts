import type { PinRecord } from "./types.js";

export function groupPinsByEventId(pins: PinRecord[]): Map<string, PinRecord[]> {
  const incidentMap = new Map<string, PinRecord[]>();
  for (const pin of pins) {
    const existing = incidentMap.get(pin.eventId);
    if (existing) {
      existing.push(pin);
    } else {
      incidentMap.set(pin.eventId, [pin]);
    }
  }
  return incidentMap;
}
