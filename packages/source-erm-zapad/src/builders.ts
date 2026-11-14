import type { GeoJSONFeatureCollection, PinRecord, Warn } from "./types.js";

export function buildGeoJSON(
  pinRecords: PinRecord[],
  warn: Warn = () => {},
): GeoJSONFeatureCollection | null {
  const validPins = pinRecords.filter((pin) => {
    const isValid = Number.isFinite(pin.lon) && Number.isFinite(pin.lat) &&
      pin.lon >= -180 && pin.lon <= 180 && pin.lat >= -90 && pin.lat <= 90;
    if (!isValid) {
      warn(`Skipping invalid ERM Zapad geometry for ${pin.eventId}: [${pin.lon}, ${pin.lat}]`);
    }
    return isValid;
  });
  if (validPins.length === 0) {
    return null;
  }
  return {
    type: "FeatureCollection",
    features: validPins.map((pin) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [pin.lon, pin.lat],
      },
      properties: {
        eventId: pin.eventId,
        cityName: pin.city_name,
        eventType: pin.typedist,
        startTime: pin.begin_event,
        endTime: pin.end_event,
      },
    })),
  };
}

type TitleFormatter = (title: string) => string;
type LabelFormatter = (label: string, value: string) => string;

function buildMessageInternal(
  pin: PinRecord,
  formatTitle: TitleFormatter,
  formatLabel: LabelFormatter,
): string {
  const lines = [formatTitle(pin.typedist) + "\n"];
  if (pin.city_name) {
    lines.push(formatLabel("Населено място", pin.city_name));
  }
  if (pin.begin_event) {
    lines.push(formatLabel("Начало", pin.begin_event));
  }
  if (pin.end_event) {
    lines.push(formatLabel("Край", pin.end_event));
  }
  if (pin.eventId) {
    lines.push(formatLabel("Мрежов код", pin.eventId));
  }
  return lines.join("\n");
}

export function buildPlainTextMessage(pin: PinRecord): string {
  return buildMessageInternal(pin, (title) => title, (label, value) => `${label}: ${value}`);
}

export function buildMarkdownMessage(pin: PinRecord): string {
  return buildMessageInternal(pin, (title) => `**${title}**`, (label, value) => `**${label}:** ${value}`);
}

export function buildTitle(pin: PinRecord): string {
  const parts = [pin.typedist];
  if (pin.city_name) {
    parts.push(pin.city_name);
  }
  if (pin.eventId) {
    parts.push(pin.eventId);
  }
  return parts.join(" - ");
}
