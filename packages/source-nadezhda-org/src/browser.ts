import type { DataSource } from "@oboapp/source-sdk";
import { createBrowserSource, type BrowserDependencies } from "@oboapp/source-web-utils/browser";

const INDEX_URL = "https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F";

function acceptsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "nadezhda.sofia.bg" && parsed.pathname.includes("/news/");
  } catch {
    return false;
  }
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: "li.shadow-sm",
        POST_LINK: 'a[href*="/news/"]',
        POST_DATE: "small, .small, .date, [class*=date]",
        POST_TITLE: "a",
      },
      POST: {
        CONTENT: ".justify-content-center > div > .bg-white.mt-2 > .p-2, .justify-content-center > div .p-2",
        TITLE: ".justify-content-center > div > h1.pl-2, .justify-content-center h1.pl-2",
        DATE: ".justify-content-center > div > .bg-white.mt-2 > small.pl-2, .justify-content-center small.pl-2",
      },
    },
    urlFilter: acceptsUrl,
    dedupe: "last",
    unwantedElements: ["script", "style", "nav", "footer", ".breadcrumb"],
  }, dependencies);
}
