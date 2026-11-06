import type { DataSource } from "@oboapp/source-sdk";
import { buildContent } from "./content.js";
import { parseIncidents, type ToploIncident } from "./parser.js";
import type { ToploWarning } from "./geometry.js";

const TARGET_URL = "https://toplo.bg/accidents-and-maintenance";

export interface ToploDependencies {
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  warn?: ToploWarning;
}

const defaults: ToploDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
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
      for (const incident of parseIncidents(html, dependencies.warn)) {
        if (!incidents.has(incident.identifier)) {
          incidents.set(incident.identifier, incident);
        }
      }
      if (incidents.size === 0) {
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
