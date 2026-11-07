# Sredets source

`@oboapp/source-sredec-sofia-org` collects public notices from Sofia district Sredets. Its persisted source ID is `sredec-sofia-org`, with locality `bg.sofia`.

## Install and use

Use Node.js 20.3 or later and install the package with `pnpm add @oboapp/source-sredec-sofia-org`. Article collection uses Playwright Chromium. Install the browser revision required by `@oboapp/source-web-utils` and its operating-system dependencies in the runtime image.

```ts
import { createSource } from "@oboapp/source-sredec-sofia-org";
import { metadata } from "@oboapp/source-sredec-sofia-org/metadata";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(metadata.id, item.identifier, content);
  }
} finally {
  await source.close?.();
}
```

The `/metadata` entrypoint is safe for browser catalogs and does not load collection code. Obo owns scheduling, historical-record lookup, validation, persistence, and ingestion.

## Discovery and coverage

Discovery reads five category feeds: useful information, news, announcements, investment notices, and public discussions. It follows `?paged=` links within each category and returns one complete discovery page. URLs keep the legacy parser's spelling, including percent encoding and query strings. Cross-category duplicates retain the metadata from the first configured feed that listed them.

The scan covers items newer than midnight UTC minus 90 days, using the same strict age boundary as the existing collector. It waits two seconds before each feed request and stops a feed at an empty page, a later-page HTTP 404, or a page containing older items. A missing first page, a repeated page, another provider failure, or more than 100 pages makes discovery fail. The next scheduled scan lists again from the beginning.

Article content is fetched in a reused browser. The page title is preferred, with the feed title as fallback; the publication date always comes from RSS. Scripts and styles are removed, and content is converted to Markdown. A successful article request is followed by a two-second delay. Each opened article page is closed after success or failure, and `close()` releases the shared browser.

Feed history and provider removals limit available notices to the current 90-day window. Article output retains document links for ingestion. Obo skips known identifiers, including after package updates, and historical identifiers remain unchanged across versions.

## Checks and releases

Run `pnpm check` from the sources repository root. Tests cover captured category feeds, pagination and age boundaries, exact identifiers and content, browser cleanup, and ESM/CommonJS entrypoints. See [RELEASING.md](../../RELEASING.md) for package inspection and independent SemVer releases. Obo's migration is tracked in [#586](https://github.com/oboapp/oboapp/issues/586) and [#609](https://github.com/oboapp/oboapp/issues/609).
