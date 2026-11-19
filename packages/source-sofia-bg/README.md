# @oboapp/source-sofia-bg

Collects repairs, traffic changes and municipal news from Sofia. The source ID is `sofia-bg` and its locality is `bg.sofia`.

## Use

Install with `pnpm add --save-exact @oboapp/source-sofia-bg`. Obo passes the named `createSource` export and the browser-safe `metadata` export to its scheduled runner.

```ts
import { createSource } from "@oboapp/source-sofia-bg";
import { metadata } from "@oboapp/source-sofia-bg/metadata";

const source = createSource({ locality: "bg.sofia" });
try {
  let cursor: string | undefined;
  do {
    const page = await source.discoverItems(cursor);
    for (const item of page.items) {
      const content = await source.fetchItem(item);
      console.log(metadata.id, item.identifier, content.title);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
} finally {
  await source.close?.();
}
```

## Discovery and identity

The package reads the [repairs listing](https://www.sofia.bg/bg/repairs-and-traffic-changes) and the [news feed](https://www.sofia.bg/news/-/asset_publisher/1ZlMReQfODHE/rss). If the RSS request fails or returns a non-feed response, discovery uses the [public news listing](https://www.sofia.bg/bg/news). Each listing follows at most ten pages. An optional `isKnownArticle(url, title)` callback lets the consumer end pagination after a page of known notices. The optional `onWarning(message, detail)` reports use of the fallback and the page limit.

Discovery follows the historical treatment of article URLs. It strips query strings and fragments, retains the original Liferay link path and escaping, and prefers the repairs listing when it sees a URL alias in both sources. The package exports `articleUrlKey` for matching locale and guest aliases in the consumer's historical records. The discovery payload supplies the listing title. Obo uses that title to match older RSS records with different paths.

The runtime requires Node.js 20.3 or later and Chromium for Playwright 1.61.1. Listings and details reuse one browser per scan, wait for the DOM and block media, fonts and images. Successful details and subsequent listing pages are paced two seconds apart. The asset publisher and content page layouts supply Markdown; a missing detail title falls back to the listing title. Dates use the RSS timestamp or UTC midnight on the listing date.

If one discovery source fails, the current page contains the other source's candidates. Following its cursor reports the discovery error so the scheduler can retry. Article failures remain individual item failures. Always close the source when the scan ends.

## Tests and releases

Run `pnpm check` from the repository root. [Package tests](https://github.com/oboapp/sources/tree/main/packages/source-sofia-bg/test) · [Release guide](https://github.com/oboapp/sources/blob/main/RELEASING.md)
