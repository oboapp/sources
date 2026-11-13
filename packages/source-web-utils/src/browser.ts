import type { DataSource, SourceContent } from "@oboapp/source-sdk";
import { chromium, type Browser, type Page } from "playwright";
import TurndownService from "turndown";

export interface BrowserDependencies {
  launchBrowser: () => Promise<Browser>;
  delay: () => Promise<void>;
}

export interface BrowserPostLink {
  url: string;
  title: string;
  date: string;
}

export interface BrowserPostDetails {
  title: string;
  dateText: string;
  contentHtml: string;
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
  extractListing?: (page: Page) => Promise<BrowserPostLink[]>;
  extractDetails?: (page: Page) => Promise<BrowserPostDetails>;
  filterPost?: (post: BrowserPostLink) => boolean;
  parsePublicationDate?: (dateText: string, post: BrowserPostLink) => string;
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
export function parseBulgarianDate(dateText: string): string {
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

const bulgarianMonths: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

/** Retain local-midnight month-name conversion and current-time fallback. */
export function parseBulgarianMonthDate(dateText: string): string {
  const match = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(dateText.trim());
  if (!match) {
    return new Date().toISOString();
  }
  const [, dayText = "", monthName = "", yearText = ""] = match;
  const month = bulgarianMonths[monthName.toLowerCase()];
  if (!month) {
    return new Date().toISOString();
  }
  const day = Number.parseInt(dayText, 10);
  const year = Number.parseInt(yearText, 10);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())
      || date.getDate() !== day
      || date.getMonth() !== month - 1
      || date.getFullYear() !== year) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

async function extractListing(page: Page, options: BrowserSourceOptions): Promise<BrowserPostLink[]> {
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

async function extractDetails(page: Page, options: BrowserSourceOptions): Promise<BrowserPostDetails> {
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
  const listingPosts = new Map<string, BrowserPostLink>();
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
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) {
        throw new Error(`HTTP ${response.status()} while loading ${url}`);
      }
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
      listingPosts.clear();
      const posts = await withPage(options.indexUrl, async (page) => {
        if (options.extractListing) {
          return options.extractListing(page);
        }
        return extractListing(page, options);
      });
      const urlFilter = options.urlFilter;
      const matchingUrls = urlFilter
        ? posts.filter((post) => {
          return urlFilter(post.url);
        })
        : posts;
      const filterPost = options.filterPost;
      const filtered = filterPost
        ? matchingUrls.filter((post) => {
          return filterPost(post);
        })
        : matchingUrls;
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
          listingPosts.set(post.url, post);
          return { identifier: post.url };
        }),
      };
    },
    async fetchItem(item): Promise<SourceContent> {
      return withPage(item.identifier, async (page) => {
        const details = options.extractDetails
          ? await options.extractDetails(page)
          : await extractDetails(page, options);
        if (!details.title) {
          throw new Error(`Failed to extract title from ${item.identifier}`);
        }
        if (!details.contentHtml) {
          throw new Error(`Failed to extract content from ${item.identifier}`);
        }
        return {
          title: details.title,
          datePublished: (options.parsePublicationDate ?? parseBulgarianDate)(
            details.dateText,
            listingPosts.get(item.identifier) ?? { url: item.identifier, title: "", date: "" },
          ),
          message: markdown.turndown(details.contentHtml),
        };
      });
    },
    async close() {
      const current = browser;
      browser = undefined;
      listingPosts.clear();
      await current?.close();
    },
  };
}
