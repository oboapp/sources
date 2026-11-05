import type { DataSource, DiscoveredItem, SourceContent } from "@oboapp/source-sdk";
import { chromium, type Browser, type Page } from "playwright";
import TurndownService from "turndown";
import { extractFeedItems } from "./extractors.js";
import { fetchFeedXml } from "./rss.js";

const FEED_URL = "https://rayon-oborishte.bg/feed/";
const SELECTORS = {
  CONTENT: "article, .entry-content, .post-content, main",
  TITLE: "h1, .entry-title, .post-title",
};
const UNWANTED = ["script", "style", "nav", ".sharedaddy", ".share-buttons", ".navigation", ".post-navigation"];

export interface HybridDependencies {
  launchBrowser: () => Promise<Browser>;
  delay: () => Promise<void>;
}

const defaults: HybridDependencies = {
  launchBrowser: () => chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  }),
  delay: () => new Promise((resolve) => setTimeout(resolve, 2000)),
};

async function extractDetails(page: Page): Promise<{ title: string; contentHtml: string }> {
  return page.evaluate(({ selectors, unwanted }) => {
    const title = document.querySelector(selectors.TITLE)?.textContent?.trim() || "";
    const content = document.querySelector(selectors.CONTENT);
    if (!content) {
      return { title, contentHtml: "" };
    }
    const clone = content.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return { title: "", contentHtml: "" };
    }
    clone.querySelectorAll(unwanted.join(", ")).forEach((element) => {
      element.remove();
    });
    return { title, contentHtml: clone.innerHTML };
  }, { selectors: SELECTORS, unwanted: UNWANTED });
}

export function createHybridSource(dependencies: HybridDependencies = defaults): DataSource {
  let browser: Browser | undefined;
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  return {
    async discoverItems() {
      const items = extractFeedItems(await fetchFeedXml(FEED_URL));
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
          payload: { title: item.title, date: item.date },
        })),
      };
    },
    async fetchItem(item: DiscoveredItem): Promise<SourceContent> {
      const payload = item.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          !("title" in payload) || typeof payload.title !== "string" || !payload.title ||
          !("date" in payload) || typeof payload.date !== "string" || !payload.date) {
        throw new Error(`Missing feed metadata for ${item.identifier}`);
      }
      browser ??= await dependencies.launchBrowser();
      const page = await browser.newPage();
      let details: { title: string; contentHtml: string };
      try {
        await page.route("**/*", async (route) => {
          if (["image", "media", "font"].includes(route.request().resourceType())) {
            await route.abort();
            return;
          }
          await route.continue();
        });
        await page.goto(item.identifier, { waitUntil: "domcontentloaded" });
        details = await extractDetails(page);
        if (!details.contentHtml) {
          throw new Error(`Failed to extract content from ${item.identifier}`);
        }
      } finally {
        await page.close();
      }
      await dependencies.delay();
      return {
        title: details.title || payload.title,
        datePublished: payload.date,
        message: markdown.turndown(details.contentHtml),
      };
    },
    async close() {
      await browser?.close();
      browser = undefined;
    },
  };
}
