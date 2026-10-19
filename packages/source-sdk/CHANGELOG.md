# @oboapp/source-sdk

## 0.1.1 (unreleased)

- Add declaration fallbacks for Obo's production TypeScript `moduleResolution: node`, including the metadata subpath.
- Test a consumer outside the SDK package with the production compiler settings.

## 0.1.0 (2026-10-19)

- Define discovery/fetch operations, reusable source lifecycle, platform-selected locality, and source-owned content.
- Expose browser-safe metadata types separately from runtime entrypoints.
- Bound discovery context to 256 KiB of UTF-8 JSON and reject lossy serialization.
- Support typed ESM and CommonJS consumers without runtime dependencies.
