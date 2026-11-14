# Publishing source packages

This is the canonical release procedure for every package in this repository, including the SDK. Each package owns its version, changelog, npm tarball, Git tag, and GitHub release. Release only the packages changed by the reviewed PR.

## 1. Prepare the release PR

Update the affected package's version and changelog in a reviewed PR. Use SemVer: patch for compatible fixes, minor for compatible additions, and an explicit breaking version for contract changes (a minor increment during 0.x). Use `pnpm add` or `pnpm remove` for dependency changes.

Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test:coverage`, and the package's `pnpm pack` command. Inspect available CI and Sonar findings and the actual quality gate before merge. See [SONAR.md](SONAR.md) for coverage mapping, project setup and eligible PR analysis. Report unavailable Sonar results explicitly while account setup or analysis is pending.

Merge the PR after the applicable checks pass. The agent verifies the merged commit, creates its package tag and GitHub release, attaches the inspected npm tarball, and gives the user exact publication commands. The user publishes to npm using their own account. The agent then verifies the registry and integrates the published version in the fork. Reuse authorization already given in the session. Keep credentials outside this repository; the agent must not request npm credentials, require a separate login step, or ask again for an already authorized release action.

Persisted source IDs and identifiers remain compatibility boundaries across package versions. Updating a package does not authorize refetching existing identifiers or changing historical records.

## 2. Check out the exact merged commit

The examples below use PowerShell 7.3 or later from the repository root. The preference settings stop a command block when a native command fails. Run commands in order and stop immediately on any failure. Resolve existing working-tree changes before switching commits.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$packageDirectory = 'source-sofiyska-voda'
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

## 3. Create and verify the GitHub release with its npm tarball

The agent completes this step before handing npm publication to the user. Use `<package-directory>-v<version>` for each package's tag. First inspect any existing release records:

```powershell
if (git tag --list $releaseTag) {
  git rev-list -n 1 $releaseTag
}
git ls-remote --tags origin "refs/tags/$releaseTag" "refs/tags/$releaseTag^{}"
gh release list --repo oboapp/sources
```

Compare any local tag target and remote tag's peeled commit with `$releaseCommit`. If the matching tag exists only locally, resume with `git push` and then create the missing GitHub release. If the matching tag is already remote, create only the missing GitHub release. Resolve mismatches before continuing and preserve existing published tags.

Calculate the inspected archive's npm integrity value and include it in the handoff:

```powershell
$tarballBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $tarballPath).Path)
$sha512 = [System.Security.Cryptography.SHA512]::Create()
try {
  $localIntegrity = 'sha512-' + [Convert]::ToBase64String($sha512.ComputeHash($tarballBytes))
} finally {
  $sha512.Dispose()
}
```

For a release with neither a tag nor a GitHub release:

```powershell
git tag -a $releaseTag $releaseCommit -m "Release $packageName@$packageVersion"
git push origin $releaseTag
gh release create $releaseTag $tarballPath --repo oboapp/sources --verify-tag --title "$packageName@$packageVersion" --notes "Release $packageName@$packageVersion from $releaseCommit. npm publication is pending the user's manual publish step. Publish the attached tarball. Expected npm dist.integrity: $localIntegrity. See $packagePath/CHANGELOG.md at this tag."
```

For an existing matching GitHub release, attach the inspected archive with `gh release upload $releaseTag $tarballPath --repo oboapp/sources` if that asset is missing. Preserve existing assets; inspect a matching asset before reusing it.

Verify the remote tag points to `$releaseCommit`, the GitHub release references that tag, and its npm `.tgz` asset matches the inspected archive byte for byte. Download the asset into a new temporary directory and compare its SHA-512 integrity with `$localIntegrity`. Record the merged PR, exact-commit CI and quality-gate results, tag, release URL, asset URL and integrity value. State that npm publication is pending until step 5 succeeds.

## 4. Hand the verified tarball to the user for npm publication

The agent gives the user a self-contained command block with the exact package version, attached asset URL, local archive path and expected integrity value. The user downloads that verified npm archive and publishes it with their existing npm access. The user completes any authentication or two-factor prompts raised by npm. A separate agent-requested login or credential-sharing step is unnecessary.

The handoff should use the attached package asset, so the user can publish without cloning, rebuilding or repacking the repository. For example, the [Sofiyska Voda 0.1.0 release](https://github.com/oboapp/sources/releases/tag/source-sofiyska-voda-v0.1.0) provides this verified archive. From the user's chosen download directory:

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$packageName = '@oboapp/source-sofiyska-voda'
$packageVersion = '0.1.0'
$tarballPath = Join-Path (Get-Location) 'oboapp-source-sofiyska-voda-0.1.0.tgz'
Invoke-WebRequest -Uri 'https://github.com/oboapp/sources/releases/download/source-sofiyska-voda-v0.1.0/oboapp-source-sofiyska-voda-0.1.0.tgz' -OutFile $tarballPath

$expectedIntegrity = 'sha512-BNKxX8xNPMcH3azEs4tQUd37900wLTW+iLRSEwnv46Ns1EaLlx7IKWv/OhFRvua6Q0y3QYxqR5oQSMoB6Ajm/g=='
$tarballBytes = [System.IO.File]::ReadAllBytes($tarballPath)
$sha512 = [System.Security.Cryptography.SHA512]::Create()
try {
  $downloadedIntegrity = 'sha512-' + [Convert]::ToBase64String($sha512.ComputeHash($tarballBytes))
} finally {
  $sha512.Dispose()
}
if ($downloadedIntegrity -ne $expectedIntegrity) {
  throw 'Downloaded tarball integrity differs from the verified release asset.'
}

npm publish $tarballPath --access public --registry=https://registry.npmjs.org
```

