import type { DataSource } from "@oboapp/source-sdk";
import {
  createBrowserSource,
  parseBulgarianMonthDate,
  type BrowserDependencies,
} from "@oboapp/source-web-utils/browser";

const INDEX_URL = "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8";

function acceptsUrl(url: string): boolean {
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url).toLowerCase();
  } catch {
    decodedUrl = url.toLowerCase();
  }
  return decodedUrl.includes("новини/") && /\/\d+\/?$/.test(decodedUrl);
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: ".card",
        POST_LINK: "a.card__title",
        POST_TITLE: "a.card__title",
        POST_DATE: ".card__meta",
      },
      POST: {
        TITLE: "h1.page-title",
        DATE: ".page-content__header small",
        CONTENT: ".page-content",
      },
    },
    urlFilter: acceptsUrl,
    unwantedElements: ["script", "style", "nav", "img"],
    parsePublicationDate: parseBulgarianMonthDate,
  }, dependencies);
}
