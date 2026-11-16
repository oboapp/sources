import type { DataSource, SourceContext } from "@oboapp/source-sdk";
import { createToploSource } from "./toplo.js";
import type { ToploListingObserver } from "./toplo.js";

export type { ToploListingObservation, ToploListingResult, ToploListingObserver } from "./toplo.js";

export interface ToploSourceOptions {
  onListing?: ToploListingObserver;
}

export function createSource(context: SourceContext, options: ToploSourceOptions = {}): DataSource {
  return createToploSource({
    fetch: (...args) => {
      return globalThis.fetch(...args);
    },
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(options.onListing === undefined ? {} : { onListing: options.onListing }),
  });
}
