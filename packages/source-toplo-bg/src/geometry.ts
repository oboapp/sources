import type { JsonValue } from "@oboapp/source-sdk";

type Position = [number, number];
export type ToploWarning = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// These are the legacy bg.sofia bounds used only to recognize swapped coordinates.
function isWithinSofia(longitude: number, latitude: number): boolean {
  return longitude >= 23.188 && longitude <= 23.528 && latitude >= 42.605 && latitude <= 42.83;
}

function normalizePosition(value: unknown, corrected: () => void): Position | undefined {
  if (!Array.isArray(value) || value.length !== 2 ||
      typeof value[0] !== "number" || typeof value[1] !== "number") {
    return undefined;
  }
  let [longitude, latitude] = value;
  if (!isWithinSofia(longitude, latitude) && isWithinSofia(latitude, longitude)) {
    [longitude, latitude] = [latitude, longitude];
    corrected();
  }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return undefined;
  }
  return [longitude, latitude];
}

function normalizeLine(value: unknown, minimumLength: number, corrected: () => void): Position[] | undefined {
  if (!Array.isArray(value) || value.length < minimumLength) {
    return undefined;
  }
  const positions: Position[] = [];
  for (const position of value) {
    const normalized = normalizePosition(position, corrected);
    if (!normalized) {
      return undefined;
    }
    positions.push(normalized);
  }
  return positions;
}

function normalizeGeometry(value: unknown, corrected: () => void): JsonValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === "Point") {
    const coordinates = normalizePosition(value.coordinates, corrected);
    if (coordinates) {
      return { type: "Point", coordinates };
    }
  }
  if (value.type === "LineString") {
    const coordinates = normalizeLine(value.coordinates, 2, corrected);
    if (coordinates) {
      return { type: "LineString", coordinates };
    }
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates) && value.coordinates.length > 0) {
    const coordinates: Position[][] = [];
    for (const ring of value.coordinates) {
      const normalized = normalizeLine(ring, 4, corrected);
      const first = normalized?.[0];
      const last = normalized?.at(-1);
      if (!normalized || !first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        return undefined;
      }
      coordinates.push(normalized);
    }
    return { type: "Polygon", coordinates };
  }
  return undefined;
}

/** Preserve legacy feature filtering, coordinate correction and property defaults. */
export function normalizeGeoJson(value: JsonValue, warn: ToploWarning): JsonValue | undefined {
  const collection = Array.isArray(value) ? { type: "FeatureCollection", features: value } : value;
  if (!isRecord(collection) || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    return undefined;
  }
  const features: JsonValue[] = [];
  for (const feature of collection.features) {
    if (!isRecord(feature) || feature.type !== "Feature") {
      warn("Discarded invalid Toplo feature");
      continue;
    }
    let coordinatesCorrected = false;
    const geometry = normalizeGeometry(feature.geometry, () => {
      coordinatesCorrected = true;
    });
    if (!geometry) {
      warn("Discarded invalid Toplo feature geometry");
      continue;
    }
    if (coordinatesCorrected) {
      warn("Corrected swapped coordinates in Toplo feature");
    }
    const properties = feature.properties !== null && typeof feature.properties === "object"
      ? Object.fromEntries(Object.entries(feature.properties)) as Record<string, JsonValue>
      : {};
    features.push({ type: "Feature", geometry, properties });
  }
  if (features.length === 0 && collection.features.length > 0) {
    return undefined;
  }
  return { type: "FeatureCollection", features };
}
