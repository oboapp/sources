import type { SourceContent } from "@oboapp/source-sdk";
import type { ArcGisFeature, LayerConfig, SofiyskaVodaWarning } from "./types.js";
import {
  sanitizeText,
  ensureDate,
  buildPlainTextMessage,
  buildMarkdownMessage,
} from "./formatters.js";

const BASE_URL =
  "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";
const MINIMUM_DATE = Date.UTC(2025, 0, 1);

type FeatureProperty = string | number;
type NullableFeatureProperty = FeatureProperty | null;
type Coordinate = [number, number];
type Geometry =
  | { type: "Point"; coordinates: Coordinate }
  | { type: "LineString"; coordinates: Coordinate[] }
  | { type: "Polygon"; coordinates: Coordinate[][] };
type FeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: Geometry;
    properties: Record<string, FeatureProperty>;
  }[];
};

export function getFeatureUrl(layerId: number, objectId: number): string {
  return `${BASE_URL}/${layerId}/${objectId}`;
}

function buildTitle(attributes: ArcGisFeature["attributes"], layer: LayerConfig): string {
  return [
    layer.titlePrefix,
    sanitizeText(attributes?.LOCATION),
    sanitizeText(attributes?.ALERTTYPE),
  ].filter((part): part is string => typeof part === "string" && part.length > 0).join(" – ");
}

function buildFeatureProperties(
  attributes: ArcGisFeature["attributes"],
  layer: LayerConfig,
): Record<string, FeatureProperty> {
  const sanitized = (value?: NullableFeatureProperty): NullableFeatureProperty => {
    if (typeof value === "string") {
      return sanitizeText(value);
    }
    return value ?? null;
  };
  const rawEntries: [string, NullableFeatureProperty][] = [
    ["layerId", layer.id],
    ["layerName", layer.name],
    ["titlePrefix", layer.titlePrefix],
    ["alertId", attributes?.ALERTID ?? null],
    ["status", sanitized(attributes?.ACTIVESTATUS)],
    ["alertType", sanitized(attributes?.ALERTTYPE)],
    ["location", sanitized(attributes?.LOCATION)],
    ["district", attributes?.SOFIADISTRICT ?? null],
  ];
  const filteredEntries = rawEntries.filter(
    (entry): entry is [string, FeatureProperty] => entry[1] !== null && entry[1] !== "",
  );
  return Object.fromEntries(filteredEntries);
}

function buildGeometry(feature: ArcGisFeature): Geometry | null {
  const geometry = feature.geometry;
  if (!geometry) {
    return null;
  }
  if (geometry.rings?.length) {
    return {
      type: "Polygon",
      coordinates: geometry.rings.map((ring) => ring.map((coord): Coordinate => [coord[0]!, coord[1]!])),
    };
  }
  if (geometry.paths?.length) {
    const firstPath = geometry.paths.find((path) => path.length > 1);
    if (firstPath) {
      return {
        type: "LineString",
        coordinates: firstPath.map((coord): Coordinate => [coord[0]!, coord[1]!]),
      };
    }
  }
  if (typeof geometry.x === "number" && typeof geometry.y === "number") {
    return { type: "Point", coordinates: [geometry.x, geometry.y] };
  }
  return null;
}

function buildGeometryCollection(feature: ArcGisFeature, layer: LayerConfig): FeatureCollection | null {
  const geometry = buildGeometry(feature);
  if (!geometry) {
    return null;
  }
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry,
      properties: buildFeatureProperties(feature.attributes, layer),
    }],
  };
}

/** Preserve the legacy rule: either invalid bound makes both use lastUpdate. */
function resolveTimespans(
  attributes: ArcGisFeature["attributes"],
  lastUpdate: Date,
  warn?: SofiyskaVodaWarning,
) {
  const start = ensureDate(attributes?.START_);
  const end = ensureDate(attributes?.ALERTEND);
  const isStartValid = start !== null && start.getTime() >= MINIMUM_DATE;
  const isEndValid = end !== null && end.getTime() >= MINIMUM_DATE;
  if (isStartValid && isEndValid) {
    return { timespanStart: start.toISOString(), timespanEnd: end.toISOString() };
  }
  if (!isStartValid && attributes?.START_) {
    warn?.("START_ outside valid range", {
      sourceType: "sofiyska-voda",
      objectId: attributes.OBJECTID,
      startValue: attributes.START_,
    });
  }
  if (!isEndValid && attributes?.ALERTEND) {
    warn?.("ALERTEND outside valid range", {
      sourceType: "sofiyska-voda",
      objectId: attributes.OBJECTID,
      alertEnd: attributes.ALERTEND,
    });
  }
  return { timespanStart: lastUpdate.toISOString(), timespanEnd: lastUpdate.toISOString() };
}

/** Convert listing data without assigning platform-owned source or processing fields. */
export function buildContent(
  feature: ArcGisFeature,
  layer: LayerConfig,
  now: () => Date = () => new Date(),
  dateFormatter?: Intl.DateTimeFormat,
  warn?: SofiyskaVodaWarning,
): SourceContent | null {
  if (typeof feature.attributes?.OBJECTID !== "number") {
    return null;
  }
  const geoJson = buildGeometryCollection(feature, layer);
  if (!geoJson) {
    return null;
  }
  const attributes = feature.attributes;
  const lastUpdate = ensureDate(attributes.LASTUPDATE) ?? ensureDate(attributes.START_) ?? now();
  return {
    title: buildTitle(attributes, layer),
    message: buildPlainTextMessage({ ...attributes }, layer, dateFormatter),
    markdownText: buildMarkdownMessage({ ...attributes }, layer, dateFormatter),
    deepLinkUrl: "",
    datePublished: lastUpdate.toISOString(),
    geoJson,
    categories: ["water"],
    isRelevant: true,
    ...resolveTimespans(attributes, lastUpdate, warn),
  };
}
