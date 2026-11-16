# @oboapp/source-lozenets-sofia-bg

Collects the News category from Sofia district Lozenets. RSS supplies article identifiers and publication dates; Chromium reads each article's full content. The package retains the existing `lozenets-sofia-bg` identity, URL spelling, title fallback, cleanup rules, and Markdown conversion.

## Install and use

```sh
pnpm add @oboapp/source-lozenets-sofia-bg
```

Pass the runtime factory and isolated metadata to Obo's scheduled source runner:

```ts
import { createSource } from "@oboapp/source-lozenets-sofia-bg";
import { metadata } from "@oboapp/source-lozenets-sofia-bg/metadata";
```

The metadata entrypoint can be loaded by the web catalog without loading Playwright. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, then `discoverItems()` and `fetchItem(item)`. Always call `await source.close?.()` in `finally`.

Obo owns existing-item lookups, validation, persistence, scheduling, ingestion, and notifications. A package upgrade keeps historical identifiers unchanged.

## Collection behavior

Discovery reads [the category feed](https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/), rejects invalid or off-host entries, and keeps the first occurrence of each URL. Each item carries its RSS title and ISO publication date as bounded discovery context. Discovery does not open a browser.

Detail fetches reuse one browser, open and close a page per item, block image/media/font downloads, and wait two seconds after successful extraction. The page title is preferred, with the RSS title as fallback. The RSS date is always retained. Cleaned article HTML becomes Markdown with document links preserved. Missing article content fails instead of using the feed excerpt.

The runtime requires Node.js 20.3 or later. It uses `@oboapp/source-web-utils` with Playwright 1.61.1 and its matching Chromium revision and system libraries. Keep that revision aligned with the deployment image. Provider or browser failures propagate to Obo; its runner records failures and retries missing items on a later scan. Closing the source releases its browser.

## Feed failures and recovery

Version 0.2.0 pins shared RSS helper 0.5.0. Feed discovery makes at most two attempts within one 30-second budget, including response body reads and the retry delay. Eligible temporary network and HTTP failures wait at least two seconds before a retry. A valid `Retry-After` can extend that delay when it fits the remaining budget. Persistent access, certificate and invalid-content failures fail the scan. See [the helper's retry contract](https://github.com/oboapp/sources/blob/source-web-utils-v0.5.0/packages/source-web-utils/README.md#rss-retries-and-diagnostics) for the full policy.

Failed requests retain the feed URL, attempt count and a safe copy of nested network causes. Diagnostic URLs redact credentials, fragments and unrelated query parameters. Requests and article identifiers retain their literal spelling.

Pass the optional second argument to `createSource` to report retry and recovery events. Each source instance keeps its own callback. Observer failures leave collection outcomes unchanged.

```ts
import { createSource } from "@oboapp/source-lozenets-sofia-bg";
import { metadata } from "@oboapp/source-lozenets-sofia-bg/metadata";

const source = createSource({ locality: "bg.sofia" }, {
  onEvent(event) {
    console.info("RSS feed event", { source: metadata.id, ...event });
  },
});
try {
  const page = await source.discoverItems();
  // Pass the discovered items to the host's existing-item and ingestion flow.
  console.info("Discovered items", { count: page.items.length });
} finally {
  await source.close?.();
}
```

The callback receives a `retry` event with the feed URL, attempt numbers, delay and HTTP status or network code. A successful later attempt emits `recovered` with its attempt count. These attempt numbers count feed requests within a scan. The host supplies the Cloud Run task attempt separately.

The package exports `RssFeedFetchOptions` and `RssFeedFetchEvent` types. A host can wrap `createSource(context, options)` in an SDK `CreateSource` factory and attach its source, execution and task context to these events. The original one-argument factory remains supported.

[Issue #688](https://github.com/oboapp/oboapp/issues/688) concerns native RSS requests during discovery. [Issue #451](https://github.com/oboapp/oboapp/issues/451) concerned article navigation waiting for `networkidle`. Article collection uses `domcontentloaded`. After this package is published, Obo still needs to pin it, connect the callback to its logger and verify scheduled production scans.

## Coverage and limits

Only recent items exposed by the news category feed are discovered. This package does not backfill older archives. Obo skips identifiers already stored, so edits at an existing URL are not fetched again. Linked documents and image text are retained as references and are not read separately. Site redesigns can require selector updates.

## Tests and release

Tests use synthetic RSS and DOM fixtures with expected content frozen from the legacy crawler. They protect URL identity, metadata fallback, cleanup, browser/session handling, request pacing, failures, and ESM/CommonJS metadata isolation. Public-factory contracts cover transient feed recovery, final diagnostic causes, terminal failures and isolated event observers.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for package checks, tarball inspection, publication, and Obo integration.
