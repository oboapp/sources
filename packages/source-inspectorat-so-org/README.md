# Sofia Inspectorate source

`@oboapp/source-inspectorat-so-org` discovers the current news listing at
inspectorat-so.org and fetches article content through the Obo source SDK.

The package preserves literal article URLs, the last listing entry for duplicate
URLs, article HTML cleanup and Bulgarian publication-date parsing. Missing detail
dates fall back to the listing. Abbreviated month dates infer the previous year
when the current-year date is more than seven days ahead. Historical timestamps
keep the fixed `+02:00` offset.

One Chromium session serves a scan. Requests are separated by two seconds,
including failed requests, and `close()` releases the browser. Obo owns historical
lookups, persistence, scheduling and ingestion. Metadata is available separately
at `@oboapp/source-inspectorat-so-org/metadata` for browser-safe catalogs.

```typescript
import { createSource } from "@oboapp/source-inspectorat-so-org";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(item.identifier, content);
  }
} finally {
  await source.close?.();
}
```

Run `pnpm check` from the repository root. Follow [RELEASING.md](../../RELEASING.md)
for tarball inspection and publication.
