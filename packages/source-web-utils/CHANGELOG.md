# Changelog

## 0.2.0

- Add the `browser` entrypoint for browser listing and detail collection with
  source-owned selectors, URL filtering and optional deduplication.
- Retain literal identifiers, detail-only metadata, legacy Bulgarian dates,
  Markdown conversion and browser reuse. Pace listing and detail attempts,
  including failures, and close pages on every completed attempt.

## 0.1.0

- Extract RSS parsing/fetching and reusable browser detail collection from the
  existing website source packages.
- Preserve literal URL handling, metadata precedence, Markdown settings, request
  pacing and browser cleanup. Expose HTTP status for provider pagination rules.
