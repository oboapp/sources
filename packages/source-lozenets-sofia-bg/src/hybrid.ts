import type { DataSource } from "@oboapp/source-sdk";
import { createHybridSource, type HybridDependencies } from "@oboapp/source-web-utils";
import { fetchFeedXml, parseRssFeedItems } from "@oboapp/source-web-utils/rss";

const FEED_URL = "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/";

export function createSourceWithDependencies(dependencies?: HybridDependencies): DataSource {
  return createHybridSource({
    discoverItems: async () => parseRssFeedItems(await fetchFeedXml(FEED_URL), {
      hostname: "lozenets.sofia.bg",
    }),
    selectors: {
      TITLE: ".single-post-title",
      CONTENT: ".single-blog-content.entry",
    },
    unwantedElements: [
      "script",
      "style",
      "nav",
      ".wpex-social-share",
      ".related-posts",
      ".navigation",
    ],
  }, dependencies);
}
