export { MAX_DISCOVERY_PAYLOAD_BYTES, MAX_DISCOVERY_PAYLOAD_DEPTH, serializeDiscoveryPayload } from "./payload.js";
export type { SourceMetadata } from "./metadata.js";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface DiscoveredItem {
  /** The historical URL or synthetic URL, byte for byte. Never normalize it. */
  readonly identifier: string;
  /** Informational only: existing identifiers are never refetched based on this value. */
  readonly observedAt?: string;
  /** JSON context needed to fetch an item independently after a restart. */
  readonly payload?: JsonValue;
}

export interface DiscoveryPage {
  readonly items: readonly DiscoveredItem[];
  /** Opaque resume cursor. Obo persists it only after registering every item. */
  readonly nextCursor?: string;
}

/** Source-owned content; the platform supplies url, sourceType, locality, crawledAt and processed. */
export interface SourceContent {
  readonly title: string;
  readonly message: string;
  readonly datePublished: string;
  readonly markdownText?: string;
  readonly timespanStart?: string;
  readonly timespanEnd?: string;
  /** Serialized GeoJSON, or JSON data validated by Obo before persistence. */
  readonly geoJson?: JsonValue;
  readonly categories?: readonly string[];
  readonly isRelevant?: boolean;
  /** Empty string intentionally disables the public detail link. */
  readonly deepLinkUrl?: string;
}

export interface DataSource {
  discoverItems(cursor?: string): Promise<DiscoveryPage>;
  fetchItem(item: DiscoveredItem): Promise<SourceContent>;
  /** Called by Obo in finally, including when discovery or fetching fails. */
  close?(): Promise<void>;
}

export interface SourceContext {
  /** Platform-selected locality, validated against package metadata. */
  readonly locality: string;
  readonly signal?: AbortSignal;
}

/** Create once per worker batch to reuse sessions; retries may use a fresh instance. */
export type CreateSource = (context: SourceContext) => DataSource | Promise<DataSource>;
