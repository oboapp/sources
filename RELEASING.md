# Publishing source packages

This is the canonical release procedure for every package in this repository, including the SDK. Each package owns its version, changelog, npm tarball, Git tag, and GitHub release. Release only the packages changed by the reviewed PR.

The agent prepares the PRs, runs independent subagent reviews, addresses findings,
and checks the results. The user then performs the final review and merges. After
merge, the agent provides the exact commands below for the selected packages and
merged commit. The user handles npm login and executes the publishing commands.
Follow this sequence for later source migration items.

## 1. Prepare the release PR

Update the affected package's version and changelog in a reviewed PR. Use SemVer: patch for compatible fixes, minor for compatible additions, and an explicit breaking version for contract changes (a minor increment during 0.x). Use `pnpm add` or `pnpm remove` for dependency changes.

Run `pnpm install --frozen-lockfile`, `pnpm check`, and the package's `pnpm pack` command. Inspect available CI and Sonar findings and the actual quality gate before merge. Sonar coverage in this repository is tracked in [oboapp/oboapp#663](https://github.com/oboapp/oboapp/issues/663); report unavailable results explicitly while that setup is pending.

The user reviews and merges the PR after the applicable checks pass. Prepare the publishing instructions after merge, using the exact merged main commit and its successful CI run. Confirm npm account/scope access before the first release of a package. Keep credentials outside this repository.

Persisted source IDs and identifiers remain compatibility boundaries across package versions. Updating a package does not authorize refetching existing identifiers or changing historical records.

## 2. Check out the exact merged commit

The commands below are for the user to run after merge. They use PowerShell 7.3 or later from the repository root. The preference settings stop a command block when a native command fails. Run commands in order and stop immediately on any failure. Resolve existing working-tree changes before switching commits.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$packageDirectory = 'source-toplo-bg'
$releaseCommit = '<full merged main commit SHA>'

git status --short
git fetch origin
git switch --detach $releaseCommit
git merge-base --is-ancestor $releaseCommit origin/main
```

The working tree must be clean, and `merge-base` must return exit code 0. Inspect CI for this exact commit, including the Node 20, 22, and 24 jobs. Record the commit and CI link in the release handoff.

Derive the package name, version, tarball path, and tag from the checked-out manifest:

```powershell
$packagePath = "packages/$packageDirectory"
$package = Get-Content -LiteralPath "$packagePath/package.json" -Raw | ConvertFrom-Json
$packageName = $package.name
$packageVersion = $package.version
$tarballName = $packageName.Replace('@', '').Replace('/', '-') + "-$packageVersion.tgz"
$tarballPath = "./$packagePath/$tarballName"
$releaseTag = "$packageDirectory-v$packageVersion"
```

Use Node.js 20.3 or later and the pnpm version pinned in the root `packageManager` field. Check the selected package's engine requirements as well.

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm --dir $packagePath pack
tar -tf $tarballPath
tar -xOf $tarballPath package/package.json
tar -xOf $tarballPath package/README.md
```

Inspect the archive before publishing. Confirm its name and version, ESM/CommonJS runtime exports, type declarations, isolated metadata entrypoint, package README, and inherited LICENSE. It must exclude tests, provider fixtures, credentials, and `node_modules`. Compare the intended package files with its `files` and `exports` fields.

An ignored dependency build-script warning can occur under pnpm 10. Run `pnpm check` to verify the installed tools. If a tool actually fails because its build script was blocked, review and approve only that dependency with `pnpm approve-builds`. Any resulting repository policy change belongs in a reviewed PR; rebuild the release from its merged commit.

## 3. Publish the inspected tarball

Authenticate with the npm account that has publishing access to the package. Check that the `@oboapp` registry setting is unset or points to the public npm registry. Resolve a different scoped registry override before publishing.

```powershell
npm config get '@oboapp:registry'
npm whoami --registry=https://registry.npmjs.org
```

If `npm whoami` fails or reports the wrong account, run `npm login --registry=https://registry.npmjs.org` and retry it. If this version may already have been published, use the read-only checks in step 4 before attempting publication.

Publish the exact archive inspected above to the public npm registry. The explicit `./` prefix identifies a local tarball path.

```powershell
npm publish $tarballPath --access public --registry=https://registry.npmjs.org
```

