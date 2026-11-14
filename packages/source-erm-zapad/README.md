# ERM Zapad source

`@oboapp/source-erm-zapad` collects electricity interruptions for Sofia from
[ERM Zapad](https://info.ermzapad.bg/webint/vok/avplan.php).

## Use

```ts
import { createSource } from "@oboapp/source-erm-zapad";
import { metadata } from "@oboapp/source-erm-zapad/metadata";

const source = await createSource({ locality: "bg.sofia" });
try {
  const page = await source.discoverItems();
  for (const item of page.items) {
    const content = await source.fetchItem(item);
    // Pass complete content to the platform's validation and persistence layer.
    console.log(item.identifier, content);
  }
} finally {
  await source.close?.();
}
```

The metadata entrypoint supplies browser-safe catalog information separately from
the collection runtime. The supported locality is `bg.sofia`; its schedule is
emergent, matching the existing thirty-minute Obo job.

## Discovery and content

Discovery reads the initial HTML with HTTP GET and selects municipalities from the
`Област София-град` card. Each municipality uses the provider's form-encoded POST
API at the same URL, with `action=draw`, its `gm_obstina` code, and `lat=0&lon=0`.
Requests to successive municipalities are separated by two seconds.

All municipality results are collected before discovery returns. The source
rounds incident center coordinates to six decimal places, deduplicates matching
pin properties across municipalities by retaining the lowest event ID, and then
groups the remaining pins by event ID. Preserve this sequence when changing the
collector: it determines historical identifiers such as
`https://info.ermzapad.bg/incidents/SF_0001`.

Discovery returns identifiers only. The source instance retains the complete
snapshot for `fetchItem`, including incidents with enough pins to exceed the SDK's
discovery-payload limit. Cursors are unsupported. Close the instance after each
scan to release its snapshot and cancel outstanding requests.

Content preserves the existing Bulgarian title, plain text and Markdown, center
Point geometry, electricity category, relevance and provider time fields. Polygon
vertices in the provider's `points` field describe its map display; the existing
collector uses incident centers. An empty `deepLinkUrl` suppresses public links to
synthetic incident URLs.

After grouping, globally invalid points are dropped while the original first
pin still supplies the incident's text and dates. Groups with no valid points
are skipped. Obo repairs swapped coordinates using its locality bounds.

Provider dates retain the legacy `DD.MM.YYYY HH:MM` parser and the host's local
timezone. Invalid timespan endpoints retain the existing fallback rules, including
the minimum date of 1 January 2025. Keep the deployment timezone consistent during
cutover. Obo validates and repairs GeoJSON and owns scheduling, historical lookup,
persistence, ingestion and notifications.

## Development and release

Run `pnpm check` and `pnpm test:coverage` from the repository root. Tests include
sanitized provider samples, frozen legacy output, global deduplication, failure
handling and cancellation. Fixture provenance is recorded in `test/fixtures/`.

Follow [RELEASING.md](../../RELEASING.md) for package inspection and publication.
Integrate the exact published version in a separate Obo change and verify it in
the fork before preparing an upstream backport.
