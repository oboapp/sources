# @oboapp/source-rayon-pancharevo-bg

Collects the infrastructure and repair listing from Sofia district Pancharevo. The package preserves the `rayon-pancharevo-bg` identity, literal article URLs, Bulgarian date filtering and cleaned Markdown content.

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

Discovery retains the legacy infrastructure-path filter and excludes URLs with a `start` query parameter. Percent encoding, query strings and fragments remain part of the identifier. The legacy filter accepts matching paths regardless of hostname. Discovery uses the listing date text followed by its title to find a Bulgarian date or range. A recognized range must contain today's local calendar date. Missing and invalid dates remain eligible. This preserves the current treatment of future listings.

Detail dates come from the first matching date element, then the title, then the first article paragraph. Numeric dates, two-digit years, month names and same-month or cross-month ranges use the existing local-midnight parsing rules. The publication date is the range's start. Unrecognized date text uses the current time; invalid recognized dates fail the item.

One Chromium session handles the scan. Listing and detail requests close their pages and wait two seconds, including failed requests. Image, media and font requests are blocked. The runtime requires Node.js 20.3 or later and the Chromium revision matching the Playwright version declared by `@oboapp/source-web-utils`.

Obo owns historical lookups, persistence, scheduling, ingestion and notifications. Existing identifiers remain unchanged when this package is updated.

## Tests and release

Offline DOM fixtures cover literal URL spelling, pagination filtering, calendar-date relevance, publication date fallbacks, HTML cleanup, Markdown output, retry/session cleanup and isolated metadata exports. Run `pnpm check` from the repository root and follow [RELEASING.md](../../RELEASING.md) for release checks and publication.