Complete any browser, two-factor authentication, or staged-approval prompts from npm. Confirm publication succeeded before proceeding. The user publishes one selected package at a time. Keep this publication step manual.

## 4. Verify npm before tagging

Check both the package index and the selected version through the public npm registry:

```powershell
npm view $packageName dist-tags versions --json --prefer-online --registry=https://registry.npmjs.org
npm view "$packageName@$packageVersion" version dist.integrity dist.shasum --json --prefer-online --registry=https://registry.npmjs.org
npm view $packageName readme --prefer-online --registry=https://registry.npmjs.org
```

Confirm the intended version is available and the intended dist-tag points to it. These commands use npm's default `latest` tag; a different tag requires an explicit release decision. Confirm the registry README matches the package README.

Verify the uploaded archive is byte-for-byte identical to the inspected local archive. npm's `dist.integrity` uses base64, so compute a SHA-512 value in the same format:

```powershell
$tarballBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $tarballPath).Path)
$sha512 = [System.Security.Cryptography.SHA512]::Create()
try {
  $localIntegrity = 'sha512-' + [Convert]::ToBase64String($sha512.ComputeHash($tarballBytes))
} finally {
  $sha512.Dispose()
}
$registryIntegrity = npm view "$packageName@$packageVersion" dist.integrity --prefer-online --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) {
  throw 'Registry verification failed. Resolve it before tagging.'
}
if ($localIntegrity -ne $registryIntegrity.Trim()) {
  throw 'Published tarball integrity differs from the inspected local archive.'
}
```

Record the version and integrity value. Open the package's npm page and check its README and repository link.

### Registry propagation and partial failures

During the first Toplo publication, the version and tarball endpoints worked while the package index returned 404. The index later returned the release and its README. Allow a few minutes and repeat the read-only checks when registry responses disagree. Verify the archive and registry README before treating a website rendering problem as a missing file. See [npm's README guidance](https://docs.npmjs.com/about-package-readme-files/).

That publication also showed a `0.0.0-stage` entry alongside `0.1.0`. Inspect the actual version list and dist-tags to identify the release; the website's version count alone is insufficient.

If publishing times out or returns an uncertain result, check whether the exact version exists before retrying. Once a name/version is published, it is immutable. Preserve the existing release while diagnosing registry or website problems. A genuine package-content correction needs a reviewed version increment. See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

If tag creation or GitHub release creation fails after successful npm publication, resume those recording steps. Compare existing tags/releases with the intended commit and version before creating them. Existing release records must keep their original commit.

## 5. Tag the released commit and create its GitHub release

Use `<package-directory>-v<version>` for each package's tag. First inspect any existing release records:

```powershell
if (git tag --list $releaseTag) {
  git rev-list -n 1 $releaseTag
}
git ls-remote --tags origin "refs/tags/$releaseTag" "refs/tags/$releaseTag^{}"
gh release list --repo oboapp/sources
```

Compare any local tag target and remote tag's peeled commit with `$releaseCommit`. If the matching tag exists only locally, resume with `git push` and then create the missing GitHub release. If the matching tag is already remote, create only the missing GitHub release. Resolve mismatches before continuing and preserve existing published tags.

For a release with neither a tag nor a GitHub release:

```powershell
git tag -a $releaseTag $releaseCommit -m "Release $packageName@$packageVersion"
git push origin $releaseTag
gh release create $releaseTag --repo oboapp/sources --verify-tag --title "$packageName@$packageVersion" --notes "Release $packageName@$packageVersion from $releaseCommit. See $packagePath/CHANGELOG.md at this tag."
```

Record the merged PR, CI result, published npm version, integrity, tag, and GitHub release URL in the handoff. A release is complete when registry verification and both release records succeed.

## 6. Integrate the published version in Obo

Use a separate reviewed Obo integration PR. Pin the exact published version with `pnpm add --save-exact`, commit the lockfile, and run Obo's required quality checks and package-to-ingestion contracts before switching the selected source.

For example, from the Obo repository root:

```powershell
pnpm --dir ingest add --save-exact "$packageName@$packageVersion"
```

Keep existing source IDs, literal identifiers, localities, schedules, historical document lookups, and a rollback path. Follow [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586) and the consumer repository's instructions for the cutover.
