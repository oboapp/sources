# @oboapp/source-nadezhda-org

Collects the Announcements and notices listing from Sofia district Nadezhda. Chromium reads the listing and each article. The package preserves the existing `nadezhda-org` identity, literal identifiers, detail title/date behavior, content cleanup and Markdown output.

## Install and use

```sh
pnpm add @oboapp/source-nadezhda-org
```

Pass the runtime factory and isolated metadata to Obo's scheduled source runner:

```ts
import { createSource } from "@oboapp/source-nadezhda-org";
import { metadata } from "@oboapp/source-nadezhda-org/metadata";
```

The metadata entrypoint can be loaded by the web catalog without loading browser dependencies. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, followed by `discoverItems()` and `fetchItem(item)`. Always call `await source.close?.()` in `finally`.

Obo owns historical lookups, validation, persistence, scheduling, ingestion and notifications. Updating this package preserves historical identifiers.

## Collection behavior

The legacy URL filter accepts the exact `nadezhda.sofia.bg` hostname and paths containing `/news/`. Exact duplicates are combined in their first listing position, matching the existing Map behavior. Query strings, fragments and percent-encoded spelling remain part of the identifier. Discovery returns identifiers only. A listing title is required to select an entry. Detail metadata comes only from the article page.

Details require a non-empty page title and content. The detail date uses the existing Bulgarian numeric date conversion, including two-digit years and slash separators. An empty or unparseable detail date falls back to the current time. Cleaned HTML becomes Markdown with document links preserved.

One Chromium browser is reused for the scan. Each listing/detail attempt closes its page and waits two seconds, including failed attempts. Image, media and font requests are blocked. Provider failures propagate to Obo, which records item failures and retries missing identifiers on a later scheduled scan.

The runtime requires Node.js 20.3 or later and `@oboapp/source-web-utils` with Playwright 1.61.1 and its matching Chromium revision and system libraries. Keep that browser revision aligned with the deployment image.

## Feed and API check

The public announcement listing has no alternate feed links or AJAX collection endpoint. Checks of `/feed`, `/rss.xml` and `/atom.xml` did not expose a usable feed on 8 November 2026. Its scripts load jQuery and Bootstrap. This extraction preserves the existing browser listing.

## Tests and release

Tests protect literal URLs, filtering, duplicate behavior, detail-only metadata, date conversion, cleanup, retry/session handling and isolated ESM/CommonJS metadata. Synthetic DOM fixtures cover edge cases. Public listing and detail fragments captured on 8 November 2026 include identifiers and content frozen from the original source-specific extractors, date parser and Markdown builder. They run without provider requests.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for package checks, tarball inspection, publication and Obo integration.
