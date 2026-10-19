# @oboapp/source-sdk

Database-free contracts for Obo source packages. The SDK is independently versioned and licensed under The Unlicense, inherited from [oboapp/oboapp](https://github.com/oboapp/oboapp).

## Source contract

Export a `CreateSource` factory from the source package's runtime entrypoint and a `SourceMetadata` object from its separate `metadata` entrypoint. The latter must not import browser automation, database, filesystem, credentials, or runtime collection code. Consumers select locality through `SourceContext`; a worker reuses the returned `DataSource` for a batch and calls optional `close()` in `finally`.

`discoverItems(cursor?)` returns a page of identifiers and optional serializable context. `fetchItem(item)` returns content for one identifier. A retry can run on a new instance: discovery payload must contain all ephemeral context needed by fetch. Listing-only and synthetic-identifier providers may return content entirely from that payload. Browser session state is an optimization, never the sole durable reference to an item.

Identifiers are the exact historical URLs or synthetic URLs. Do not normalize spelling, encoding, query order, case, or trailing slashes. `observedAt` is informational; it does not request a refresh. Existing identifiers are never refetched because of provider revisions or package upgrades.

Sources do not receive a database interface. Obo owns registration, historical legacy/base64 and MD5 lookups, deduplication, pending work, retry policy, cursor persistence, validation, and raw document persistence. The platform derives the raw URL from the identifier and supplies sourceType, locality, crawledAt, and processing state. Dates in source content cross the package boundary as strings; Obo validates and converts them to its existing persistence representation. GeoJSON is JSON data (including legacy serialized strings); Obo validates it with its existing geometry validator before persistence. The SDK does not replace that validation or define a second GeoJSON schema.

## Discovery payload bounds

Call `serializeDiscoveryPayload` before registration. It rejects non-JSON values, cycles, sparse arrays, accessor properties, custom serialization, nesting beyond 64 levels, and serialized UTF-8 JSON beyond 256 KiB. The limit includes JSON syntax and escaped characters. Plain JSON objects (including null-prototype records), arrays, finite numbers, strings, booleans, and null are supported.

On rejection, fail registration and retain the previous cursor. Never silently truncate or discard payload. Reduce discovery context and fetch detail content by identifier when possible. A listing-only provider that cannot fit must fail explicitly until its context is reduced or a separate platform-managed blob-reference contract is implemented. Blob storage is not part of SDK 0.1. Per-page, cursor, raw-content and storage transaction limits remain platform responsibilities.

## Compatibility and release

Both ESM and CommonJS imports are supported with matching type declarations, including the older `node` module resolution used by Obo's production compiler. The metadata subpath has no runtime dependencies. This initial 0.1 contract is a foundation; it does not implement durable orchestration or migrate a source.

Each package owns its version and release notes. Breaking contract changes require explicit consumer migration; never use package updates to change persisted identity. Build and test with `pnpm check` at the repository root. Run `pnpm --dir packages/source-sdk pack` to build a publishable tarball including the inherited LICENSE. Inspect the tarball before manual npm publication. Consumers must pin released package versions in their lockfile; Obo integration starts after publication, not via a private Git checkout dependency.
