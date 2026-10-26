# Obo data sources

Independently versioned data source packages for [Obo](https://github.com/oboapp/oboapp).

This repository is being established as part of [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586). Sources supply discovered identifiers and content; Obo owns scheduling, deduplication, persistence, ingestion, and notifications.

## Packages

| Package | Purpose |
| --- | --- |
| [`@oboapp/source-sdk`](packages/source-sdk) | Source contracts, isolated catalog metadata types, and discovery payload validation |
| [`@oboapp/source-triaditsa-org`](packages/source-triaditsa-org) | Full-content RSS source for Sofia district Triaditsa |

Use Node.js 20 or later and the pinned pnpm version. Run `pnpm install --frozen-lockfile` and `pnpm check`. CI checks Node.js 20, 22, and 24 and packs both packages.

Tests are written in TypeScript, type-checked with `tsc`, and run with Node's test runner through `tsx`. Use JavaScript for configuration and build helpers when TypeScript would add unnecessary setup.

Packages own independent SemVer versions. The SDK release `0.1.1` is published on npm; subsequent publication remains manual. See [RELEASING.md](RELEASING.md). Existing Obo crawlers remain active until each package migration lands separately.

## License

This repository uses **The Unlicense**, inherited from `oboapp/oboapp`. See [LICENSE](LICENSE). The npm SPDX identifier is `Unlicense` (not `UNLICENSED`).
