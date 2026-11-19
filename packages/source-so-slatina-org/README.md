# @oboapp/source-so-slatina-org

Collects the Slatina district feed and extracts new article pages with Playwright. The source preserves the existing crawler's URL identity, RSS publication date, page title fallback, HTML cleanup, and Markdown conversion. It launches Chromium lazily and closes it at the end of a scan. The runtime requires a compatible Playwright Chromium installation. The metadata entrypoint does not load Playwright.

The package pins Playwright 1.61.1 to match the version currently resolved in the Obo deployment image. Keep the package and image versions aligned when upgrading Playwright so the installed Chromium revision is available to the source.

Each scan reads the root RSS feed at https://so-slatina.org/feed/. It deduplicates literal links within that feed. A feed failure rejects discovery. An article failure rejects that item and the package closes its page. Obo can retry it on a later scan.

## Use

Install with `pnpm add --save-exact @oboapp/source-so-slatina-org`. Obo passes the factory and metadata to its scheduled runner. To preview the same source directly, run this example.

```ts
import { createSource } from "@oboapp/source-so-slatina-org";
import { metadata } from "@oboapp/source-so-slatina-org/metadata";

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

Run `pnpm check` from the repository root to build and test the package. [Package tests](https://github.com/oboapp/sources/tree/main/packages/source-so-slatina-org/test) · [Release guide](https://github.com/oboapp/sources/blob/main/RELEASING.md)
