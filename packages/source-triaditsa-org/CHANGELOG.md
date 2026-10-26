# Changelog

## 0.2.0 - 2026-10-26

- Collect the announcements feed alongside News and deduplicate shared URLs.
- Remove embedded style and script content from feed Markdown.
- Document feed coverage and remaining page, history, and attachment gaps.

## 0.1.1 - 2026-10-26

- Preserve the RSS Accept header used by the deployed vbuch/oboapp crawler.

## 0.1.0 - 2026-10-26

- Extract the existing Triaditsa full-content RSS source with the same identifiers, dates, attribution removal, and Markdown conversion.
- Expose a database-free source factory and isolated catalog metadata with ESM and CommonJS support.
- Check output against a fixture captured from the legacy Obo implementation.
