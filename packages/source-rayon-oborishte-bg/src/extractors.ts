import {
  parseRssFeedItems,
  stripWordPressFeedAttribution,
} from "./rss.js";
import type { RssFeedItem } from "./rss.js";

const SOURCE_HOSTNAME = "rayon-oborishte.bg";

export function extractFeedItems(xml: string): RssFeedItem[] {
  return parseRssFeedItems(xml, {
    hostname: SOURCE_HOSTNAME,
    contentTag: "description",
    contentTransform: stripWordPressFeedAttribution,
  });
}
