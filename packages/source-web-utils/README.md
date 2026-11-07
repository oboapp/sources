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
