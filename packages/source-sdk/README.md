# @oboapp/source-sdk

Database-free contracts for Obo source packages. The SDK is independently versioned and licensed under The Unlicense, inherited from [oboapp/oboapp](https://github.com/oboapp/oboapp).

## Source contract

Export a `CreateSource` factory from the source package's runtime entrypoint and a `SourceMetadata` object from its separate `metadata` entrypoint. The latter must not import browser automation, database, filesystem, credentials, or runtime collection code. Consumers select locality through `SourceContext`; the scheduled runner reuses the returned `DataSource` for a scan and calls optional `close()` in `finally`.

`discoverItems(cursor?)` returns a page of identifiers and optional serializable context. `fetchItem(item)` returns content for one identifier. The runner lists candidates, skips stored identifiers, fetches new content, and saves complete raw documents. A later scheduled run lists again to retry missing items. Listing-only and synthetic-identifier providers may return content entirely from that payload. One source instance can reuse its browser session throughout the scan.

Identifiers are the exact historical URLs or synthetic URLs. Do not normalize spelling, encoding, query order, case, or trailing slashes. `observedAt` is informational; it does not request a refresh. Existing identifiers are never refetched because of provider revisions or package upgrades.

Sources do not receive a database interface. Obo owns historical base64 and MD5 lookups, deduplication, validation, and raw document persistence. Pagination is in memory for the current scan; no durable queue, checkpoints, or worker leases are required The platform derives the raw URL from the identifier and supplies sourceType, locality, crawledAt, and processing state. Dates in source content cross the package boundary as strings; Obo validates and converts them to its existing persistence representation. GeoJSON is JSON data (including legacy serialized strings); Obo validates it with its existing geometry validator before persistence. The SDK does not replace that validation or define a second GeoJSON schema.

## Discovery payload bounds

The runner uses `serializeDiscoveryPayload` to validate listing context before fetching an item. It rejects non-JSON values, cycles, sparse arrays, accessor properties, custom serialization, nesting beyond 64 levels, and serialized UTF-8 JSON beyond 256 KiB. The limit includes JSON syntax and escaped characters. Plain JSON objects (including null-prototype records), arrays, finite numbers, strings, booleans, and null are supported.

Invalid or oversized context fails that item explicitly. Never silently truncate payload. Reduce listing context or fetch detail content by identifier when possible. The runner logs item failures and continues; the next scheduled scan retries missing items still offered by the provider. An item can be missed if it disappears before a successful fetch. This is an accepted limitation of the simple runner, not a promise of durable recovery.

## Compatibility and release

Both ESM and CommonJS imports are supported with matching type declarations, including the older `node` module resolution used by Obo's production compiler. The metadata subpath has no runtime dependencies. This initial 0.1 contract is a foundation; it does not implement durable orchestration or migrate a source.

Each package owns its version and release notes. Breaking contract changes require explicit consumer migration; never use package updates to change persisted identity. Build and test with `pnpm check` at the repository root. Run `pnpm --dir packages/source-sdk pack` to build a publishable tarball including the inherited LICENSE. Inspect the tarball before manual npm publication. Consumers must pin released package versions in their lockfile; Obo integration starts after publication, not via a private Git checkout dependency.
