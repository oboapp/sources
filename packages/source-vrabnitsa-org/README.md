# @oboapp/source-vrabnitsa-org

Collects news and events from Sofia district Vrabnitsa. Chromium reads the listing and article pages. The package preserves the `vrabnitsa-org` identity, literal article identifiers, detail metadata, content cleanup and Markdown output.

## Install and use

```sh
pnpm add @oboapp/source-vrabnitsa-org
```

```ts
import { createSource } from "@oboapp/source-vrabnitsa-org";
import { metadata } from "@oboapp/source-vrabnitsa-org/metadata";
```

Pass the factory and isolated metadata to Obo's scheduled source runner. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, then `discoverItems()` and `fetchItem(item)`. Call `await source.close?.()` in `finally`.

The metadata entrypoint loads independently of browser code. Obo owns historical lookups, validation, persistence, scheduling, ingestion and notifications.

## Collection behavior

The existing news-card selectors choose listing candidates. The legacy URL filter decodes URLs only for matching and accepts paths containing `/aktualno/news/`, excluding pagination and fragments. Discovery preserves literal anchor URLs, order and duplicate identifiers. A listing title is required. Detail titles, dates and body content come from the article page.

The date extractor prefers a non-empty `datetime` attribute, then normalized visible text. The date parser strips the `Публикувано:` prefix, tries JavaScript date parsing, then Bulgarian month-name dates at local midnight. Empty or unparseable dates retain the current-time fallback. Month-name dates reject calendar rollover; ISO-style values retain JavaScript date parsing.

Details require a title and body. Cleanup removes scripts, styles, article asides, paging, icons, button groups and navigation from a cloned body. Markdown retains document links. One Chromium browser serves the scan. Every page closes after its attempt, and attempts wait two seconds, including failures. Image, media and font requests are blocked.

The runtime requires Node.js 20.3 or later and the Chromium revision and system libraries matching the shared browser helper's Playwright dependency.

## Feed and API check

On 11 November 2026, the news listing advertised a working RSS feed at `https://vrabnitsa.sofia.bg/aktualno/news?format=feed&type=rss`. This extraction retains the existing browser listing, literal anchors and detail metadata. Changing discovery to feed-provided URLs needs a separate compatibility review.

## Tests and release

Deterministic DOM fixtures protect exact identifiers, filters, duplicates, detail-only metadata, date attribute precedence, date variants, cleanup, session reuse and retries. Public listing and detail fragments captured on 11 November 2026 retain expected content computed independently with the original Obo extractors, date parser and Markdown helper. Metadata checks cover ESM and CommonJS exports without loading collection dependencies.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for tarball inspection, publication and Obo integration.
