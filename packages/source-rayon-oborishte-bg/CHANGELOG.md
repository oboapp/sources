# Changelog

## 0.1.1

- Keep root RSS discovery across all categories and fall back to the public WordPress posts API after any thrown RSS failure.
- Add an optional `onRssFailure` callback so consumers can report recovered RSS errors without blocking API recovery.
- Preserve the newest ten-item window, literal article links, and UTC publication dates on both discovery paths.
- Reuse the shared RSS helper and report HTTP discovery failures with their status and URL.
- Preserve article identifiers, publication dates, and browser detail extraction.
- Link the source metadata to the district homepage to reflect its full publication stream.

## 0.1.0

- Move the Oborishte RSS and article extraction into a source package.
