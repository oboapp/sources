# Changelog

## 0.1.1

- Restore discovery through the current planned-repairs RSS feed, retaining literal URLs and title-based Bulgarian event-date filtering.
- Extract current article content and authoritative publication timestamps while preserving historical Joomla detail behavior.
- Retain HTTP failure reporting, browser reuse, cleanup and two-second pacing for feed and article attempts.
- Document the production identity review required after the provider changed historical article paths and IDs.

## 0.1.0

- Extract the Pancharevo infrastructure listing and article collector into an independent source package.
- Preserve literal identifiers, date relevance filtering, publication date fallbacks, content cleanup and Markdown conversion.
- Reuse Chromium with two-second pacing and per-request page cleanup.
