import type { DataSource } from "@oboapp/source-sdk";
import { createBrowserSource, type BrowserDependencies } from "@oboapp/source-web-utils/browser";

const INDEX_URL = "https://raioniskar.bg/?c=pages/static&template=home&lang=bg";

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: ".articles.list.type-important_messages .article",
        POST_LINK: "h2.title a",
        POST_DATE: ".date-and-category",
        POST_TITLE: "h2.title a",
      },
      POST: {
        CONTENT: ".articles.view",
        TITLE: "h1.title",
        DATE: ".date-and-category",
      },
    },
    urlFilter: (url) => {
      return url.includes("important_messages/show/");
    },
    unwantedElements: ["script", "style", "nav", ".bottomNav", "footer"],
  }, dependencies);
}
