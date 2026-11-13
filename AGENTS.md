# Agent guide

Start with [README.md](README.md) for the package inventory and repository overview.

## Publishing and releases

**Read [RELEASING.md](RELEASING.md) before changing a package version, packing or publishing a release, creating release tags/GitHub releases, or diagnosing npm publication problems.** It is the canonical procedure for every package, including the SDK. Keep release instructions there and link to them from other documentation.

Follow the user's authorized scope and retain authorization already given in the session. The agent verifies the merged release commit, creates the package tag and GitHub release, and attaches the inspected npm tarball. The agent then gives the user exact publication commands; the user publishes to npm with their own account. Verify the registry version, README and tarball integrity afterward. Do not request npm credentials, require a separate login step, or ask again for an already authorized release action.

Integrate verified published packages in `vbuch/oboapp` first. Validate the fork's CI and production deployment before backporting generic changes to `oboapp/oboapp`.

## Package boundaries and checks

- Each package owns an independent SemVer version and changelog.
- Source packages supply identifiers and content through the SDK. Obo owns database access, scheduling, deduplication, ingestion, and notifications.
- Preserve historical source IDs and literal identifiers across releases. Keep metadata entrypoints separate from runtime collection code.
- Use `pnpm add` or `pnpm remove` for dependency changes.
- Run `pnpm install --frozen-lockfile` and `pnpm check`. For package changes, also pack and inspect the affected tarball using the release guide.
- Review available CI and Sonar findings and the actual quality gate. State explicitly when Sonar results are unavailable.
- Keep each independently deliverable change in a focused commit and PR. Update the release guide when the publishing process changes.
