# Agent guide

Start with [README.md](README.md) for the package inventory and repository overview.

## Publishing and releases

**Read [RELEASING.md](RELEASING.md) before changing a package version, packing or publishing a release, creating release tags/GitHub releases, or diagnosing npm publication problems.** It is the canonical procedure for every package, including the SDK. Keep release instructions there and link to them from other documentation.

Follow the user's authorized scope and retain publication authorization already given in the session. Prepare reviewable changes and checks before requesting any missing decision or access. A merged PR and a successful CI run are release inputs; publication follows the user's release authorization and the guide's verification steps.

## Package boundaries and checks

- Each package owns an independent SemVer version and changelog.
- Source packages supply identifiers and content through the SDK. Obo owns database access, scheduling, deduplication, ingestion, and notifications.
- Preserve historical source IDs and literal identifiers across releases. Keep metadata entrypoints separate from runtime collection code.
- Use `pnpm add` or `pnpm remove` for dependency changes.
- Run `pnpm install --frozen-lockfile` and `pnpm check`. For package changes, also pack and inspect the affected tarball using the release guide.
- Review available CI and Sonar findings and the actual quality gate. State explicitly when Sonar results are unavailable.
- Keep each independently deliverable change in a focused commit and PR. Update the release guide when the publishing process changes.
