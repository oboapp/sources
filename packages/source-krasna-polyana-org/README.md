# @oboapp/source-krasna-polyana-org

Public notices from Sofia's Krasna Polyana district. Obo uses source ID `krasna-polyana-org` and locality `bg.sofia`.

Install with `pnpm add --save-exact @oboapp/source-krasna-polyana-org`. Pass the named `createSource` export to the Obo runner. Import the browser-safe `metadata` export from `@oboapp/source-krasna-polyana-org/metadata`.

Each scan reads the six most recent notices in one request, matching the size of the former Joomla listing. WordPress supplies full content in the listing. The package retains it for the current scan and returns the literal public link as the identifier. Fetching a new item converts its public body to Markdown and reads the publication time from `date_gmt`. Invalid content fails that item. HTTP or listing errors fail discovery. Closing or restarting discovery clears the in-memory content.

On 19 November 2026 the archive contained 161 notices across 27 pages, ending on 28 May 2026. All 13 WordPress notices had distinct titles from the archive. They began on 3 July 2026 with the announcement of the archived site. The API query starts on that date to exclude imports that retain their original pre-transition dates. A republished archive notice with a new publication date needs an explicit identifier mapping. Obo keeps the original `https://krasnapolyana.bg/home/latest-news/…` identities for historical records. [Joomla archive](https://old.krasnapolyana.bg/home/latest-news) · [WordPress notices](https://krasnapolyana.bg/wp-json/wp/v2/notifications)

The runtime uses Node's native fetch. Run `pnpm check` from the repository root. See the [release procedure](https://github.com/oboapp/sources/blob/main/RELEASING.md).
