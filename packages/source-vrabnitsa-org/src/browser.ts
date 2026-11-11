import type { DataSource } from "@oboapp/source-sdk";
import { createBrowserSource, type BrowserDependencies } from "@oboapp/source-web-utils/browser";
import type { Page } from "playwright";
import { parsePublicationDate } from "./date.js";

const indexUrl = "https://vrabnitsa.sofia.bg/aktualno/news";
const selectors = {
  INDEX: {
    POST_CONTAINER: "article.blog-card.so_article",
    POST_LINK: "h3.blog-card__title a",
    POST_TITLE: "h3.blog-card__title",
    POST_DATE: "time",
  },
  POST: {
    CONTENT: "div.article-body",
    TITLE: "h1.article-title",
    DATE: "time",
  },
};
const unwantedElements = [
  "script",
  "style",
  ".article-aside",
  ".pager",
  ".icons",
  ".btn-group",
  ".navigation",
];

function acceptsUrl(url: string): boolean {
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url).toLowerCase();
  } catch {
    decodedUrl = url.toLowerCase();
  }
  return decodedUrl.includes("/aktualno/news/")
    && !decodedUrl.includes("/page/")
    && !decodedUrl.includes("#");
}

async function extractDetails(page: Page) {
  return page.evaluate(({ selectors, unwantedElements }) => {
    const title = document.querySelector(selectors.TITLE)?.textContent?.trim() || "";
    const dateElement = document.querySelector(selectors.DATE);
    const dateText = dateElement?.getAttribute("datetime")?.trim()
      || dateElement?.textContent?.replace(/\s+/g, " ").trim()
      || "";
    const content = document.querySelector(selectors.CONTENT);
    let contentHtml = "";
    if (content) {
      const clone = content.cloneNode(true);
      if (!(clone instanceof HTMLElement)) {
        return { title, dateText, contentHtml };
      }
      for (const element of Array.from(clone.querySelectorAll(unwantedElements.join(", ")))) {
        element.remove();
      }
      contentHtml = clone.innerHTML;
    }
    return { title, dateText, contentHtml };
  }, { selectors: selectors.POST, unwantedElements });
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl,
    selectors,
    urlFilter: acceptsUrl,
    unwantedElements,
    extractDetails,
    parsePublicationDate,
  }, dependencies);
}
