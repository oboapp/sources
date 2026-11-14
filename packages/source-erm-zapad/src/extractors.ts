import type { PinRecord, RawIncident } from "./types.js";

/** Use the incident center, rounded exactly as the historical collector. */
export function extractPinRecords(incident: RawIncident): PinRecord[] {
  const centerLat = Number.parseFloat(incident.lat);
  const centerLon = Number.parseFloat(incident.lon);
  if (Number.isNaN(centerLat) || Number.isNaN(centerLon)) {
    return [];
  }

  return [{
    lat: Math.round(centerLat * 1_000_000) / 1_000_000,
    lon: Math.round(centerLon * 1_000_000) / 1_000_000,
    eventId: incident.ceo,
    typedist: incident.typedist,
    begin_event: incident.begin_event,
    end_event: incident.end_event,
    city_name: incident.city_name,
    cities: incident.cities,
  }];
}
