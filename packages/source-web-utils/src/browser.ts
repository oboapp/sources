import type { DataSource, SourceContent } from "@oboapp/source-sdk";
import { chromium, type Browser, type Page } from "playwright";
import TurndownService from "turndown";

export interface BrowserDependencies {
  launchBrowser: () => Promise<Browser>;
  delay: () => Promise<void>;
}

export interface BrowserSourceOptions {
  indexUrl: string;
  selectors: {
    INDEX: {
      POST_CONTAINER: string;
      POST_LINK: string;
      POST_TITLE: string;
      POST_DATE: string;
    };
    POST: {
      TITLE: string;
      DATE: string;
      CONTENT: string;
    };
  };
  urlFilter?: (url: string) => boolean;
  unwantedElements: readonly string[];
  dedupe?: "first" | "last";
}

const defaults: BrowserDependencies = {
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

/** Retain the legacy DD.MM.YYYY, DD.MM.YY and slash-date conversion and fallback. */
function parsePublicationDate(dateText: string): string {
  const normalized = dateText.trim().replaceAll("/", ".");
  const parts = normalized.split(".");
  if (parts.length === 3) {
    const [day = "", month = "", yearPart = ""] = parts;
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
    const date = new Date(`${year}-${month}-${day}`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

async function extractListing(page: Page, options: BrowserSourceOptions) {
  return page.evaluate((selectors) => {
    const posts: { url: string; title: string; date: string }[] = [];
    const containers = document.querySelectorAll(selectors.POST_CONTAINER);
    for (const container of Array.from(containers)) {
      const link = container.querySelector(selectors.POST_LINK);
      if (!link) {
        continue;
      }
      const url = link instanceof HTMLAnchorElement ? link.href : "";
      const title = container.querySelector(selectors.POST_TITLE)?.textContent?.trim() || "";
      const date = container.querySelector(selectors.POST_DATE)?.textContent?.trim() || "";
      if (url && title) {
        posts.push({ url, title, date });
      }
    }
    return posts;
  }, options.selectors.INDEX);
}

async function extractDetails(page: Page, options: BrowserSourceOptions) {
  return page.evaluate(({ selectors, unwantedElements }) => {
    const title = document.querySelector(selectors.TITLE)?.textContent?.trim() || "";
    const dateText = document.querySelector(selectors.DATE)?.textContent?.trim() || "";
    const content = document.querySelector(selectors.CONTENT);
    if (!content) {
      return { title, dateText, contentHtml: "" };
    }
    const clone = content.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return { title: "", dateText: "", contentHtml: "" };
    }
    const unwantedSelector = unwantedElements.join(", ");
    if (unwantedSelector) {
      for (const element of Array.from(clone.querySelectorAll(unwantedSelector))) {
        element.remove();
      }
    }
    return { title, dateText, contentHtml: clone.innerHTML };
  }, { selectors: options.selectors.POST, unwantedElements: options.unwantedElements });
}

/** Browser listing and detail collection, with source-owned selectors and no persistence. */
export function createBrowserSource(
  options: BrowserSourceOptions,
  dependencies: BrowserDependencies = defaults,
): DataSource {
  let browser: Browser | undefined;
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

  async function withPage<T>(url: string, extract: (page: Page) => Promise<T>): Promise<T> {
    let page: Page | undefined;
    try {
      browser ??= await dependencies.launchBrowser();
      page = await browser.newPage();
      await page.route("**/*", async (route) => {
        if (["image", "media", "font"].includes(route.request().resourceType())) {
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return await extract(page);
    } finally {
      try {
        await page?.close();
      } finally {
        // Pace listing and detail attempts, including failed provider requests.
        await dependencies.delay();
      }
    }
  }

  return {
    async discoverItems() {
      const posts = await withPage(options.indexUrl, async (page) => {
        return extractListing(page, options);
      });
      const urlFilter = options.urlFilter;
      const filtered = urlFilter
        ? posts.filter((post) => {
          return urlFilter(post.url);
        })
        : posts;
      let candidates = filtered;
      if (options.dedupe === "last") {
        candidates = Array.from(new Map(filtered.map((post) => {
          return [post.url, post] as const;
        })).values());
      } else if (options.dedupe === "first") {
        const seen = new Set<string>();
        candidates = filtered.filter((post) => {
          if (seen.has(post.url)) {
            return false;
          }
          seen.add(post.url);
          return true;
        });
      }
      return {
        items: candidates.map((post) => {
          return { identifier: post.url };
        }),
      };
    },
    async fetchItem(item): Promise<SourceContent> {
      return withPage(item.identifier, async (page) => {
        const details = await extractDetails(page, options);
        if (!details.title) {
          throw new Error(`Failed to extract title from ${item.identifier}`);
        }
        if (!details.contentHtml) {
          throw new Error(`Failed to extract content from ${item.identifier}`);
        }
        return {
          title: details.title,
          datePublished: parsePublicationDate(details.dateText),
          message: markdown.turndown(details.contentHtml),
        };
      });
    },
    async close() {
      const current = browser;
      browser = undefined;
      await current?.close();
    },
  };
}
