import { setTimeout } from "node:timers/promises";
import type { DataSource } from "@oboapp/source-sdk";
import { buildGeoJSON } from "./builders.js";
import { buildContent } from "./content.js";
import { deduplicatePinRecords } from "./deduplication.js";
import { extractPinRecords } from "./extractors.js";
import { groupPinsByEventId } from "./grouping.js";
import { metadata } from "./metadata.js";
import { discoverMunicipalities } from "./parser.js";
import type { PinRecord, RawIncident, Warn } from "./types.js";

const INCIDENT_URL_PREFIX = "https://info.ermzapad.bg/incidents/";
const REQUEST_TIMEOUT_MS = 30_000;
const MUNICIPALITY_DELAY_MS = 2_000;

export interface ErmZapadDependencies {
  fetch?: typeof globalThis.fetch;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  warn?: Warn;
  signal?: AbortSignal;
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await setTimeout(milliseconds, undefined, signal === undefined ? {} : { signal });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIncident(value: unknown): RawIncident | null {
  if (!isRecord(value)) {
    return null;
  }
  const requiredFields = ["ceo", "lat", "lon", "typedist"];
  for (const field of requiredFields) {
    if (typeof value[field] !== "string") {
      return null;
    }
  }
  const optionalFields = ["begin_event", "end_event", "city_name", "cities"];
  for (const field of optionalFields) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      return null;
    }
  }
  return {
    ceo: value.ceo as string,
    lat: value.lat as string,
    lon: value.lon as string,
    typedist: value.typedist as string,
    begin_event: value.begin_event as string | undefined,
    end_event: value.end_event as string | undefined,
    city_name: value.city_name as string | undefined,
    cities: value.cities as string | undefined,
    type_event: typeof value.type_event === "string" ? value.type_event : "",
    grid_id: typeof value.grid_id === "string" ? value.grid_id : "",
    points: { cnt: "0" },
  };
}

function parseMunicipalityPins(payload: unknown, municipalityCode: string, warn: Warn): PinRecord[] {
  if (!isRecord(payload) && !Array.isArray(payload)) {
    throw new Error(`Invalid ERM Zapad incidents response for ${municipalityCode}`);
  }
  const pins: PinRecord[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const incident = parseIncident(value);
    if (!incident) {
      warn(`Skipping malformed ERM Zapad incident ${key} for ${municipalityCode}`);
      continue;
    }
    const extracted = extractPinRecords(incident);
    if (extracted.length === 0) {
      warn(`Skipping ERM Zapad incident ${incident.ceo} without usable coordinates`);
    }
    pins.push(...extracted);
  }
  return pins;
}

/** One scan must collect all municipalities before selecting historical identifiers. */
export function createErmZapadSource(dependencies: ErmZapadDependencies = {}): DataSource {
  const request = dependencies.fetch ?? globalThis.fetch;
  const delay = dependencies.delay ?? wait;
  const now = dependencies.now ?? (() => new Date());
  const warn = dependencies.warn ?? ((message: string) => {
    globalThis.console.warn(message);
  });
  const controller = new AbortController();
  const signal = dependencies.signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, dependencies.signal]);
  const cached = new Map<string, PinRecord[]>();
  let closed = false;

  function assertOpen(): void {
    if (closed) {
      throw new Error("ERM Zapad source is closed");
    }
    signal.throwIfAborted();
  }

  async function fetchResponse(init?: RequestInit): Promise<Response> {
    assertOpen();
    const response = await request(metadata.url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    assertOpen();
    if (!response.ok) {
      throw new Error(`ERM Zapad request returned HTTP ${response.status} ${response.statusText}`);
    }
    return response;
  }

  return {
    async discoverItems(cursor) {
      cached.clear();
      assertOpen();
      if (cursor !== undefined) {
        throw new Error("ERM Zapad discovery does not support pagination cursors");
      }
      const listing = await fetchResponse();
      const municipalities = discoverMunicipalities(await listing.text());
      assertOpen();
      const pins: PinRecord[] = [];
      for (const [index, municipality] of municipalities.entries()) {
        const response = await fetchResponse({
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: new URLSearchParams({
            action: "draw",
            gm_obstina: municipality.code,
            lat: "0",
            lon: "0",
          }).toString(),
        });
        // The provider labels JSON as text/html and can prefix it with a UTF-8 BOM.
        const payload: unknown = await response.json();
        assertOpen();
        pins.push(...parseMunicipalityPins(payload, municipality.code, warn));
        if (index < municipalities.length - 1) {
          await delay(MUNICIPALITY_DELAY_MS, signal);
          assertOpen();
        }
      }
      const grouped = groupPinsByEventId(deduplicatePinRecords(pins));
      for (const [eventId, incidentPins] of grouped) {
        if (!eventId) {
          warn("Skipping ERM Zapad incident without an event ID");
          continue;
        }
        if (!buildGeoJSON(incidentPins)) {
          warn(`Skipping ERM Zapad incident ${eventId} without valid geometry`);
          continue;
        }
        cached.set(`${INCIDENT_URL_PREFIX}${eventId}`, incidentPins);
      }
      return { items: Array.from(cached.keys(), (identifier) => ({ identifier })) };
    },
    async fetchItem(item) {
      assertOpen();
      const pins = cached.get(item.identifier);
      if (!pins) {
        throw new Error(`Missing ERM Zapad listing content for ${item.identifier}`);
      }
      return buildContent(pins, now(), warn);
    },
    async close() {
      closed = true;
      cached.clear();
      controller.abort(new Error("ERM Zapad source is closed"));
    },
  };
}
