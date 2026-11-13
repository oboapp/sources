import type { DataSource } from "@oboapp/source-sdk";
import {
  createBrowserSource,
  type BrowserDependencies,
  type BrowserPostLink,
} from "@oboapp/source-web-utils/browser";
import type { Page } from "playwright";
import { extractDateCandidate, isDateRelevant, parseBulgarianDateOrRange, parsePancharevoDateToIso } from "./dates.js";
import { metadata } from "./metadata.js";

const selectors = {
  INDEX: {
    POST_CONTAINER: "div.items-row article.item, article.item",
    POST_LINK: "a.readM, h2[itemprop='name'] a, a[itemprop='url']",
    POST_DATE: "div.col-md-9:not(.entry-header), .introtext, p",
    POST_TITLE: "h2[itemprop='name'], h2, h3, .entry-title, .post-title",
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
  return path.includes("/ремонти-и-инфраструктура/") && !parsed.searchParams.has("start");
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
  return page.evaluate((postSelectors) => {
    const title = document.querySelector(postSelectors.TITLE)?.textContent?.trim() || "";
    let dateText = document.querySelector(postSelectors.DATE)?.textContent?.trim() || "";
    const content = document.querySelector(postSelectors.CONTENT);
    if (!content) {
      return { title, dateText, contentHtml: "" };
    }
    const clone = content.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return { title: "", dateText: "", contentHtml: "" };
    }
    for (const element of Array.from(clone.querySelectorAll("script, style, nav, footer, .sharedaddy, .share-buttons, .post-navigation"))) {
      element.remove();
    }
    if (!dateText) {
      const paragraph = document.querySelector("article.item-page [itemprop='articleBody'] p, [itemprop='articleBody'] p, article.item-page p");
      dateText = title || paragraph?.textContent?.trim() || "";
    }
    return { title, dateText, contentHtml: clone.innerHTML };
  }, selectors.POST);
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: metadata.url,
    selectors,
    urlFilter: acceptsUrl,
    filterPost: isRelevantPost,
    extractDetails,
    parsePublicationDate: parsePancharevoDateToIso,
    unwantedElements: [],
  }, dependencies);
}
