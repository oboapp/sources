import type { Browser, Page } from "playwright";
import { extractListingPage, type Article } from "./pages.js";

export interface SofiaOptions {
  /** A page containing only known articles ends pagination for this listing. */
  isKnownArticle?: (url: string, title: string) => boolean;
  onWarning?: (message: string, detail: unknown) => void | Promise<void>;
}

const MAX_LISTING_PAGES = 10;

export async function reportWarning(options: SofiaOptions, message: string, detail: unknown): Promise<void> {
  try {
    await options.onWarning?.(message, detail);
  } catch {
    // A reporting failure must leave the recovered articles available to the caller.
  }
}

export async function navigate(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response?.ok()) {
    throw new Error(`Sofia HTTP ${response?.status() ?? "no response"}: ${url}`);
  }
}

export async function blockMedia(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    if (["image", "media", "font"].includes(route.request().resourceType())) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
}

export async function discoverListing(
  browser: Browser,
  listingUrl: string,
  options: SofiaOptions,
  delay: () => Promise<void>,
): Promise<Article[]> {
  const page = await browser.newPage();
  const posts: Article[] = [];
  const visited = new Set<string>();
  let url: string | null = listingUrl;
  try {
    await blockMedia(page);
    while (url && visited.size < MAX_LISTING_PAGES) {
      if (visited.has(url)) {
        throw new Error(`Listing pagination repeated a page: ${url}`);
      }
      visited.add(url);
      await navigate(page, url);
      const listing = await extractListingPage(page, listingUrl);
      if (listing.posts.length === 0) {
        throw new Error(`No dated articles found on listing: ${url}`);
      }
      posts.push(...listing.posts);
      if (listing.posts.every((post) => options.isKnownArticle?.(post.url, post.title))) {
        return posts;
      }
      url = listing.nextUrl;
      if (url && visited.size < MAX_LISTING_PAGES) {
        await delay();
      }
    }
    if (url) {
      await reportWarning(options, "Sofia listing reached page safety limit", { listingUrl, pages: visited.size });
    }
    return posts;
  } finally {
    await page.close();
  }
}
