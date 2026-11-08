# Obo data sources

Independently versioned data source packages for [Obo](https://github.com/oboapp/oboapp).

The source migration is tracked in [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586). Sources supply discovered identifiers and content; Obo owns scheduling, deduplication, persistence, ingestion, and notifications.

## Contributing and publishing

Agents start with [AGENTS.md](AGENTS.md). For version changes, package publication, release tags, GitHub releases, or publishing problems, follow [RELEASING.md](RELEASING.md), the canonical release procedure for every package.

## Packages

| Package | Purpose |
| --- | --- |
| [`@oboapp/source-sdk`](packages/source-sdk) | Source contracts, isolated catalog metadata types, and discovery payload validation |
| [`@oboapp/source-web-utils`](packages/source-web-utils) | Shared RSS parsing, browser listing and detail collection |
| [`@oboapp/source-triaditsa-org`](packages/source-triaditsa-org) | Full-content RSS source for Sofia district Triaditsa |
| [`@oboapp/source-rayon-oborishte-bg`](packages/source-rayon-oborishte-bg) | RSS and webpage source for Sofia district Oborishte |
| [`@oboapp/source-so-slatina-org`](packages/source-so-slatina-org) | RSS and webpage source for Sofia district Slatina |
| [`@oboapp/source-toplo-bg`](packages/source-toplo-bg) | Listing-only heating incidents with synthetic identifiers from Toplofikatsia Sofia |
| [`@oboapp/source-lozenets-sofia-bg`](packages/source-lozenets-sofia-bg) | RSS and webpage source for Sofia district Lozenets |
| [`@oboapp/source-studentski-bg`](packages/source-studentski-bg) | RSS and webpage source for Sofia district Studentski |
| [`@oboapp/source-sredec-sofia-org`](packages/source-sredec-sofia-org) | Five paginated category feeds and webpage content for Sofia district Sredets |
| [`@oboapp/source-rayon-ilinden-bg`](packages/source-rayon-ilinden-bg) | Browser listing and webpage content for Sofia district Ilinden |

Use Node.js 20.3 or later and the pinned pnpm version. Run `pnpm install --frozen-lockfile` and `pnpm check`. CI checks Node.js 20, 22, and 24 and packs each package.

Tests are written in TypeScript, type-checked with `tsc`, and run with Node's test runner through `tsx`. Use JavaScript for configuration and build helpers when TypeScript would add unnecessary setup.

Packages own independent SemVer versions and are published manually after review. Package manifests, npm versions, and package-specific Git tags identify releases. Existing Obo crawlers remain active until each package migration lands separately.

New website packages reuse `source-web-utils`; existing website packages retain
their current released helpers until their own reviewed updates. Workspace helper
dependencies become exact release versions in packed source packages. Publish the
reviewed helper version before the source packages that require it, following
[RELEASING.md](RELEASING.md).

## License

This repository uses **The Unlicense**, inherited from `oboapp/oboapp`. See [LICENSE](LICENSE). The npm SPDX identifier is `Unlicense` (not `UNLICENSED`).
