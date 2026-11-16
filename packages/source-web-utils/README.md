# @oboapp/source-web-utils

Shared collection helpers for Obo source packages. Sources provide their own feeds,
selectors, cleanup rules and catalog metadata. Obo manages identity lookup,
validation, persistence and scheduling.

## Usage

Install with `pnpm add @oboapp/source-web-utils`. Import `createHybridSource` from
the package root and RSS helpers from `@oboapp/source-web-utils/rss`.

`createHybridSource` takes a discovery callback returning RSS items, title/content
selectors, and selectors for unwanted page elements. It returns the SDK's
`discoverItems`, `fetchItem` and `close` operations. Discovery keeps the first item
for each exact URL and carries only its title and publication date into fetching.

Fetching prefers the page title, falls back to the feed title, and retains the
feed publication date. Missing page content fails. HTML becomes Markdown with
ATX headings and fenced code blocks. A source instance starts Chromium only when
fetching begins, reuses it, and closes each detail page on success or failure.
Successful detail fetches wait two seconds. Call `close` in `finally`.

RSS parsing retains the legacy URL, entity and date rules. Fetching keeps the RSS
Accept header and browser-compatible user agent.

## RSS retries and diagnostics

`fetchFeedXml(url, timeoutMs = 30_000, options?)` returns the RSS XML. Existing
one- and two-argument calls remain supported. The optional third argument accepts
`{ onEvent }` for retry diagnostics.

Each call makes at most two attempts within the original total timeout budget.
That budget covers fetching, reading the response body and waiting before a
retry. A retry waits at least two seconds and respects a longer valid
`Retry-After` response header. The helper skips the retry when the remaining
budget cannot cover its delay and another attempt.

Recognized transient network failures and HTTP 408, 500, 502, 503 and 504 can
retry. HTTP 429 can retry when it supplies a valid `Retry-After`. HTTP 401, 403,
404 and 501, invalid RSS content, TLS failures, `AbortError` and unclassified
network errors end the call.

`RssFeedHttpError` retains its class, HTTP `status` and diagnostic `url`, so Sredets
can still recognize a missing pagination page by its HTTP 404 status.
`RssFeedFetchError` supplies a sanitized `url`, `attempts` and a cloned `cause`
chain for transport and body-read failures. The cause keeps error names, stacks,
network codes and nested or aggregate errors within bounded size and depth.
The final error message includes the feed URL, attempt count and safe pagination
values outside the URL, keeping them visible in application logs that remove
query strings.

Diagnostic URLs remove credentials, fragments and unsafe query parameters. They
retain numeric `paged`, `page` and `start` values and fixed feed parameters.
The original request URL and discovered article identifiers keep their literal
spelling.

`onEvent` receives sanitized primitive fields for `retry` and `recovered` events.
Retry events include `attempt`, `nextAttempt`, `delayMs`, `reason` and the known
network `code` or HTTP `status`. Recovery events include `attempts`. Both events
include the diagnostic `url` and any safe `pagination` context.
Callback failures are ignored, and the helper keeps event handling local to the
call. Source factories must pass this callback to expose internal retry events
to platform logging. The current factories still need that adoption; Obo's
existing Cloud Run attempt logs already show recovery between scheduled task
attempts.

This contract contributes to
[oboapp/oboapp#688](https://github.com/oboapp/oboapp/issues/688). The older
Playwright readiness timeout in
[#451](https://github.com/oboapp/oboapp/issues/451) is a separate failure class.
Publish and verify helper version 0.5.0 before opening dependent source package
PRs, following [RELEASING.md](../../RELEASING.md).

## Browser listings

Import `createBrowserSource` from `@oboapp/source-web-utils/browser` for sources
whose listing pages require browser extraction. Supply `indexUrl`, `selectors`
with `INDEX` and `POST` groups, `unwantedElements`, and an optional `urlFilter`.
Each listing container contributes its first matching anchor when both its URL
and listing title are present. Anchor spelling and order are retained. Duplicate
URLs remain unless the provider chooses `dedupe: "first"` or `dedupe: "last"`.
Both modes retain each URL's first position.

Discovery returns identifiers only. Fetching requires the detail page's title
and content and uses its publication date. Dates retain the legacy dot or slash
day-month-year conversion, including two-digit years and current-time fallback
for missing or unparseable dates. Content cleanup runs on a cloned element and
uses the same Markdown conventions as hybrid sources.

Sources with different provider formats can supply `extractListing(page)`,
`extractDetails(page)` and `parsePublicationDate(dateText, post)`. These optional hooks
replace their respective default conversions. Listing hooks return
`BrowserPostLink[]` with `url`, `title` and `date`; detail hooks return
`BrowserPostDetails` with `title`, `dateText` and `contentHtml`. Listing hooks
retain responsibility for provider-specific selection and cleanup rules. The
helper applies its configured URL filter and deduplication to their results.
Detail hooks retain responsibility for HTML cleanup; the helper still requires
the returned title and content and converts the HTML to Markdown. A custom date
parser receives the returned detail date text exactly as supplied and the matching
listing post, including its original title and date. Without prior discovery,
the post contains the requested URL and empty title and date strings. Listing
context stays inside the source instance and clears on rediscovery and close.

An optional `filterPost(post)` can select listing candidates using their title
and date. It runs after URL filtering and before deduplication. Discovery still
returns identifiers only.

The `browser` entrypoint also exports `parseBulgarianDate` for the default numeric
date conversion and `parseBulgarianMonthDate` for dates such as `9 юни 2026`.
The month-name parser preserves local midnight, validates the resulting calendar
date and falls back to the current time when the input is invalid. Its result
depends on the process timezone, matching the existing source behavior.

One browser serves the listing and all details until `close` is called. Each
page closes after success or failure, and every attempt waits two seconds,
including the listing and failed requests. `BrowserDependencies` allows tests
to supply browser launch and delay functions. Call `close` in `finally`.
Hook failures follow the same page cleanup and request pacing as other failures.

Non-success navigation responses fail with their HTTP status and requested URL
before listing or detail extraction. Successful empty listings still return no
items. HTTP failures retain page cleanup and request pacing, and propagate to Obo
for scan or item failure handling.

## Runtime and checks

Requires Node 20.3 or later and the Chromium revision for pinned Playwright 1.61.1.
The package owns that browser dependency; consumers should validate this owner's
browser when building their image. ESM, CommonJS and legacy TypeScript resolution
are supported. The package root loads server-only runtime code.

Run `pnpm check` from the repository root. Tests cover RSS boundaries, literal
identifiers, resource blocking, Markdown, browser reuse, cleanup and failures.
See [the release guide](../../RELEASING.md) for independent version publication.
Coverage mapping, CI analysis and quality-gate checks are documented in
[SONAR.md](../../SONAR.md).
