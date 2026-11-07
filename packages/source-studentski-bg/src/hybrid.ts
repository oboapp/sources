import type { DataSource } from "@oboapp/source-sdk";
import { createHybridSource, type HybridDependencies } from "@oboapp/source-web-utils";
import { fetchFeedXml, parseRssFeedItems } from "@oboapp/source-web-utils/rss";

const FEED_URL = "https://studentski.bg/category/%d0%b3%d1%80%d0%b0%d1%84%d0%b8%d1%86%d0%b8/feed/";

export function createSourceWithDependencies(dependencies?: HybridDependencies): DataSource {
  return createHybridSource({
    discoverItems: async () => parseRssFeedItems(await fetchFeedXml(FEED_URL), {
      hostname: "studentski.bg",
    }),
    selectors: {
      TITLE: ".single-post-title, h1.blog-entry-title",
      CONTENT: ".entry-content, .single-content",
    },
    unwantedElements: [
      "script",
      "style",
      "nav",
      ".comments",
      ".sharedaddy",
    ],
  }, dependencies);
}
