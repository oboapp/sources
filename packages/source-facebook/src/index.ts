import type { DataSource, DiscoveredItem, SourceContext, SourceMetadata } from "@oboapp/source-sdk";
import { parseFacebookPost, readDiscoveryPayload, toDiscoveredItem, toSourceContent } from "./content.js";
import { FacebookApiError, FacebookGraphClient } from "./graph.js";
import type { FacebookGraphDependencies } from "./graph.js";
import { createFacebookMetadata } from "./metadata.js";
import type { FacebookMetadataOptions } from "./metadata.js";

export { FacebookContentError } from "./content.js";
export type { FacebookPost, FacebookAttachment } from "./content.js";
export { FacebookApiError } from "./graph.js";
export type { FacebookGraphDependencies } from "./graph.js";
export { createFacebookMetadata } from "./metadata.js";
export type { FacebookMetadataOptions } from "./metadata.js";

export interface FacebookSourceOptions extends FacebookMetadataOptions {
  readonly apiVersion: string;
  readonly getAccessToken: () => string | undefined | Promise<string | undefined>;
  readonly pageSize?: number;
  readonly lookbackDays?: number;
}

export interface ConfiguredFacebookSource {
  readonly metadata: SourceMetadata;
  readonly createSource: (context: SourceContext) => DataSource;
}

function bounded(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/** Each configuration returns an independent SDK-compatible source definition. */
export function configure(
  options: FacebookSourceOptions,
  dependencies: FacebookGraphDependencies = {},
): ConfiguredFacebookSource {
  const metadata = createFacebookMetadata(options);
  const pageSize = options.pageSize ?? 25;
  const lookbackDays = options.lookbackDays ?? 7;
  if (!/^v\d{1,3}\.\d{1,2}$/.test(options.apiVersion) ||
      !bounded(pageSize, 1, 100) || !bounded(lookbackDays, 0, 30) ||
      typeof options.getAccessToken !== "function") {
    throw new Error("Invalid Facebook source configuration");
  }
  const settings = {
    pageId: options.pageId,
    apiVersion: options.apiVersion,
    getAccessToken: options.getAccessToken,
    pageSize,
    lookbackDays,
  };
  const runtime = { ...dependencies };

  return Object.freeze({
    metadata,
    createSource(context: SourceContext): DataSource {
      if (!metadata.localities.includes(context.locality)) {
        throw new Error("Facebook source does not support the selected locality");
      }
      const controller = new AbortController();
      const signal = context.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, context.signal]);
      const client = new FacebookGraphClient({ ...settings, signal }, runtime);
      return {
        async discoverItems(cursor?: string) {
          const page = await client.listPosts(cursor);
          return {
            items: page.posts.map((post) => toDiscoveredItem(parseFacebookPost(post, settings.pageId))),
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          };
        },
        async fetchItem(item: DiscoveredItem) {
          if (signal.aborted) {
            throw new FacebookApiError("cancelled");
          }
          const cached = readDiscoveryPayload(item, settings.pageId);
          if (cached) {
            return toSourceContent(cached);
          }
          const prefix = `facebook:${settings.pageId}:`;
          if (!item.identifier.startsWith(prefix)) {
            throw new FacebookApiError("invalid_post_id");
          }
          const postId = item.identifier.slice(prefix.length);
          const post = parseFacebookPost(await client.getPost(postId), settings.pageId);
          if (post.id !== postId) {
            throw new FacebookApiError("invalid_post_id");
          }
          return toSourceContent(post);
        },
        async close() {
          controller.abort();
        },
      };
    },
  });
}

const facebook = Object.freeze({ configure });
export default facebook;
