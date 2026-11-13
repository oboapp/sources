# Legacy content contracts

`legacy-content.json` contains 22 fixtures captured from `buildSourceDocument` in [oboapp/oboapp at c8f7c8d1](https://github.com/oboapp/oboapp/blob/c8f7c8d1f87f415b018a16838e4c86ea4af885f8/ingest/crawlers/sofiyska-voda/builders.ts). Inputs use fixed provider timestamps. Expected content contains only the SDK fields, with timespan dates serialized as ISO strings. Platform fields such as locality, source ID and crawl time are excluded.

The fixtures protect literal identifiers, Bulgarian text and whitespace, geometry preference, publication fallbacks, mixed-validity timespans and skipped records. They are synthetic provider responses and contain no database records. Tests load this local file and run without an Obo checkout or network access.
