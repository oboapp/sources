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

RSS helpers retain the legacy URL, entity and date parsing rules, the RSS Accept
header, and a 30-second timeout. `RssFeedHttpError` exposes the HTTP status and URL
so a provider can distinguish a missing pagination page from an outage.

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
Destination Sonar analysis is tracked in
[oboapp/oboapp#663](https://github.com/oboapp/oboapp/issues/663).