For each release, substitute its own verified values before giving the commands to the user. Check that any scoped registry override agrees with the public registry. If the version may already exist or a publish attempt has an uncertain result, use the read-only registry checks in step 5 before another publication attempt. Publish one selected package at a time.

The agent resumes registry verification after the user reports publication. Keep npm publication manual until a separately reviewed workflow changes these responsibilities.

## 5. Verify the user-published package on npm

After the user publishes, the agent checks both the package index and the selected version through the public npm registry. Use the package name, version and verified archive from the handoff:

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
  throw 'Registry verification failed. Resolve it before integration.'
}
if ($localIntegrity -ne $registryIntegrity.Trim()) {
  throw 'Published tarball integrity differs from the inspected local archive.'
}
```

Record the merged PR, exact-commit CI and quality gate, npm version, verified integrity, tag and GitHub release URL. Open the package's npm page and check its README and repository link. The release is complete when the tag and GitHub release are verified and npm publication passes the registry, README and integrity checks.

### Registry propagation and partial failures

During the first Toplo publication, the version and tarball endpoints worked while the package index returned 404. The index later returned the release and its README. Allow a few minutes and repeat the read-only checks when registry responses disagree. Verify the archive and registry README before treating a website rendering problem as a missing file. See [npm's README guidance](https://docs.npmjs.com/about-package-readme-files/).

That publication also showed a `0.0.0-stage` entry alongside `0.1.0`. Inspect the actual version list and dist-tags to identify the release; the website's version count alone is insufficient.

If publishing times out or returns an uncertain result, check whether the exact version exists before retrying. Once a name/version is published, it is immutable. Preserve the existing release while diagnosing registry or website problems. A genuine package-content correction needs a reviewed version increment. See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

If tag creation, release creation or asset upload fails, resume the missing part of step 3 before the user publishes. If npm publication fails or remains pending after the GitHub release exists, preserve that tag, release and verified archive. Compare registry state before retrying publication. Existing release records must keep their original commit.

## 6. Integrate the published version in Obo

Start with a separate reviewed integration PR in [vbuch/oboapp](https://github.com/vbuch/oboapp). Pin the exact verified npm version with `pnpm add --save-exact`, commit the lockfile, and run the fork's required quality checks and package-to-ingestion contracts before switching the selected source. Validate the fork's CI and production deployment before backporting generic changes to [oboapp/oboapp](https://github.com/oboapp/oboapp). Preserve each instance's selected catalog, jobs and deployment settings.

For example, from the fork repository root:

```powershell
pnpm --dir ingest add --save-exact "$packageName@$packageVersion"
```

Keep existing source IDs, literal identifiers, localities, schedules, historical document lookups, and a rollback path. Follow [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586) and the consumer repository's instructions for the cutover.
