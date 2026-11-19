# Writing a source package README

Start with the template below. Replace each placeholder with verified source behavior. Choose a release version that already exists when documenting an existing package. Keep extra sections for coverage or provider rules that an operator needs to understand.

~~~~markdown
# @oboapp/source-<id>

Describe the provider, covered notices, source ID and supported locality.

## Use

Install with `pnpm add --save-exact @oboapp/source-<id>`. Pass `createSource` and `metadata` to Obo's scheduled runner. The runner owns deduplication and persistence.

```ts
import { createSource } from "@oboapp/source-<id>";
import { metadata } from "@oboapp/source-<id>/metadata";

const source = await createSource({ locality: "<supported-locality>" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(metadata.id, item.identifier, content.title);
  }
} finally {
  await source.close?.();
}
```

This example reads the first page. For a paginated provider, show how to pass the returned cursor to the next call. Import the metadata entrypoint on its own for the browser catalog.

## Coverage and runtime

Name the feed, listing or API. Describe its window, filters, historical identifier format and any overlap across feeds. State where content and publication dates come from, the required Node version, and the browser version and setup if used. Explain how discovery and per-item failures surface, when retries run, and what the package releases on close.

## Testing and releases

Give the test command, link to the package's fixtures or contract tests, and link to the repository's release guide using an absolute URL so the link works on npm.
~~~~

## Review before publication

- Compare source ID, locality, runtime and metadata imports with the manifest, SDK and exported factory. Check each provider-specific claim against its fixtures or a dated public sample.
- Run the example against the built package or a fixture and exercise its cleanup path. For a browser source, verify that importing metadata works without starting Chromium.
- Follow the [release guide](../RELEASING.md) to pack the package. Read the README from inside the archive, check that it matches the intended text, and verify both runtime entrypoints and the metadata export. Repeat registry verification after publication.
