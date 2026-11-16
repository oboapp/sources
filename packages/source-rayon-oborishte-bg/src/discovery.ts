import {
  fetchFeedXml,
  RSS_FEED_FETCH_TIMEOUT_MS,
} from "@oboapp/source-web-utils/rss";
import type { RssFeedItem } from "@oboapp/source-web-utils/rss";
import { decode } from "html-entities";
import { extractFeedItems } from "./extractors.js";
import type { SourceOptions } from "./options.js";

const FEED_URL = "https://rayon-oborishte.bg/feed/";
const DISCOVERY_LIMIT = 10;
const POSTS_URL =
  `https://rayon-oborishte.bg/wp-json/wp/v2/posts?per_page=${DISCOVERY_LIMIT}&orderby=date&order=desc`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidPost(index: number, reason: string): Error {
  return new Error(`WordPress posts API returned invalid post ${index}: ${reason} for ${POSTS_URL}`);
}

function stripTitleMarkup(value: string): string {
  const parts: string[] = [];
  let textStart = 0;
  let tagStart = -1;
  let quote: string | undefined;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (tagStart === -1) {
      if (character === "<") {
        tagStart = index;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      parts.push(value.slice(textStart, tagStart));
      textStart = index + 1;
      tagStart = -1;
    }
  }
  parts.push(value.slice(textStart));
  return parts.join("");
}

function readPublicationDate(value: unknown, index: number): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw invalidPost(index, "missing or invalid date_gmt");
  }
  const timestamp = Date.parse(`${value}Z`);
  if (!Number.isFinite(timestamp)) {
    throw invalidPost(index, "invalid date_gmt");
  }
  const date = new Date(timestamp).toISOString();
  if (date !== `${value}.000Z`) {
    throw invalidPost(index, "invalid date_gmt calendar value");
  }
  return date;
}

function parsePost(value: unknown, index: number): RssFeedItem {
  if (!isRecord(value) || typeof value.link !== "string" || !isRecord(value.title)
      || typeof value.title.rendered !== "string") {
    throw invalidPost(index, "missing link or title.rendered");
  }
  let url: URL;
  try {
    url = new URL(value.link);
  } catch {
    throw invalidPost(index, "invalid link");
  }
  if (url.origin !== "https://rayon-oborishte.bg" || url.username || url.password) {
    throw invalidPost(index, "unexpected link origin");
  }
  const title = decode(stripTitleMarkup(value.title.rendered)).trim();
  if (!title) {
    throw invalidPost(index, "empty title.rendered");
  }
  return {
    url: value.link,
    title,
    date: readPublicationDate(value.date_gmt, index),
  };
}

async function fetchWordPressPosts(): Promise<RssFeedItem[]> {
  let response: Response;
  try {
    response = await fetch(POSTS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(RSS_FEED_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WordPress posts API request failed for ${POSTS_URL}: ${message}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`WordPress posts API returned ${response.status} for ${POSTS_URL}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`WordPress posts API returned invalid JSON for ${POSTS_URL}`, { cause: error });
  }
  if (!Array.isArray(payload) || payload.length > DISCOVERY_LIMIT) {
    throw new Error(`WordPress posts API returned an invalid post list for ${POSTS_URL}`);
  }
  return payload.map((post, index) => {
    return parsePost(post, index);
  });
}

async function reportRssFailure(error: unknown, options: SourceOptions): Promise<void> {
  try {
    await options.onRssFailure?.(error);
  } catch {
    // Reporting failures must leave API recovery available.
  }
}

export async function discoverFeedItems(
  delay: () => Promise<void>,
  options: SourceOptions = {},
): Promise<RssFeedItem[]> {
  try {
    return extractFeedItems(await fetchFeedXml(FEED_URL));
  } catch (error) {
    await reportRssFailure(error, options);
    try {
      await delay();
      return await fetchWordPressPosts();
    } catch (fallbackError) {
      const rssMessage = error instanceof Error ? error.message : String(error);
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`RSS discovery failed for ${FEED_URL}: ${rssMessage}; WordPress fallback failed: ${message}`, {
        cause: new AggregateError([error, fallbackError], "RSS discovery and WordPress fallback failed"),
      });
    }
  }
}
