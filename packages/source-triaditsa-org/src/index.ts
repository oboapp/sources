import type { CreateSource, SourceContent } from "@oboapp/source-sdk";
import TurndownService from "turndown";
import { extractFeedItems } from "./extractors.js";
import { fetchFeedXml } from "./rss.js";

const NEWS_FEED_URL = "https://triaditza.org/category/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8-%D0%B8-%D1%81%D1%8A%D0%B1%D0%B8%D1%82%D0%B8%D1%8F/feed/";

const FEED_URLS = [
  NEWS_FEED_URL,
  "https://triaditza.org/feed/?post_type=announcements",
];

/** Full content comes from the feed; fetchItem performs no additional HTTP request. */
export const createSource: CreateSource = () => {
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  markdown.remove(["style", "script"]);
  return {
    async discoverItems() {
      const items = [];
      for (const feedUrl of FEED_URLS) {
        items.push(...extractFeedItems(await fetchFeedXml(feedUrl)));
      }
      const seen = new Set<string>();
      return {
        items: items.filter((item) => {
          if (seen.has(item.url)) {
            return false;
          }
          seen.add(item.url);
          return true;
        }).map((item) => ({
          identifier: item.url,
          payload: { title: item.title, date: item.date, contentHtml: item.contentHtml ?? "" },
        })),
      };
    },
    async fetchItem(item): Promise<SourceContent> {
      const payload = item.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !("title" in payload) || typeof payload.title !== "string" || !payload.title ||
        !("date" in payload) || typeof payload.date !== "string" ||
        !("contentHtml" in payload) || typeof payload.contentHtml !== "string" || !payload.contentHtml) {
        throw new Error(`Missing feed content for ${item.identifier}`);
      }
      return { title: payload.title, datePublished: payload.date, message: markdown.turndown(payload.contentHtml) };
    },
  };
};
