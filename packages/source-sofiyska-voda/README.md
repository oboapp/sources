# @oboapp/source-sofiyska-voda

Current and planned water interruptions from Sofiyska Voda's public ArcGIS service, collected through the [Obo source SDK](https://www.npmjs.com/package/@oboapp/source-sdk). This package uses HTTP and supplies complete content from the listing responses.

## Coverage

The source queries the `WSI_PUBLIC/InfoCenter_Public/MapServer` service at `gispx.sofiyskavoda.bg`:

| Layer | Coverage | Query |
| --- | --- | --- |
| 2 | Текущи спирания | `ACTIVESTATUS = 'In Progress'` |
| 3 | Планирани спирания | `1=1` |

Each request asks for all attributes and geometry in WGS 84 (`outSR=4326`), ordered by `START_ DESC`. Discovery reads pages of up to 1,000 records from layer 2 before continuing to layer 3. An empty page ends that layer, including when ArcGIS reports `exceededTransferLimit`. Empty layers are valid.

Metadata identifies the source as `sofiyska-voda`, named **Софийска вода**, supporting `bg.sofia`, with `emergent: true`. Its public catalog links to the [water interruptions page](https://sofiyskavoda.bg/water-stops). Obo owns the schedule.

## Use

Install the package with Node.js 20.3 or later:

```sh
pnpm add --save-exact @oboapp/source-sofiyska-voda@0.1.0
```

Both ESM and CommonJS exports include TypeScript declarations. The metadata entrypoint loads separately from collection code:

```ts
import { metadata } from "@oboapp/source-sofiyska-voda/metadata";
import { createSource } from "@oboapp/source-sofiyska-voda";

const source = await createSource({ locality: "bg.sofia" });
try {
  let cursor: string | undefined;
  do {
    const page = await source.discoverItems(cursor);
    for (const item of page.items) {
      const content = await source.fetchItem(item);
      console.log(item.identifier, content.title);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
} finally {
  await source.close?.();
}
```

In an Obo integration, check stored identifiers before calling `fetchItem`. Pass the returned cursor unchanged to the next discovery call. Cursors belong to the current scan. Calling `discoverItems()` without a cursor starts a fresh scan and clears its previous cache. Fetch each item through the same source instance that discovered it. `close()` clears cached content and aborts active requests. A `SourceContext.signal` also cancels requests.

## Identity and content compatibility

An item's identifier remains the historical synthetic URL:

```text
https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer/{layerId}/{OBJECTID}
```

The numeric `OBJECTID` and layer ID determine identity. Provider alert IDs and revision timestamps do not change it. The first usable record for an identifier wins within a scan. Records without a numeric identifier or supported geometry are skipped. `fetchItem` retrieves cached listing content and makes no additional HTTP request, including for these synthetic identifiers. Large geometries stay in the instance cache; discovery items contain only the identifier.

Content preserves the existing collector's fields and formatting:

- Titles combine the layer's interruption label, location and alert type. Plain text and Markdown use Bulgarian labels and date formatting in `Europe/Sofia`.
- `datePublished` uses `LASTUPDATE`, then `START_`, then the current clock when neither timestamp is valid.
- Both timespan bounds use `START_` and `ALERTEND` when both are valid and at least 1 January 2025. If either bound fails this check, both use the publication-date fallback. Reversed valid bounds retain their provider order.
- Polygon rings take precedence over paths and points. Otherwise, the first path with at least two points becomes a LineString; remaining paths are omitted. Point coordinates use `[x, y]`, preserving longitude before latitude. Coordinate dimensions beyond the first two are omitted.
- Geometry properties retain the layer labels, alert ID, status, alert type, location and district ID when supplied. Obo validates the returned GeoJSON before persistence.
- `categories` is `["water"]`, `isRelevant` is `true`, and `deepLinkUrl` is the empty string, which disables a public detail link to the ArcGIS identity URL.

Obo supplies `url`, `sourceType`, locality, crawl time and processing state. Obo also owns historical base64/MD5 lookups, create-only persistence, ingestion and notifications. Updating this package does not refetch stored identifiers.

## Failures and recovery

HTTP failures, ArcGIS error responses, malformed listing responses and invalid JSON reject discovery. Each request has a 15-second timeout. Repeated cursors and repeated continuing pages fail clearly to prevent endless scans. Obo can retain items saved from earlier pages and start a new scan on its next scheduled run. The package stores no durable checkpoint.

## Development and releases

From the sources repository root, run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm test:coverage`. This package's tests use recorded legacy output and injected HTTP responses. They cover pagination, identifiers, content, geometry, date fallbacks, cancellation, failures, cache isolation and metadata isolation without provider access.

Follow [RELEASING.md](https://github.com/oboapp/sources/blob/main/RELEASING.md) for packing, tarball inspection and publication. Integrate a published exact version through a separate Obo change, preserving source jobs and providing a rollback path.

## License

The Unlicense, inherited from [oboapp/oboapp](https://github.com/oboapp/oboapp). See [LICENSE](LICENSE).
