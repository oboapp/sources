import type { DataSource, SourceContext } from "@oboapp/source-sdk";
import type { RssFeedFetchOptions } from "@oboapp/source-web-utils/rss";
import { createSourceWithDependencies } from "./hybrid.js";

export type { RssFeedFetchEvent, RssFeedFetchOptions } from "@oboapp/source-web-utils/rss";

/** Create one source per scan, with optional feed retry and recovery reporting. */
export function createSource(
  _context: SourceContext,
  feedOptions?: RssFeedFetchOptions,
): DataSource {
  return createSourceWithDependencies(undefined, feedOptions);
}
