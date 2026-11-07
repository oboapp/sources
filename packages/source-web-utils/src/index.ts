import type { DataSource, DiscoveredItem, SourceContent } from "@oboapp/source-sdk";
import { chromium, type Browser, type Page } from "playwright";
import TurndownService from "turndown";
import type { RssFeedItem } from "./rss.js";

export interface HybridDependencies {
  launchBrowser: () => Promise<Browser>;
  delay: () => Promise<void>;
}

export interface HybridSourceOptions {
  discoverItems: () => Promise<RssFeedItem[]>;
  selectors: {
    TITLE: string;
    CONTENT: string;
  };
  unwantedElements: readonly string[];
}

const defaults: HybridDependencies = {
  launchBrowser() {
    return chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  },
  delay() {
    return new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  },
};

async function extractDetails(page: Page, options: HybridSourceOptions) {
  return page.evaluate(({ selectors, unwantedElements }) => {
    const title = document.querySelector(selectors.TITLE)?.textContent?.trim() || "";
    const content = document.querySelector(selectors.CONTENT);
    if (!content) {
      return { title, contentHtml: "" };
    }
    const clone = content.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return { title: "", contentHtml: "" };
    }
    const unwantedSelector = unwantedElements.join(", ");
    if (unwantedSelector) {
      clone.querySelectorAll(unwantedSelector).forEach((element) => {
        element.remove();
      });
    }
    return { title, contentHtml: clone.innerHTML };
  }, { selectors: options.selectors, unwantedElements: options.unwantedElements });
}

function readFeedMetadata(item: DiscoveredItem): { title: string; date: string } {
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !("title" in payload) || typeof payload.title !== "string" || !payload.title
      || !("date" in payload) || typeof payload.date !== "string" || !payload.date) {
    throw new Error(`Missing feed metadata for ${item.identifier}`);
  }
  return { title: payload.title, date: payload.date };
}

/** RSS discovery and lazy browser detail collection, with no persistence. */
export function createHybridSource(
  options: HybridSourceOptions,
  dependencies: HybridDependencies = defaults,
): DataSource {
  let browser: Browser | undefined;
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  return {
    async discoverItems() {
      const seen = new Set<string>();
      const items = await options.discoverItems();
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
      const payload = readFeedMetadata(item);
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
        details = await extractDetails(page, options);
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
      const current = browser;
      browser = undefined;
      await current?.close();
    },
  };
}
