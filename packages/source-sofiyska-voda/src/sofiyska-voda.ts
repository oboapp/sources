import type { DataSource, SourceContent } from "@oboapp/source-sdk";
import { buildContent, getFeatureUrl } from "./content.js";
import { parseResponse } from "./response.js";
import type { ArcGisFeature, LayerConfig, SofiyskaVodaWarning } from "./types.js";

const BASE_URL =
  "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";
const REQUEST_HEADERS = {
  referer: "https://gispx.sofiyskavoda.bg/WebApp.InfoCenter/?a=0&tab=0",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  dnt: "1",
};
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const LAYERS: readonly LayerConfig[] = [
  { id: 2, name: "Текущи спирания", titlePrefix: "Текущо спиране", where: "ACTIVESTATUS = 'In Progress'" },
  { id: 3, name: "Планирани спирания", titlePrefix: "Планирано спиране" },
];

export interface SofiyskaVodaDependencies {
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  now?: () => Date;
  warn?: SofiyskaVodaWarning;
}

const defaults: SofiyskaVodaDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
};

function defaultWarning(message: string, context?: Readonly<Record<string, unknown>>): void {
  if (context === undefined) {
    globalThis.console.warn(message);
    return;
  }
  globalThis.console.warn(message, context);
}

function readCursor(cursor: string | undefined): { layerIndex: number; offset: number } {
  if (cursor === undefined) {
    return { layerIndex: 0, offset: 0 };
  }
  const match = /^([01]):(0|[1-9][0-9]*)$/.exec(cursor);
  const layerIndex = Number(match?.[1]);
  const offset = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(offset) || offset % PAGE_SIZE !== 0) {
    throw new Error("Invalid Sofiyska Voda discovery cursor");
  }
  return { layerIndex, offset };
}

function buildQueryUrl(layer: LayerConfig, offset: number): string {
  const params = new URLSearchParams({
    f: "json",
    where: layer.where ?? "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultOffset: offset.toString(),
    resultRecordCount: PAGE_SIZE.toString(),
    orderByFields: "START_ DESC",
  });
  return `${BASE_URL}/${layer.id}/query?${params.toString()}`;
}

function cacheItems(
  features: readonly ArcGisFeature[],
  layer: LayerConfig,
  contents: Map<string, SourceContent>,
  dependencies: SofiyskaVodaDependencies,
  warn: SofiyskaVodaWarning,
): { identifier: string }[] {
  const items: { identifier: string }[] = [];
  for (const feature of features) {
    const objectId = feature.attributes?.OBJECTID;
    if (typeof objectId !== "number") {
      warn(`Skipping Sofiyska Voda feature without OBJECTID in layer ${layer.id}`);
      continue;
    }
    const identifier = getFeatureUrl(layer.id, objectId);
    if (contents.has(identifier)) {
      continue;
    }
    const content = buildContent(feature, layer, dependencies.now, undefined, warn);
    if (!content) {
      warn(`Skipping Sofiyska Voda feature without geometry: ${identifier}`);
      continue;
    }
    contents.set(identifier, content);
    items.push({ identifier });
  }
  return items;
}

function nextPageCursor(
  layerIndex: number,
  offset: number,
  payload: ReturnType<typeof parseResponse>,
): string | undefined {
  if (payload.exceededTransferLimit && payload.rawCount > 0) {
    return `${layerIndex}:${offset + PAGE_SIZE}`;
  }
  if (layerIndex + 1 < LAYERS.length) {
    return `${layerIndex + 1}:0`;
  }
  return undefined;
}

/** Keep complete listing content in this scan's instance, outside bounded discovery payloads. */
export function createSofiyskaVodaSource(dependencies: SofiyskaVodaDependencies = defaults): DataSource {
  const warn = dependencies.warn ?? defaultWarning;
  const controller = new globalThis.AbortController();
  const signal = dependencies.signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, dependencies.signal]);
  const contents = new Map<string, SourceContent>();
  const pageSignatures = new Set<string>();
  let closed = false;
  let expectedCursor: string | undefined;
  return {
    async discoverItems(cursor) {
      if (closed) {
        throw new Error("Sofiyska Voda source is closed");
      }
      if (cursor !== undefined && cursor !== expectedCursor) {
        throw new Error("Unexpected or repeated Sofiyska Voda discovery cursor");
      }
      const { layerIndex, offset } = readCursor(cursor);
      const layer = LAYERS[layerIndex];
      if (!layer) {
        throw new Error("Invalid Sofiyska Voda layer");
      }
      if (cursor === undefined) {
        contents.clear();
        pageSignatures.clear();
        expectedCursor = undefined;
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      requestSignal.throwIfAborted();
      const response = await dependencies.fetch(buildQueryUrl(layer, offset), {
        headers: REQUEST_HEADERS,
        signal: requestSignal,
      });
      if (!response.ok) {
        throw new Error(`ArcGIS request failed (${response.status} ${response.statusText})`);
      }
      const payload = parseResponse(await response.json(), layer.id);
      requestSignal.throwIfAborted();
      const identifiers = payload.features.map((feature) => feature.attributes?.OBJECTID);
      const signature = `${layer.id}:${JSON.stringify([...new Set(identifiers)].sort())}`;
      if (payload.exceededTransferLimit && payload.rawCount > 0 && pageSignatures.has(signature)) {
        throw new Error(`ArcGIS returned a repeated page for layer ${layer.id}`);
      }
      pageSignatures.add(signature);

      const items = cacheItems(payload.features, layer, contents, dependencies, warn);
      const nextCursor = nextPageCursor(layerIndex, offset, payload);
      expectedCursor = nextCursor;
      return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
    },
    async fetchItem(item) {
      const content = contents.get(item.identifier);
      if (!content || closed) {
        throw new Error(`Missing listing feature for ${item.identifier}`);
      }
      signal.throwIfAborted();
      return content;
    },
    async close() {
      closed = true;
      contents.clear();
      pageSignatures.clear();
      controller.abort();
    },
  };
}
