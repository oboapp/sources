import type { DataSource, SourceContent, SourceContext } from "@oboapp/source-sdk";
import { fetchFeedXml, parseRssFeedItems } from "@oboapp/source-web-utils/rss";
import { chromium, type Browser } from "playwright";
import TurndownService from "turndown";
import { blockMedia, discoverListing, navigate, reportWarning, type SofiaOptions } from "./listing.js";
import { articleUrlKey, extractPostDetails, REPAIRS_LISTING_URL, type Article } from "./pages.js";

export { articleUrlKey } from "./pages.js";
export type { SofiaOptions } from "./listing.js";

const NEWS_FEED = "https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss";
const NEWS_LISTING = "https://www.sofia.bg/bg/news";
const REPORT_ERRORS = "report-discovery-errors";

export function createSource(context: SourceContext, options: SofiaOptions = {}): DataSource {
  const articles = new Map<string, Article>();
  const errors: unknown[] = [];
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let browser: Browser | undefined;

  async function getBrowser(): Promise<Browser> {
    context.signal?.throwIfAborted();
    browser ??= await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    return browser;
  }

  function delay(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
  }

  async function news(): Promise<Article[]> {
    try {
      return parseRssFeedItems(await fetchFeedXml(NEWS_FEED), {
        hostname: "www.sofia.bg",
        dateTag: "dc:date",
        stripQuery: true,
      });
    } catch (error) {
      await reportWarning(options, "News RSS unavailable, using public listing", error);
      return discoverListing(await getBrowser(), NEWS_LISTING, options, delay);
    }
  }

  return {
    async discoverItems(cursor) {
      context.signal?.throwIfAborted();
      if (cursor === REPORT_ERRORS && errors.length > 0) {
        throw new AggregateError(errors, "Sofia article discovery failed");
      }
      if (cursor !== undefined) {
        throw new Error("Unexpected Sofia discovery cursor");
      }
      articles.clear();
      errors.length = 0;
      const seenUrls = new Set<string>();
      const repairs = async () => discoverListing(await getBrowser(), REPAIRS_LISTING_URL, options, delay);
      for (const discover of [repairs, news]) {
        try {
          for (const article of await discover()) {
            const key = articleUrlKey(article.url);
            if (!seenUrls.has(key)) {
              articles.set(article.url, article);
              seenUrls.add(key);
            }
          }
        } catch (error) {
          errors.push(error);
        }
      }
      const items = Array.from(articles.values(), (article) => ({
        identifier: article.url, payload: { title: article.title },
      }));
      if (errors.length === 0) {
        return { items };
      }
      if (items.length === 0) {
        throw new AggregateError(errors, "Sofia article discovery failed");
      }
      // The runner saves the successful listing before reporting the failed one.
      return { items, nextCursor: REPORT_ERRORS };
    },
    async fetchItem({ identifier }) {
      const article = articles.get(identifier);
      if (!article) {
        throw new Error("Sofia article was not discovered in this scan");
      }
      const page = await (await getBrowser()).newPage();
      let content: SourceContent;
      try {
        await blockMedia(page);
        await navigate(page, identifier);
        const details = await extractPostDetails(page);
        if (!details.contentHtml) {
          throw new Error(`Failed to extract content from ${identifier}`);
        }
        content = {
          title: details.title || article.title,
          datePublished: article.date,
          message: markdown.turndown(details.contentHtml),
        };
      } finally {
        await page.close();
      }
      await delay();
      return content;
    },
    async close() {
      articles.clear();
      errors.length = 0;
      await browser?.close();
      browser = undefined;
    },
  };
}
