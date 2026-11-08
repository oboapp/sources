import type { DataSource } from "@oboapp/source-sdk";
import { createBrowserSource, type BrowserDependencies } from "@oboapp/source-web-utils/browser";

const INDEX_URL = "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/";

function acceptsUrl(url: string): boolean {
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url).toLowerCase();
  } catch {
    decodedUrl = url.toLowerCase();
  }

  return decodedUrl.startsWith("https://ilinden.sofia.bg/")
    && !decodedUrl.includes("/category/")
    && !decodedUrl.includes("/tag/")
    && !decodedUrl.includes("/page/")
    && !decodedUrl.includes("#");
}

export function createSourceWithDependencies(dependencies?: BrowserDependencies): DataSource {
  return createBrowserSource({
    indexUrl: INDEX_URL,
    selectors: {
      INDEX: {
        POST_CONTAINER: "article, .post, .type-post",
        POST_LINK: 'a[href*="ilinden.sofia.bg/"]',
        POST_DATE: 'time, .entry-date, .posted-on, [class*="date"]',
        POST_TITLE: 'h2, h3, .entry-title, [class*="title"]',
      },
      POST: {
        CONTENT: "article, .entry-content, .post-content, main",
        TITLE: "h1, .entry-title, .post-title",
        DATE: 'time, .entry-date, .posted-on, [class*="date"]',
      },
    },
    urlFilter: acceptsUrl,
    unwantedElements: [
      "script",
      "style",
      "nav",
      ".sharedaddy",
      ".share-buttons",
      ".navigation",
      ".post-navigation",
      ".wp-block-buttons",
      ".wp-block-social-links",
      ".related-posts",
      "footer",
    ],
  }, dependencies);
}
