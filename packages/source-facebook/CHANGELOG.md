# Changelog

## 0.1.0

- Add a configurable Facebook Page source using admin-authorized Graph API reads and the source SDK's discovery and content contract.
- Provide independent Page configurations, a default `facebook.configure` API, a named `configure` export, and a browser-safe metadata factory.
- Preserve post identity, original text, public permalinks, timestamps, and attachment references, with typed content errors for manual review.
- Add bounded discovery payloads with provider-ID refetch for oversized posts, request timeouts, retry handling, and fixture-based contract coverage.
