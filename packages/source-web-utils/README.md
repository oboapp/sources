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

One browser serves the listing and all details until `close` is called. Each
page closes after success or failure, and every attempt waits two seconds,
including the listing and failed requests. `BrowserDependencies` allows tests
to supply browser launch and delay functions. Call `close` in `finally`.

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
