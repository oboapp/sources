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

Each scan requests the existing RSS feed once, with a 30-second timeout. Items retain the historical parser's URL handling, date conversion, WordPress attribution removal, and Markdown output. `fetchItem` converts content already supplied by the feed and makes no additional network request. Obo skips known identifiers and owns persistence and retry scheduling.

The source is independently versioned. Publishing this package does not switch an existing Obo deployment; the pilot integration is a separate PR.
