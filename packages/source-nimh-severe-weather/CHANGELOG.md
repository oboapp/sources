# Changelog

## 0.1.1

- Discover warnings once the server-rendered DOM is ready, even when background
  requests prevent network idle. Preserve warning content, identifiers and HTTP
  failure reporting.

## 0.1.0

- Extract Sofia's NIMH severe-weather collector into an independently versioned
  SDK 0.2.0 source with isolated catalog metadata.
- Preserve browser-serialized warning identifiers, content, city-wide scope and
  fixed-offset forecast timespans. Cache listing content within each scan.
- Add HTTP failure reporting, cancellation and browser cleanup contracts.
