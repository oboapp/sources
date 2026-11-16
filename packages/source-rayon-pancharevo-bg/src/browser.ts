import type { DataSource } from "@oboapp/source-sdk";
import {
  createBrowserSource,
  type BrowserDependencies,
  type BrowserPostLink,
} from "@oboapp/source-web-utils/browser";
import { fetchFeedXml, parseRssFeedItems } from "@oboapp/source-web-utils/rss";
import type { Page } from "playwright";
import { extractDateCandidate, isDateRelevant, parseArticlePublicationDate, parseBulgarianDateOrRange, parsePancharevoDateToIso } from "./dates.js";
import { metadata } from "./metadata.js";

export const FEED_URL = `${metadata.url}?format=feed&type=rss`;

const selectors = {
  INDEX: {
    POST_CONTAINER: "article.blog-card",
    POST_LINK: "a[href*='/planovi-remonti/']",
    POST_DATE: "time",
    POST_TITLE: "h3.blog-card__title",
  },
  POST: {
    CONTENT: "article.item-page [itemprop='articleBody'], [itemprop='articleBody'], article.item-page, main",
    TITLE: "article.item-page h2[itemprop='name'], h1, .entry-title, .post-title",
    DATE: "article.item-page [itemprop='articleBody'] p:first-child, .article-info, time",
  },
};

function acceptsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  let path = parsed.pathname.toLowerCase();
  try {
    path = decodeURIComponent(path).toLowerCase();
  } catch {
    // The legacy collector keeps malformed percent sequences in the raw path.
  }
  const articlePath = path.includes("/ремонти-и-инфраструктура/")
    || path.startsWith("/gradska-i-okolna-sreda/planovi-remonti/");
  return articlePath && !parsed.searchParams.has("start");
}

function isRelevantPost(post: BrowserPostLink): boolean {
  const candidate = extractDateCandidate(`${post.date} ${post.title}`.trim());
  if (!candidate) {
    return true;
  }
  try {
    return isDateRelevant(parseBulgarianDateOrRange(candidate));
  } catch {
    return true;
  }
}

async function extractDetails(page: Page) {
  const details = await page.evaluate((postSelectors) => {
    const article = document.querySelector("article#article_view_news");
    const isCurrentArticle = Boolean(article);
    const titleElement = article
      ? article.querySelector("h1.article-title")
      : document.querySelector(postSelectors.TITLE);
    const title = titleElement?.textContent?.trim() || "";
    let dateText = article
      ? article.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() || ""
      : document.querySelector(postSelectors.DATE)?.textContent?.trim() || "";
    const content = article
      ? article.querySelector(".article-body")
      : document.querySelector(postSelectors.CONTENT);
    if (!content) {
      return { title, dateText, contentHtml: "", isCurrentArticle };
    }
    const clone = content.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return { title: "", dateText: "", contentHtml: "", isCurrentArticle };
    }
    for (const element of Array.from(clone.querySelectorAll("script, style, nav, footer, .sharedaddy, .share-buttons, .post-navigation"))) {
      element.remove();
    }
    if (!article && !dateText) {
      const paragraph = document.querySelector("article.item-page [itemprop='articleBody'] p, [itemprop='articleBody'] p, article.item-page p");
      dateText = title || paragraph?.textContent?.trim() || "";
    }
    return { title, dateText, contentHtml: clone.innerHTML, isCurrentArticle };
  }, selectors.POST);
  return {
    title: details.title,
    dateText: details.isCurrentArticle
      ? parseArticlePublicationDate(details.dateText)
      : details.dateText,
    contentHtml: details.contentHtml,
  };
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  const articles = createBrowserSource({
    indexUrl: metadata.url,
    selectors,
    urlFilter: acceptsUrl,
    filterPost: isRelevantPost,
    extractDetails,
    parsePublicationDate: parsePancharevoDateToIso,
    unwantedElements: [],
  }, dependencies);

  async function paceFeedRequest(): Promise<void> {
    if (dependencies) {
      await dependencies.delay();
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });
  }

  return {
    async discoverItems() {
      try {
        const feed = parseRssFeedItems(await fetchFeedXml(FEED_URL));
        const identifiers = new Set<string>();
        for (const item of feed) {
          // RSS dates are publication dates; only title dates describe an event window.
          if (acceptsUrl(item.url) && isRelevantPost({ ...item, date: "" })) {
            identifiers.add(item.url);
          }
        }
        return {
          items: Array.from(identifiers, (identifier) => {
            return { identifier };
          }),
        };
      } finally {
        await paceFeedRequest();
      }
    },
    fetchItem(item) {
      return articles.fetchItem(item);
    },
    async close() {
      await articles.close?.();
    },
  };
}
