import type { ArcGisAttributes, ArcGisFeature, ArcGisGeometry } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAttributes(value: Record<string, unknown>): ArcGisAttributes {
  const attributes: ArcGisAttributes = {};
  if (typeof value.OBJECTID === "number" && Number.isFinite(value.OBJECTID)) {
    attributes.OBJECTID = value.OBJECTID;
  }
  for (const key of [
    "ALERTID", "ALERTTYPE", "DESCRIPTION", "CONTACT", "LASTEDITOR", "LOCATION",
    "ACTIVESTATUS", "START_H", "START_M", "END_H", "END_M", "CREATEDBY",
    "wsi_created_user", "wsi_last_edited_user",
  ] as const) {
    const field = value[key];
    if (typeof field === "string" || field === null) {
      attributes[key] = field;
    }
  }
  for (const key of ["START_", "LASTUPDATE", "ALERTEND", "SOFIADISTRICT", "CREATEDON", "PUBLICITY"] as const) {
    const field = value[key];
    if (typeof field === "number" || field === null) {
      attributes[key] = field;
    }
  }
  return attributes;
}

function isCoordinateGroups(value: unknown): value is number[][][] {
  return Array.isArray(value) && value.every((group: unknown) => {
    return Array.isArray(group) && group.every((coordinate: unknown) => {
      return Array.isArray(coordinate) && coordinate.every((component: unknown) => typeof component === "number");
    });
  });
}

function parseGeometry(value: Record<string, unknown>): ArcGisGeometry {
  const geometry: ArcGisGeometry = {};
  if (isCoordinateGroups(value.rings)) {
    geometry.rings = value.rings;
  }
  if (isCoordinateGroups(value.paths)) {
    geometry.paths = value.paths;
  }
  if (typeof value.x === "number") {
    geometry.x = value.x;
  }
  if (typeof value.y === "number") {
    geometry.y = value.y;
  }
  return geometry;
}

function parseFeature(value: unknown): ArcGisFeature | null {
  if (!isRecord(value)) {
    return null;
  }
  const feature: ArcGisFeature = {};
  if (isRecord(value.attributes)) {
    feature.attributes = parseAttributes(value.attributes);
  }
  if (isRecord(value.geometry)) {
    feature.geometry = parseGeometry(value.geometry);
  }
  return feature;
}

export function parseResponse(value: unknown, layerId: number): {
  features: ArcGisFeature[];
  rawCount: number;
  exceededTransferLimit: boolean;
} {
  if (!isRecord(value)) {
    throw new Error(`Malformed ArcGIS response for layer ${layerId}`);
  }
  if (value.error !== undefined) {
    const message = isRecord(value.error) && typeof value.error.message === "string"
      ? value.error.message
      : "Unknown provider error";
    throw new Error(`ArcGIS returned error for layer ${layerId}: ${message}`);
  }
  if (!Array.isArray(value.features) ||
    (value.exceededTransferLimit !== undefined && typeof value.exceededTransferLimit !== "boolean")) {
    throw new Error(`Malformed ArcGIS response for layer ${layerId}`);
  }
  const features: ArcGisFeature[] = [];
  for (const candidate of value.features) {
    const feature = parseFeature(candidate);
    if (feature) {
      features.push(feature);
    }
  }
  return {
    features,
    rawCount: value.features.length,
    exceededTransferLimit: value.exceededTransferLimit === true,
  };
}
