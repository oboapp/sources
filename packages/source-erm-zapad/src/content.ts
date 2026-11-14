import type { SourceContent } from "@oboapp/source-sdk";
import { buildGeoJSON, buildMarkdownMessage, buildPlainTextMessage, buildTitle } from "./builders.js";
import { parseBulgarianDateTime } from "./date-utils.js";
import { parseTimespans } from "./timespan-parsing.js";
import type { PinRecord, Warn } from "./types.js";

export function buildContent(
  pins: PinRecord[],
  now = new Date(),
  warn: Warn = () => {},
): SourceContent {
  const pin = pins[0];
  if (!pin?.eventId || typeof pin.eventId !== "string") {
    throw new Error("ERM Zapad incident has no event ID");
  }
  const geoJson = buildGeoJSON(pins, warn);
  if (!geoJson) {
    throw new Error(`ERM Zapad incident ${pin.eventId} has no geometry`);
  }
  let datePublished = now.toISOString();
  if (pin.begin_event) {
    try {
      datePublished = parseBulgarianDateTime(pin.begin_event).toISOString();
    } catch (error) {
      warn(`Invalid publication date for ${pin.eventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { timespanStart, timespanEnd } = parseTimespans(pin, now, warn);
  return {
    deepLinkUrl: "",
    datePublished,
    title: buildTitle(pin),
    message: buildPlainTextMessage(pin),
    markdownText: buildMarkdownMessage(pin),
    geoJson: JSON.stringify(geoJson),
    categories: ["electricity"],
    isRelevant: true,
    timespanStart: timespanStart.toISOString(),
    timespanEnd: timespanEnd.toISOString(),
  };
}
