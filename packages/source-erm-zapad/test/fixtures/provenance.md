# ERM Zapad compatibility fixtures

These synthetic inputs combine the provider shape and cases protected by
`ingest/crawlers/erm-zapad/index.contract.test.ts`, `extractors.test.ts`,
`builders.test.ts`, `deduplication.test.ts` and `grouping.test.ts` in
`vbuch/oboapp` at commit `0941e72a2d85d5af262af7c6eeb3c4ae45fb1e71`.
They are labelled test data and were not captured from a live incident.

The expected identifiers and content were transcribed from the legacy
implementation without importing the new package. Expected strings preserve the
legacy field order, blank lines, Bulgarian labels and disabled detail link.
Tests set `TZ=UTC` to freeze the legacy process-timezone date behavior.
The first municipality exposes a higher event ID; the
second supplies the matching lower ID and a second point for another event.
This protects global identity selection across municipality boundaries.

`live-sofia-city-card.html`, `live-sof44-incidents.json` and
`live-sof15-incidents.json` contain public provider responses captured on
14 November 2026. The HTML contains only the Sofia-city municipality card and
basic document tags. JSON whitespace was normalized and its UTF-8 BOM removed.
No session cookies, request headers or account data are included. Tests add a
synthetic BOM to exercise the original transport format. The source page is
`https://info.ermzapad.bg/webint/vok/avplan.php`; incident requests POST
`action=draw`, `gm_obstina=SOF44` or `SOF15`, `lat=0` and `lon=0` to the same URL.
These responses establish the HTTP transport and selector shape at capture time.
