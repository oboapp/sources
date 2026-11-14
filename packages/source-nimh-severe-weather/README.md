# @oboapp/source-nimh-severe-weather

City-wide severe-weather warnings for Sofia from
[NIMH's municipality page](https://weather.bg/obshtini/index.php?z=u&o=SOF),
using the Obo source SDK 0.2.0.

## Collection

`discoverItems()` loads the page once in Chromium, waits for `networkidle`, and
parses its serialized HTML. Active warnings produce one synthetic identifier:

```text
https://weather.bg/obshtini/index.php?z=u&o=SOF&date={forecastDate}&h={12-character-hash}
```

The hash covers the sorted structured warning cells, including their existing
note order and spelling. Changing recommendation prose or the issue timestamp
alone preserves the identifier. Changing the forecast date or structured warning
data can create a new identifier, matching the legacy collector.

`fetchItem` returns content cached in the same source instance. It does not
navigate to the synthetic URL. Discovery items contain only identifiers; large
content stays outside the SDK's discovery-payload limit. Rediscovery clears the
old cache, including after failures or a new warning-free page. Pagination is
unsupported. Obo owns historical lookups, deduplication, validation, persistence,
scheduling and ingestion.

Public HTTP supplies the page's data, but browser serialization is part of its
identity contract. Named and numeric HTML entities can produce different notes
and hashes when parsed directly from HTTP. The fixtures record this difference.
The extraction therefore retains Chromium. RSS/ATOM probes found no working feed
and the captured page exposed no JSON discovery API.

## Content compatibility

- Catalog identity remains `nimh-severe-weather`, named `НИМХ - Опасно време`,
  supporting `bg.sofia`. Its existing non-emergent schedule belongs to Obo.
- Content preserves the Bulgarian title, plain text, Markdown, warning-severity
  precedence, no-danger phrases and recommendation-only alerts.
- `datePublished` retains the literal provider issue timestamp, including its
  absence of a timezone suffix. A missing issue timestamp falls back to the
  current ISO time, as before.
- Forecast timespans retain the legacy fixed `+02:00` offset for both winter and
  summer. Dates cross the SDK boundary as ISO strings.
- `cityWide` and `isRelevant` are `true`, categories are `["weather"]`, and
  GeoJSON is an empty FeatureCollection. The Obo runner must support city-wide
  content before deploying this package.

The inherited table matcher can include cells from an earlier municipality row.
HTML entity semicolons can also split notes. These rules affect existing hashes
and are retained here. Correcting them requires separate parser and historical
identity review. The provider fixtures record their provenance; synthetic active
warnings are labelled explicitly.

## Use

Install the published package with Node.js 20.3 or later:

```sh
pnpm add --save-exact @oboapp/source-nimh-severe-weather@0.1.0
```

ESM and CommonJS exports include TypeScript declarations. Load browser-safe
metadata from `@oboapp/source-nimh-severe-weather/metadata` and the factory from
the package root:

```typescript
import { createSource } from "@oboapp/source-nimh-severe-weather";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    console.log(item.identifier, content.title);
  }
} finally {
  await source.close?.();
}
```

The package owns Playwright 1.61.1 and requires its Chromium revision. Obo's image
must install and verify that runtime as its production user. The metadata export
loads without browser code. A source instance closes its browser after each
listing attempt. HTTP failures and pages without a forecast marker fail discovery. Navigation has
a 30-second timeout. `SourceContext.signal` and `close()` cancel active work and
clear cached content.

## Checks and releases

From the repository root, run `pnpm install --frozen-lockfile`, `pnpm check` and
`pnpm test:coverage`. Tests cover legacy parsing/builders, frozen browser output,
literal identifiers, lifecycle, failures and isolated metadata. Follow
[RELEASING.md](../../RELEASING.md) for review, packing and independent publication.
Integrate the exact published version into Obo through a separate PR with
package-to-ingestion contracts.
