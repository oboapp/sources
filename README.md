# Obo data sources

Independently versioned data source packages for [Obo](https://github.com/oboapp/oboapp).

The source migration is tracked in [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586). Sources supply discovered identifiers and content; Obo owns scheduling, deduplication, persistence, ingestion, and notifications.

## Contributing and publishing

Agents start with [AGENTS.md](AGENTS.md). For version changes, package publication, release tags, GitHub releases, or publishing problems, follow [RELEASING.md](RELEASING.md), the canonical release procedure for every package.

## Packages

| Package | Purpose |
| --- | --- |
| [`@oboapp/source-sdk`](packages/source-sdk) | Source contracts, isolated catalog metadata types, and discovery payload validation |
| [`@oboapp/source-facebook`](packages/source-facebook) | Configurable, admin-authorized Facebook Page source with independent instances |
| [`@oboapp/source-triaditsa-org`](packages/source-triaditsa-org) | Full-content RSS source for Sofia district Triaditsa |
| [`@oboapp/source-rayon-oborishte-bg`](packages/source-rayon-oborishte-bg) | RSS and webpage source for Sofia district Oborishte |
| [`@oboapp/source-so-slatina-org`](packages/source-so-slatina-org) | RSS and webpage source for Sofia district Slatina |
| [`@oboapp/source-toplo-bg`](packages/source-toplo-bg) | Listing-only heating incidents with synthetic identifiers from Toplofikatsia Sofia |

Use Node.js 20.3 or later and the pinned pnpm version. Run `pnpm install --frozen-lockfile` and `pnpm check`. CI checks Node.js 20, 22, and 24 and packs each package.

Tests are written in TypeScript, type-checked with `tsc`, and run with Node's test runner through `tsx`. Use JavaScript for configuration and build helpers when TypeScript would add unnecessary setup.

Packages own independent SemVer versions and are published manually after review. Package manifests, npm versions, and package-specific Git tags identify releases. Existing Obo crawlers remain active until each package migration lands separately.

## License

This repository uses **The Unlicense**, inherited from `oboapp/oboapp`. See [LICENSE](LICENSE). The npm SPDX identifier is `Unlicense` (not `UNLICENSED`).
