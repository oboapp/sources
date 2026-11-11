# @oboapp/source-mladost-bg

Collect repair announcements from Sofia district Mladost through Obo's `discoverItems` and `fetchItem` contract. The source ID is `mladost-bg`; its locality is `bg.sofia`.

## Install and use

Use Node.js 20.3 or later. Install the package with `pnpm add --save-exact @oboapp/source-mladost-bg`. Follow [RELEASING.md](../../RELEASING.md) for package releases.

```typescript
import { createSource } from "@oboapp/source-mladost-bg";
import { metadata } from "@oboapp/source-mladost-bg/metadata";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(metadata.id, item.identifier, content);
  }
} finally {
  await source.close?.();
}
```

Both ESM and CommonJS are supported. The separate metadata entrypoint loads catalog information without browser collection dependencies.

## Collection and compatibility

Discovery reads the current [repair listing](https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti). It keeps article links containing `/planovi-remonti/` in DOM order and preserves their literal resolved URLs, including query strings and percent encoding. There is no pagination cursor or discovery payload.

`fetchItem` reads the article title, publication date and body from the detail page. It removes scripts and styles and converts the body to Markdown. Detail titles and content are required. Publication dates use Bulgarian month names and local midnight in the process timezone, matching the legacy collector. Invalid dates fall back to the current time. Configure the host timezone to match the instance's deployment.

The captured public detail page includes `Публикувано:` in its visible date. The legacy parser uses the scan-time fallback for that text. The extraction preserves this behavior; publication-date correction is recorded separately in [the migration issue](https://github.com/oboapp/oboapp/issues/673).

One Chromium browser is reused across the scan. Each page closes after its attempt, and listing and detail attempts wait two seconds, including failures. `close()` releases the browser. Install the Playwright Chromium revision required by the package's `source-web-utils` dependency before running collection.

Discovery and fetch failures propagate to the caller. Version 0.1.1 uses `source-web-utils` 0.3.1 to reject failed HTTP responses before extracting listing or detail content. Successful empty listings remain valid. Cloud Run access currently receives HTTP 403; restoring provider access is tracked in [oboapp/oboapp#677](https://github.com/oboapp/oboapp/issues/677).

Obo owns deduplication, retries on later scans, validation, complete raw persistence, scheduling and ingestion. The package has no database access.

## Feed and API check

On 11 November 2026, the listing's advertised RSS endpoint at `https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti?format=feed&type=rss` returned seven entries. The rendered listing also contained seven cards. This extraction retains the existing DOM selection and detail-date behavior. A feed-based update can use these captured identifiers to verify compatibility separately.

## Tests

From the repository root, run `pnpm install --frozen-lockfile` and `pnpm check`. Package contracts cover literal identifiers, frozen legacy content, date handling, failure cleanup and isolated metadata imports. Tests simulate HTTP/browser boundaries and do not require a browser download.

The package uses The Unlicense. See [LICENSE](LICENSE).
