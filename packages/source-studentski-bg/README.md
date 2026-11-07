# @oboapp/source-studentski-bg

Collects the Schedules category from Sofia district Studentski. RSS supplies article identifiers and publication dates; Chromium reads each article's full content. The package retains the existing `studentski-bg` identity, URL spelling, title fallback, cleanup rules, and Markdown conversion.

## Install and use

```sh
pnpm add @oboapp/source-studentski-bg
```

Pass the runtime factory and isolated metadata to Obo's scheduled source runner:

```ts
import { createSource } from "@oboapp/source-studentski-bg";
import { metadata } from "@oboapp/source-studentski-bg/metadata";
```

The metadata entrypoint can be loaded by the web catalog without loading Playwright. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, then `discoverItems()` and `fetchItem(item)`. Always call `await source.close?.()` in `finally`.

Obo owns existing-item lookups, validation, persistence, scheduling, ingestion, and notifications. A package upgrade keeps historical identifiers unchanged.

## Collection behavior

Discovery reads [the category feed](https://studentski.bg/category/%d0%b3%d1%80%d0%b0%d1%84%d0%b8%d1%86%d0%b8/feed/), rejects invalid or off-host entries, and keeps the first occurrence of each URL. Each item carries its RSS title and ISO publication date as bounded discovery context. Discovery does not open a browser.

Detail fetches reuse one browser, open and close a page per item, block image/media/font downloads, and wait two seconds after successful extraction. The page title is preferred, with the RSS title as fallback. The RSS date is always retained. Cleaned article HTML becomes Markdown with document links preserved. Missing article content fails instead of using the feed excerpt.

The runtime requires Node.js 20.3 or later. It uses `@oboapp/source-web-utils` with Playwright 1.61.1 and its matching Chromium revision and system libraries. Keep that revision aligned with the deployment image. Provider or browser failures propagate to Obo; its runner records failures and retries missing items on a later scan. Closing the source releases its browser.

## Coverage and limits

Only recent items exposed by the schedules category feed are discovered. This package does not backfill older archives. Obo skips identifiers already stored, so edits at an existing URL are not fetched again. Linked documents and image text are retained as references and are not read separately. Site redesigns can require selector updates.

## Tests and release

Tests use synthetic RSS and DOM fixtures with expected content frozen from the legacy crawler. They protect URL identity, metadata fallback, cleanup, browser/session handling, request pacing, failures, and ESM/CommonJS metadata isolation.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for package checks, tarball inspection, publication, and Obo integration.
