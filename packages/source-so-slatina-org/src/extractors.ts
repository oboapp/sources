import {
  parseRssFeedItems,
  stripWordPressFeedAttribution,
} from "./rss.js";
import type { RssFeedItem } from "./rss.js";

const SOURCE_HOSTNAME = "so-slatina.org";

export function extractFeedItems(xml: string): RssFeedItem[] {
  return parseRssFeedItems(xml, {
    hostname: SOURCE_HOSTNAME,
    contentTransform: stripWordPressFeedAttribution,
  });
}
