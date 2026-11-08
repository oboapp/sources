# @oboapp/source-rayon-ilinden-bg

Collects the Municipality category from Sofia district Ilinden. Chromium reads the listing and each article. The package preserves the existing `rayon-ilinden-bg` identity, literal identifiers, detail title/date behavior, content cleanup and Markdown output.

## Install and use

```sh
pnpm add @oboapp/source-rayon-ilinden-bg
```

Pass the runtime factory and isolated metadata to Obo's scheduled source runner:

```ts
import { createSource } from "@oboapp/source-rayon-ilinden-bg";
import { metadata } from "@oboapp/source-rayon-ilinden-bg/metadata";
```

The metadata entrypoint can be loaded by the web catalog without loading browser dependencies. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, followed by `discoverItems()` and `fetchItem(item)`. Always call `await source.close?.()` in `finally`.

Obo owns historical lookups, validation, persistence, scheduling, ingestion and notifications. Updating this package preserves historical identifiers.

## Collection behavior

The legacy URL filter accepts the HTTPS Ilinden host and rejects category, tag, pagination and fragment links. Repeated listing identifiers remain repeated discovery items. Percent-encoded spelling is retained. Discovery returns identifiers only. A listing title is required to select an entry. Detail metadata comes only from the article page.

Details require a non-empty page title and content. The detail date uses the existing Bulgarian numeric date conversion, including two-digit years and slash separators. An empty or unparseable detail date falls back to the current time. Cleaned HTML becomes Markdown with document links preserved.

One Chromium browser is reused for the scan. Each listing/detail attempt closes its page and waits two seconds, including failed attempts. Image, media and font requests are blocked. Provider failures propagate to Obo, which records item failures and retries missing identifiers on a later scheduled scan.

The runtime requires Node.js 20.3 or later and `@oboapp/source-web-utils` with Playwright 1.61.1 and its matching Chromium revision and system libraries. Keep that browser revision aligned with the deployment image.

## Feed and API check

Both the root RSS feed and category RSS feed returned HTTP 500 when checked on 8 November 2026. The WordPress API at `https://ilinden.sofia.bg/wp-json/wp/v2/posts` works, and the category page advertises category 43. This initial extraction retains the existing DOM anchors, selection and detail-date behavior. Replacing discovery with API canonical links needs a separate compatibility review.

## Tests and release

Tests protect literal URLs, filtering, duplicate behavior, detail-only metadata, date conversion, cleanup, retry/session handling and isolated ESM/CommonJS metadata. Synthetic DOM fixtures cover edge cases. Public listing and detail fragments captured on 8 November 2026 include identifiers and content frozen from the original source-specific extractors, date parser and Markdown builder. They run without provider requests.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for package checks, tarball inspection, publication and Obo integration.
