import type { DataSource } from "@oboapp/source-sdk";
import { createBrowserSource, type BrowserDependencies } from "@oboapp/source-web-utils/browser";
import { parseInspectoratDate } from "./dates.js";

const INDEX_URL = "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8";

function acceptsUrl(url: string): boolean {
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url).toLowerCase();
  } catch {
    decodedUrl = url.toLowerCase();
  }
  return decodedUrl.includes("inspectorat-so.org") && decodedUrl.includes("newsid=");
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: ".newsContent",
        POST_LINK: '.titleLink[href*="newsid="]',
        POST_DATE: ".dateCreated",
        POST_TITLE: "h2",
      },
      POST: {
        CONTENT: '[itemprop="articleBody"] > .col-md-12 > div[style*="font-size:14pt"]',
        TITLE: '[itemprop="articleBody"] > .col-md-12 > h2',
        DATE: '[itemprop="articleBody"] .dateCreated, [itemprop="datePublished"], time',
      },
    },
    urlFilter: acceptsUrl,
    dedupe: "last",
    unwantedElements: ["script", "style", "nav", "footer", ".breadcrumb", ".article-info"],
    parsePublicationDate(dateText, post) {
      return parseInspectoratDate(dateText, post.date);
    },
  }, dependencies);
}
