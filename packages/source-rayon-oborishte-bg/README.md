# @oboapp/source-rayon-oborishte-bg

Collects publications across all categories on the Oborishte district website, including tenders, general notices, ecology, and repairs. It extracts new article pages with Playwright and preserves the existing crawler's URL identity, publication date, page title fallback, HTML cleanup, and Markdown conversion. It launches Chromium lazily and closes it at the end of a scan. The runtime requires a compatible Playwright Chromium installation. The metadata entrypoint does not load Playwright.

Discovery first uses the site's [root RSS feed](https://rayon-oborishte.bg/feed/), which currently lists the newest ten publications. If RSS fetching or parsing throws, the source waits two seconds and requests the newest ten publications across all categories from the [public WordPress posts API](https://rayon-oborishte.bg/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc). The API supplies the original article link and UTC `date_gmt`; article content still comes from the existing browser extraction. On 2026-11-16, all ten root RSS items matched the API's identifiers, titles, and publication dates. A valid empty RSS feed remains a successful empty discovery.

Pass an optional `onRssFailure(error)` callback as the second argument to `createSource(context, options)` to report RSS failures even when API recovery succeeds. It receives the original error exactly once before the recovery delay. It can return a promise, and reporting failures do not block API recovery. Obo can connect this callback to Sentry while the package remains independent of a monitoring service.

Failed API requests and malformed API metadata fail discovery before any article browser starts. The combined error includes both failure messages and retains the original RSS and API errors in its `AggregateError` cause.

The package pins Playwright 1.61.1 to match the version currently resolved in the Obo deployment image. Keep the package and image versions aligned when upgrading Playwright so the installed Chromium revision is available to the source.

A detail failure rejects that article and closes its page. Obo can retry it on a later scan.

## Use

Install with `pnpm add --save-exact @oboapp/source-rayon-oborishte-bg`. Obo passes the factory and metadata to its scheduled runner. To preview the same source directly, run this example.

```ts
import { createSource } from "@oboapp/source-rayon-oborishte-bg";
import { metadata } from "@oboapp/source-rayon-oborishte-bg/metadata";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(metadata.id, item.identifier, content.title);
  }
} finally {
  await source.close?.();
}
```

## Testing and releases

Run `pnpm check` from the repository root to build and test the package. [Package tests](https://github.com/oboapp/sources/tree/main/packages/source-rayon-oborishte-bg/test) · [Release guide](https://github.com/oboapp/sources/blob/main/RELEASING.md)
