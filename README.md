# Obo data sources

Independently versioned data source packages for [Obo](https://github.com/oboapp/oboapp).

The source migration is tracked in [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586). Sources supply discovered identifiers and content; Obo owns scheduling, deduplication, persistence, ingestion, and notifications.

## Contributing and publishing

Agents start with [AGENTS.md](AGENTS.md). For version changes, package publication, release tags, GitHub releases, or publishing problems, follow [RELEASING.md](RELEASING.md), the canonical release procedure for every package.

## Packages

| Package | Purpose |
| --- | --- |
| [`@oboapp/source-sdk`](packages/source-sdk) | Source contracts, isolated catalog metadata types, and discovery payload validation |
| [`@oboapp/source-nimh-severe-weather`](packages/source-nimh-severe-weather) | City-wide NIMH weather warnings with legacy browser-serialized identifiers |
| [`@oboapp/source-web-utils`](packages/source-web-utils) | Shared RSS parsing, browser listing and detail collection |
| [`@oboapp/source-inspectorat-so-org`](packages/source-inspectorat-so-org) | Browser listing and webpage content for Sofia Inspectorate |
| [`@oboapp/source-triaditsa-org`](packages/source-triaditsa-org) | Full-content RSS source for Sofia district Triaditsa |
| [`@oboapp/source-rayon-oborishte-bg`](packages/source-rayon-oborishte-bg) | RSS and webpage source for Sofia district Oborishte |
| [`@oboapp/source-so-slatina-org`](packages/source-so-slatina-org) | RSS and webpage source for Sofia district Slatina |
| [`@oboapp/source-toplo-bg`](packages/source-toplo-bg) | Listing-only heating incidents with synthetic identifiers from Toplofikatsia Sofia |
| [`@oboapp/source-sofiyska-voda`](packages/source-sofiyska-voda) | Paginated ArcGIS water outages with provider geometry from Sofiyska Voda |
| [`@oboapp/source-lozenets-sofia-bg`](packages/source-lozenets-sofia-bg) | RSS and webpage source for Sofia district Lozenets |
| [`@oboapp/source-studentski-bg`](packages/source-studentski-bg) | RSS and webpage source for Sofia district Studentski |
| [`@oboapp/source-rayon-pancharevo-bg`](packages/source-rayon-pancharevo-bg) | Infrastructure announcements and webpage content for Sofia district Pancharevo |
| [`@oboapp/source-sredec-sofia-org`](packages/source-sredec-sofia-org) | Five paginated category feeds and webpage content for Sofia district Sredets |
| [`@oboapp/source-rayon-ilinden-bg`](packages/source-rayon-ilinden-bg) | Browser listing and webpage content for Sofia district Ilinden |
| [`@oboapp/source-nadezhda-org`](packages/source-nadezhda-org) | Browser listing and webpage content for Sofia district Nadezhda |
| [`@oboapp/source-raioniskar-bg`](packages/source-raioniskar-bg) | Browser listing and webpage content for Sofia district Iskar |
| [`@oboapp/source-mladost-bg`](packages/source-mladost-bg) | Repair announcements and webpage content for Sofia district Mladost |
| [`@oboapp/source-vrabnitsa-org`](packages/source-vrabnitsa-org) | News and events with webpage content for Sofia district Vrabnitsa |
| [`@oboapp/source-sdvr-mvr-bg`](packages/source-sdvr-mvr-bg) | Browser news listing and article content for the Sofia Directorate of Interior |

Use Node.js 20.3 or later and the pinned pnpm version. Run `pnpm install --frozen-lockfile` and `pnpm check`. CI checks Node.js 20, 22, and 24 and packs each package.

Run `pnpm test:coverage` for source-mapped coverage across all packages. Node 22 CI
uploads the LCOV report; eligible runs submit it to SonarQube Cloud and wait for
the quality gate. See [SONAR.md](SONAR.md) for organization setup, report checks
and pull-request behavior.

Tests are written in TypeScript, type-checked with `tsc`, and run with Node's test runner through `tsx`. Use JavaScript for configuration and build helpers when TypeScript would add unnecessary setup.

Packages own independent SemVer versions and are published manually after review. Package manifests, npm versions, and package-specific Git tags identify releases. Existing Obo crawlers remain active until each package migration lands separately.

New website packages reuse `source-web-utils`; existing website packages retain
their current released helpers until their own reviewed updates. Workspace helper
dependencies become exact release versions in packed source packages. Publish the
reviewed helper version before the source packages that require it, following
[RELEASING.md](RELEASING.md).

## License

This repository uses **The Unlicense**, inherited from `oboapp/oboapp`. See [LICENSE](LICENSE). The npm SPDX identifier is `Unlicense` (not `UNLICENSED`).
