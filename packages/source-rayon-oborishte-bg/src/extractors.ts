import {
  parseRssFeedItems,
  stripWordPressFeedAttribution,
} from "@oboapp/source-web-utils/rss";
import type { RssFeedItem } from "@oboapp/source-web-utils/rss";

const SOURCE_HOSTNAME = "rayon-oborishte.bg";

export function extractFeedItems(xml: string): RssFeedItem[] {
  return parseRssFeedItems(xml, {
    hostname: SOURCE_HOSTNAME,
    contentTag: "description",
    contentTransform: stripWordPressFeedAttribution,
  });
}
