# @oboapp/source-rayon-pancharevo-bg

Collects the planned-repairs RSS feed and article pages from Sofia district Pancharevo. The package preserves the `rayon-pancharevo-bg` identity, literal article URLs, Bulgarian event-date filtering and cleaned Markdown content.

## Use

```sh
pnpm add @oboapp/source-rayon-pancharevo-bg
```

```ts
import { createSource } from "@oboapp/source-rayon-pancharevo-bg";
import { metadata } from "@oboapp/source-rayon-pancharevo-bg/metadata";
```

Pass the runtime factory and browser-safe metadata to Obo's source runner. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, then `discoverItems()` and `fetchItem(item)`. Call `await source.close?.()` in `finally`.

## Compatibility

Discovery reads the first page of the [advertised RSS feed](https://www.pancharevo.org/gradska-i-okolna-sreda/planovi-remonti?format=feed&type=rss). It accepts the current planned-repairs article paths and legacy infrastructure paths, excludes URLs with a `start` query parameter, and removes duplicate URLs. Percent encoding, query strings and fragments remain part of the identifier.

The legacy Bulgarian event-date filter now reads titles, because the feed descriptions are empty or image-only. A recognized event date or range must contain today's local calendar date. Missing and invalid title dates remain eligible. Feed publication dates describe when an article was published and are excluded from this event-date test. Articles can contain event dates absent from their titles; Obo's ingestion pipeline still evaluates their full content.

Current articles use the scoped `.article-body` content and the article's `time[datetime]` publication timestamp. The provider's RSS publication timestamps can contain an extra timezone offset, so the article timestamp is authoritative. Missing or invalid current article timestamps fail the item. Historical Joomla pages retain the existing paragraph/title date fallbacks and local-midnight parsing rules.

Chromium starts only when an article needs fetching, and one session handles those requests. Article requests close their pages. Feed and article attempts wait two seconds, including failures. HTTP error responses fail collection. Image, media and font requests are blocked. The runtime requires Node.js 20.3 or later and the Chromium revision matching the Playwright version declared by `@oboapp/source-web-utils`.

Obo owns historical lookups, persistence, scheduling, ingestion and notifications. Existing identifiers remain unchanged when this package is updated. The provider changed article paths and some internal numeric IDs during its site migration. The package does not infer aliases between old and new URLs. Before production cutover, review candidate identifiers against historical records and verify discovery and deduplication from the deployment environment. Keep historical backfill separate.

## Tests and release

Offline feed and DOM fixtures cover current discovery, literal URL spelling, calendar-date relevance, authoritative article publication dates, legacy date fallbacks, HTML cleanup, Markdown output, HTTP failures, retry/session cleanup and isolated metadata exports. Run `pnpm check` from the repository root and follow [RELEASING.md](../../RELEASING.md) for release checks and publication.
