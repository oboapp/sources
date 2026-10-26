# @oboapp/source-triaditsa-org

Full-content RSS source for Sofia district Triaditsa, extracted from Obo's existing crawler. Licensed under The Unlicense.

```ts
import { createSource } from "@oboapp/source-triaditsa-org";
import { metadata } from "@oboapp/source-triaditsa-org/metadata";

const source = await createSource({ locality: "bg.sofia" });
const page = await source.discoverItems();
for (const item of page.items) {
  const content = await source.fetchItem(item);
  // Pass content to your application's validation and persistence layer.
}
```

In Obo, pass the factory and metadata to its scheduled source runner instead of writing your own persistence loop. The package has no database access or browser dependency. Its metadata entrypoint does not load the RSS parser or Markdown converter.

Each scan requests the News and announcements RSS feeds once each, sequentially, with a 30-second timeout per request. Repeated URLs across both feeds produce one candidate, with News taking precedence. A failed feed request fails discovery so the caller can retry the scan. Items retain the historical parser's URL handling, date conversion, WordPress attribution removal, and Markdown output. Embedded style and script elements are removed before conversion. `fetchItem` converts content already supplied by the feed and makes no additional network request. Obo skips known identifiers and owns persistence and retry scheduling.

The source is independently versioned. Publishing this package does not switch an existing Obo deployment; the pilot integration is a separate PR.


## Feed coverage

Verified on 2026-10-26 for [vbuch/oboapp#35](https://github.com/vbuch/oboapp/issues/35):

- News: the existing `/category/новини-и-събития/feed/` endpoint.
- Announcements: `https://triaditza.org/feed/?post_type=announcements` covers the WordPress announcements post type. Its categories include public consultations, ecology, messages, PUP, and PUP announcements/orders.
- The live scan returned 10 items from each feed. Category-specific `/cat/{slug}/feed/` and query-form taxonomy feeds returned HTTP 404 for those five categories. The combined feed is used for these notices.

The feed window determines discovery coverage. Older consultations and projects outside that window require a later backfill or pagination decision. The streets and sidewalks programme is an edited page and has no identified dedicated content feed. Inline content on section pages is also outside this scan.

Document links are retained, but attachment text is not extracted. Some planning notices consist only of document links. Existing URLs remain skipped by Obo, so later page or attachment edits are not collected. Original publication dates are retained; Obo applies its existing age and relevance filters, including to routine vehicle notices. These gaps can be assessed after observing the expanded feed results.

The `test/announcements.xml` fixture contains the first item from the announcements feed captured on 2026-10-26, a planning notice published on 2026-10-22. The item's namespace declaration was moved to the RSS root for the existing parser.
