import type { JsonValue } from "@oboapp/source-sdk";
import { normalizeGeoJson, type ToploWarning } from "./geometry.js";

export interface ToploIncident {
  identifier: string;
  name: string;
  addresses: string;
  fromDate: string;
  untilDate: string | null;
  geoJson: JsonValue;
}

function isIncidentInfo(value: unknown): value is {
  ContentItemId: string;
  Name: string;
  Addresses: string;
  FromDate: string;
  UntilDate: string | null;
} {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return "ContentItemId" in value && typeof value.ContentItemId === "string" &&
    "Name" in value && typeof value.Name === "string" &&
    "Addresses" in value && typeof value.Addresses === "string" &&
    "FromDate" in value && typeof value.FromDate === "string" &&
    "UntilDate" in value && (value.UntilDate === null || typeof value.UntilDate === "string");
}

/** Parse provider JSON without evaluating the surrounding JavaScript. */
export function parseIncidents(
  html: string,
  warn: ToploWarning = (message) => globalThis.console.warn(message),
): ToploIncident[] {
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)?.find((candidate) => {
    return candidate.includes("function parseAll()");
  });
  if (!script) {
    return [];
  }
  const incidents: ToploIncident[] = [];
  const pattern = /var geoJsonString = '(.+?)'\s*var info = ({[\s\S]+?})\s*if \(geoJsonString/g;
  for (const match of script.matchAll(pattern)) {
    try {
      const info: unknown = JSON.parse(match[2]!);
      const geoJson = normalizeGeoJson(JSON.parse(match[1]!) as JsonValue, warn);
      if (!isIncidentInfo(info) || geoJson === undefined) {
        warn("Skipped Toplo incident with invalid info or geometry");
        continue;
      }
      incidents.push({
        identifier: `https://toplo.bg/incidents/${info.ContentItemId}`,
        name: info.Name,
        addresses: info.Addresses,
        fromDate: info.FromDate,
        untilDate: info.UntilDate,
        geoJson,
      });
    } catch (error) {
      warn(`Failed to parse Toplo incident: ${error instanceof Error ? error.message : String(error)}`);
      // A malformed provider block must not hide other listing incidents.
      continue;
    }
  }
  return incidents;
}
