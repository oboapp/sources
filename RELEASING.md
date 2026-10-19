# Independent package releases

Each package owns its version, changelog, and npm tarball. Releasing the SDK does not require bumping source packages, and releasing one source does not require publishing the others. Do not use a single repository-wide package version.

## First release (manual)

The owner sets up the npm scope and publishing access. No npm token is stored in this repository. Publishing is deliberately not triggered by CI or merging a PR.

1. Merge the package PR after CI passes, then check out that exact `main` commit.
2. Use the repository's pinned pnpm version, install with `pnpm install --frozen-lockfile`, and run `pnpm check`.
3. Run `pnpm --dir packages/source-sdk pack` and inspect the tarball. It must contain the ESM/CommonJS output, declarations, README, package metadata, and LICENSE. It must not contain secrets, tests, or `node_modules`.
4. Publish the reviewed tarball using your npm account: `npm publish packages/source-sdk/oboapp-source-sdk-0.1.0.tgz --access public`.
5. Tag the exact released commit as `source-sdk-v0.1.0` and record the release on GitHub. Never overwrite a published version.
6. In Obo, install the published package with `pnpm add` and commit the lockfile in its integration PR. Run the full Obo quality checks before switching any collector.

The sources repository's visibility does not publish packages. Public npm package contents must be reviewed independently.

## Subsequent releases

Change only affected package versions and changelogs in a release PR. Use SemVer: patch for compatible fixes, minor for compatible additions, and an explicit breaking version for contract changes (a minor increment during 0.x). Name tags `<package-directory>-v<version>`. Repeat the checks and tarball publication above for each changed package. A later automation can replace the manual publication step after npm authorization is configured; it must preserve independent versions.

Persisted source IDs and identifiers are compatibility boundaries even across major package versions. Fixing old messages or refetching known identifiers requires a separate platform migration and must never happen merely because a package was updated.
