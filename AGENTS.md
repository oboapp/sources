# Agent guide

Start with [README.md](README.md) for the package inventory and repository overview.

## Publishing and releases

**Read [RELEASING.md](RELEASING.md) before changing a package version, packing or publishing a release, creating release tags/GitHub releases, or diagnosing npm publication problems.** It is the canonical procedure for every package, including the SDK. Keep release instructions there and link to them from other documentation.

For source migrations and releases, prepare focused PRs, run independent subagent code reviews, address actionable findings and existing review comments, and rerun the affected checks. The user performs the final review and merges the PRs. After merge, verify the exact main commit and CI results, then provide package-specific publishing instructions. The user handles npm login and runs the publication commands. Use this workflow for subsequent source migration items.

## Package boundaries and checks

- Each package owns an independent SemVer version and changelog.
- Source packages supply identifiers and content through the SDK. Obo owns database access, scheduling, deduplication, ingestion, and notifications.
- Preserve historical source IDs and literal identifiers across releases. Keep metadata entrypoints separate from runtime collection code.
- Use `pnpm add` or `pnpm remove` for dependency changes.
- Run `pnpm install --frozen-lockfile` and `pnpm check`. For package changes, also pack and inspect the affected tarball using the release guide.
- Review available CI and Sonar findings and the actual quality gate. State explicitly when Sonar results are unavailable.
- Keep each independently deliverable change in a focused commit and PR. Update the release guide when the publishing process changes.
