import type { DataSource } from "@oboapp/source-sdk";
import { buildContent } from "./content.js";
import { parseIncidents, type ToploIncident } from "./parser.js";
import type { ToploWarning } from "./geometry.js";

const TARGET_URL = "https://toplo.bg/accidents-and-maintenance";

export interface ToploListingObservation {
  readonly html: string;
  readonly observedAt: string;
}

export interface ToploListingResult {
  readonly count: number;
}

export type ToploListingObserver = (
  listing: ToploListingObservation,
) => ToploListingResult | Promise<ToploListingResult>;

export interface ToploDependencies {
  onListing?: ToploListingObserver;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  warn?: ToploWarning;
}

const defaults: ToploDependencies = {
  fetch: (...args) => {
    return globalThis.fetch(...args);
  },
};

/** Listing content stays in this scan's instance, including large geometries. */
export function createToploSource(dependencies: ToploDependencies = defaults): DataSource {
  const controller = new globalThis.AbortController();
  const signal = dependencies.signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, dependencies.signal]);
  let closed = false;
  const incidents = new Map<string, ToploIncident>();
  return {
    async discoverItems() {
      if (closed) {
        throw new Error("Toplo source is closed");
      }
      incidents.clear();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      requestSignal.throwIfAborted();
      const response = await dependencies.fetch(TARGET_URL, {
        headers: { Accept: "text/html" },
        signal: requestSignal,
      });
      if (!response.ok) {
        throw new Error(`Toplo listing returned HTTP ${response.status}`);
      }
      const html = await response.text();
      requestSignal.throwIfAborted();
      let listedCount: number | undefined;
      if (dependencies.onListing !== undefined) {
        const observation = await dependencies.onListing({
          html,
          observedAt: new Date().toISOString(),
        });
        if (!observation || !Number.isSafeInteger(observation.count) || observation.count < 0) {
          throw new TypeError("Toplo listing observer must return a nonnegative safe integer count");
        }
        listedCount = observation.count;
        requestSignal.throwIfAborted();
      }
      for (const incident of parseIncidents(html, dependencies.warn)) {
        if (!incidents.has(incident.identifier)) {
          incidents.set(incident.identifier, incident);
        }
      }
      if (listedCount === 0 && incidents.size > 0) {
        incidents.clear();
        throw new Error("Toplo listing observer reported zero for a nonempty listing");
      }
      if (incidents.size === 0 && listedCount !== 0) {
        throw new Error("No incidents found in HTML");
      }
      return {
        items: [...incidents.keys()].map((identifier) => ({ identifier })),
      };
    },
    async fetchItem(item) {
      const incident = incidents.get(item.identifier);
      if (!incident || closed) {
        throw new Error(`Missing listing incident for ${item.identifier}`);
      }
      return buildContent(incident);
    },
    async close() {
      closed = true;
      incidents.clear();
      controller.abort();
    },
  };
}
