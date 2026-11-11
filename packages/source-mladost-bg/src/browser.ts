import type { DataSource } from "@oboapp/source-sdk";
import {
  createBrowserSource,
  parseBulgarianMonthDate,
  type BrowserDependencies,
} from "@oboapp/source-web-utils/browser";

const INDEX_URL = "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti";

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: "article.blog-card",
        POST_LINK: 'a[href*="/planovi-remonti/"]',
        POST_DATE: "time",
        POST_TITLE: "h3.blog-card__title",
      },
      POST: {
        CONTENT: "div.article-body",
        TITLE: "h1.article-title",
        DATE: "time",
      },
    },
    urlFilter(url) {
      return url.includes("/planovi-remonti/");
    },
    unwantedElements: ["script", "style"],
    parsePublicationDate: parseBulgarianMonthDate,
  }, dependencies);
}
