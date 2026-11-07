import {
  fetchFeedXml,
  parseRssFeedItems,
  RssFeedHttpError,
  type RssFeedItem,
} from "@oboapp/source-web-utils/rss";

export const FEED_URLS = [
  "публикации/полезна-информация",
  "новини",
  "публикации/saobshtenia",
  "публикации/инвестиционни-намерения",
  "обществениобсъждания",
].map((category) => `https://sredec-sofia.org/category/${category}/feed/`);

const MAX_PAGES_PER_FEED = 100;
const REQUEST_DELAY_MS = 2000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface DiscoveryDependencies {
  fetchFeed: typeof fetchFeedXml;
  delay: (milliseconds: number) => Promise<void>;
  now: () => Date;
}

const defaults: DiscoveryDependencies = {
  fetchFeed: fetchFeedXml,
  delay: (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }),
  now: () => new Date(),
};

export function extractFeedItems(xml: string): RssFeedItem[] {
  return parseRssFeedItems(xml, { hostname: "sredec-sofia.org" });
}

async function readPage(
  url: string,
  page: number,
  readFeed: typeof fetchFeedXml,
): Promise<RssFeedItem[]> {
  try {
    return extractFeedItems(await readFeed(url));
  } catch (error) {
    if (page > 1 && error instanceof RssFeedHttpError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

async function discoverFeed(
  feedUrl: string,
  cutoff: number,
  dependencies: DiscoveryDependencies,
): Promise<RssFeedItem[]> {
  const found = new Map<string, RssFeedItem>();
  for (let page = 1; page <= MAX_PAGES_PER_FEED; page++) {
    await dependencies.delay(REQUEST_DELAY_MS);
    const url = new URL(feedUrl);
    if (page > 1) {
      url.searchParams.set("paged", String(page));
    }
    const items = await readPage(url.toString(), page, dependencies.fetchFeed);
    if (items.length === 0) {
      return [...found.values()];
    }

    const recent = items.filter((item) => Date.parse(item.date) > cutoff);
    const newItems = recent.filter((item) => !found.has(item.url));
    for (const item of newItems) {
      found.set(item.url, item);
    }
    if (recent.length < items.length) {
      return [...found.values()];
    }
    if (newItems.length === 0) {
      throw new Error(`RSS pagination repeated a page for ${feedUrl}`);
    }
  }
  throw new Error(`RSS pagination exceeded ${MAX_PAGES_PER_FEED} pages for ${feedUrl}`);
}

/** Read the complete listing before returning candidates to the platform. */
export async function discoverRecentItems(
  overrides: Partial<DiscoveryDependencies> = {},
): Promise<RssFeedItem[]> {
  const dependencies = { ...defaults, ...overrides };
  const midnight = new Date(dependencies.now());
  midnight.setUTCHours(0, 0, 0, 0);
  const cutoff = midnight.getTime() - MAX_AGE_MS;
  const found = new Map<string, RssFeedItem>();
  for (const feedUrl of FEED_URLS) {
    const items = await discoverFeed(feedUrl, cutoff, dependencies);
    for (const item of items) {
      if (!found.has(item.url)) {
        found.set(item.url, item);
      }
    }
  }
  return [...found.values()];
}
