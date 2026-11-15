# Publishing source packages

This is the canonical release procedure for every package in this repository, including the SDK. Each package owns its version, changelog, npm tarball, Git tag, and GitHub release. Release only the packages changed by the reviewed PR.

The agent prepares the release from the reviewed, merged commit, creates its tag and GitHub release, and attaches the inspected `.tgz` and SHA-512 checksum. The user downloads that release archive, verifies its checksum, and publishes it to npm manually. The agent then verifies the registry archive and records the release evidence. Reuse authorization already given in the session and keep npm credentials outside this repository.

Follow dependency order for a migration that needs shared helper changes:

1. Review and merge the helper PR.
2. The agent creates the helper's tag and GitHub release with downloadable assets.
3. The user publishes the helper archive to npm; the agent verifies publication.
4. Open the source package PRs against the published helper. After review and merge, the agent creates each source's tag and GitHub release with its archive and checksum.
5. The user publishes the source archives to npm; the agent verifies each publication.
6. Open the integration and cleanup PR in `vbuch/oboapp`, using the exact published versions. Validate the fork before a later upstream backport.

Prepare local code and tests while a dependency release is pending. Open dependent PRs at the stages above. Keep each independently deliverable change in a focused PR. npm publication stays manual.

## 1. Prepare the release PR

Update the affected package's version and changelog in a reviewed PR. Use SemVer: patch for compatible fixes, minor for compatible additions, and an explicit breaking version for contract changes (a minor increment during 0.x). Use `pnpm add` or `pnpm remove` for dependency changes.

Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test:coverage`, and the package's `pnpm pack` command. Inspect available CI and Sonar findings and the actual quality gate before merge. See [SONAR.md](SONAR.md) for coverage mapping, project setup and eligible PR analysis. Report unavailable Sonar results explicitly while account setup or analysis is pending.

Merge the PR after the applicable checks pass. Persisted source IDs and identifiers remain compatibility boundaries across package versions. Updating a package does not authorize refetching existing identifiers or changing historical records.

## 2. Prepare the archive from the exact merged commit

The examples below use PowerShell 7.3 or later from the repository root. The preference settings stop a command block when a native command fails. Run commands in order and stop immediately on any failure. Resolve existing working-tree changes before switching commits.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$packageDirectory = 'source-toplo-bg'
$releaseCommit = '<full merged main commit SHA>'

if (git status --porcelain) {
    throw 'Resolve working-tree changes before preparing a release.'
}
git fetch origin
git switch --detach $releaseCommit
git merge-base --is-ancestor $releaseCommit origin/main
```

`merge-base` must return exit code 0. Inspect CI for this exact merged commit, including the Node 20, 22, and 24 jobs and the actual Sonar quality gate. Record the commit, merged PR and CI links in the release handoff.

Derive the package name, version, archive path, checksum path and tag from the checked-out manifest:

```powershell
$packagePath = "packages/$packageDirectory"
$package = Get-Content -LiteralPath "$packagePath/package.json" -Raw | ConvertFrom-Json
$packageName = $package.name
$packageVersion = $package.version
$tarballName = $packageName.Replace('@', '').Replace('/', '-') + "-$packageVersion.tgz"
$tarballPath = "./$packagePath/$tarballName"
$checksumPath = "${tarballPath}.sha512"
$releaseTag = "${packageDirectory}-v${packageVersion}"
```

Use Node.js 20.3 or later and the pnpm version pinned in the root `packageManager` field. Check the selected package's engine requirements as well.

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm test:coverage
pnpm --dir $packagePath pack
tar -tf $tarballPath
tar -xOf $tarballPath package/package.json
tar -xOf $tarballPath package/README.md
```

Inspect the archive before creating the release. Confirm its name and version, ESM/CommonJS runtime exports, type declarations, separate metadata entrypoint where applicable, package README, and inherited LICENSE. It must exclude tests, provider fixtures, credentials, and `node_modules`. Compare the intended package files with its `files` and `exports` fields.

An ignored dependency build-script warning can occur under pnpm 10. Run `pnpm check` to verify the installed tools. If a tool actually fails because its build script was blocked, review and approve only that dependency with `pnpm approve-builds`. Any resulting repository policy change belongs in a reviewed PR; rebuild the release from its merged commit.

Write the checksum for this inspected archive. The checksum file contains its hexadecimal SHA-512 value and archive filename:

```powershell
$archiveHash = (Get-FileHash -LiteralPath $tarballPath -Algorithm SHA512).Hash.ToLowerInvariant()
"$archiveHash  $tarballName" | Set-Content -LiteralPath $checksumPath -Encoding ascii
Get-Content -LiteralPath $checksumPath
```

Keep this exact archive and checksum for the release upload and later registry comparison.

## 3. Create the tag and downloadable GitHub release

Use `<package-directory>-v<version>` for each package's tag. Inspect existing records before creating anything:

```powershell
if (git tag --list $releaseTag) {
    git rev-list -n 1 $releaseTag
}
git ls-remote --tags origin "refs/tags/$releaseTag" "refs/tags/$releaseTag^{}"
gh release list --repo oboapp/sources
```

Compare any local tag target and remote tag's peeled commit with `$releaseCommit`. Inspect an existing release's tag and assets as well. Existing tags, releases and uploaded archives must keep their original commit and bytes. Resolve mismatches before continuing. Never force a tag or replace a release asset with `--clobber`.

For a release with neither a tag nor a GitHub release:

```powershell
git tag -a $releaseTag $releaseCommit -m "Release ${packageName}@${packageVersion}"
git push origin $releaseTag
gh release create $releaseTag $tarballPath $checksumPath --repo oboapp/sources --verify-tag --title "${packageName}@${packageVersion}" --notes "Prepared ${packageName}@${packageVersion} from $releaseCommit. Download the attached .tgz and verify its SHA-512 checksum before manually publishing to npm. See $packagePath/CHANGELOG.md at this tag."
```

Verify that both assets are downloadable from the release. Download them to a new or empty directory and compare the downloaded archive's SHA-512 value with `$archiveHash`. Record the release URL, archive download URL, version, exact commit and checksum in the user handoff. npm publication follows in step 4.

Give the user a paste-ready command block containing `gh release download` and `npm publish` with the actual repository, release tag, asset filenames and download directory for that release. Include the checksum verification between download and publication. The user should be able to run the block without looking up resource names or preparing a source checkout. When several package releases are ready, group their commands into one block in dependency order.

If a step fails, resume only the missing step after inspecting the current records:

- If the matching tag exists only locally, push it and create the missing release.
- If the matching tag is remote, create the missing release with `--verify-tag`.
- If the release exists but an asset is missing, upload only that missing asset with `gh release upload <tag> <asset-path> --repo oboapp/sources`. Verify it belongs to the same inspected archive and commit before upload.
- If an asset already exists, download it and compare bytes or checksums. Preserve it while resolving any mismatch. A package-content correction requires a reviewed version increment.

## 4. The user downloads, verifies and publishes to npm

The user downloads the `.tgz` and its `.tgz.sha512` file from the GitHub release. Publish that downloaded archive so the registry receives the same bytes that were reviewed and handed off. Confirm npm account and scope access before the first release of a package.

The user can download both assets with GitHub CLI into a new directory:

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$releaseTag = '<tag from the release handoff>'
$tarballName = '<archive filename from the release handoff>'
$downloadDirectory = Join-Path $PWD 'release-download'
if (Test-Path -LiteralPath $downloadDirectory) {
    throw 'Choose a new download directory to preserve existing files.'
}
New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
gh release download $releaseTag --repo oboapp/sources --pattern $tarballName --pattern "${tarballName}.sha512" --dir $downloadDirectory
$tarballPath = Join-Path $downloadDirectory $tarballName
```

For a browser download, set `$tarballPath` to the downloaded archive's absolute path. Keep the matching checksum file beside it. Verify the downloaded archive and check npm access:

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$checksumPath = "${tarballPath}.sha512"
$tarballName = Split-Path -Leaf $tarballPath
$checksumFields = (Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+', 2
if ($checksumFields.Count -ne 2 -or $checksumFields[1] -ne $tarballName) {
    throw 'The checksum file does not name this archive.'
}
$downloadedHash = (Get-FileHash -LiteralPath $tarballPath -Algorithm SHA512).Hash
if ($downloadedHash -ne $checksumFields[0]) {
    throw 'Downloaded archive checksum verification failed.'
}

npm config get '@oboapp:registry'
npm whoami --registry=https://registry.npmjs.org
```

The scope registry must be unset or point to `https://registry.npmjs.org`. Resolve a different scope override before publishing. If `npm whoami` fails or reports the wrong account, run `npm login --registry=https://registry.npmjs.org` and retry it. Confirm the reported account has publishing access to the selected package.

If this name/version may already be published, perform the read-only registry checks in step 5 before attempting publication. Otherwise, publish the verified downloaded archive:

```powershell
npm publish $tarballPath --access public --registry=https://registry.npmjs.org
```

Complete any browser, two-factor authentication, or staged-approval prompts from npm. Publish one selected package at a time. The user handles npm authentication and publication; the agent handles release preparation and verification.

## 5. Verify npm against the GitHub release archive

After the user publishes, check both the package index and the selected version through the public npm registry. In a new shell, restore `$packageName` and `$packageVersion` from the release's manifest and set `$tarballPath` to its verified downloaded archive:

```powershell
npm view $packageName dist-tags versions --json --prefer-online --registry=https://registry.npmjs.org
npm view "${packageName}@${packageVersion}" version dist.integrity dist.shasum --json --prefer-online --registry=https://registry.npmjs.org
npm view $packageName readme --prefer-online --registry=https://registry.npmjs.org
```

Confirm the intended version is available and the intended dist-tag points to it. These commands use npm's default `latest` tag; a different tag requires an explicit release decision. Confirm the registry README matches the archive README, and open the package's npm page to check its README and repository link.

Verify that the npm archive is byte-for-byte identical to the verified GitHub release archive. npm's `dist.integrity` uses base64, so compute a SHA-512 value in the same format:

```powershell
$tarballBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $tarballPath).Path)
$sha512 = [System.Security.Cryptography.SHA512]::Create()
try {
    $localIntegrity = 'sha512-' + [Convert]::ToBase64String($sha512.ComputeHash($tarballBytes))
} finally {
    $sha512.Dispose()
}
$registryIntegrity = npm view "${packageName}@${packageVersion}" dist.integrity --prefer-online --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) {
    throw 'Registry verification failed. Resolve it before integration.'
}
if ($localIntegrity -ne $registryIntegrity.Trim()) {
    throw 'Published tarball integrity differs from the GitHub release archive.'
}
```

Record the merged PR, exact commit, CI result, actual Sonar quality-gate result or access limitation, Git tag, GitHub release and asset URLs, published npm version, and integrity value. The package release is complete when the downloadable assets and registry verification succeed.

### Registry propagation and partial failures

During the first Toplo publication, the version and tarball endpoints worked while the package index returned 404. The index later returned the release and its README. Allow a few minutes and repeat the read-only checks when registry responses disagree. Verify the archive and registry README before treating a website rendering problem as a missing file. See [npm's README guidance](https://docs.npmjs.com/about-package-readme-files/).

That publication also showed a `0.0.0-stage` entry alongside `0.1.0`. Inspect the actual version list and dist-tags to identify the release; the website's version count alone is insufficient.

If publishing times out or returns an uncertain result, check whether the exact version exists before retrying. Once a name/version is published, it is immutable. Preserve the npm version and GitHub release assets while diagnosing a mismatch. A genuine package-content correction needs a reviewed version increment. See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

## 6. Integrate the published version in Obo

After all required helper and source versions are published and verified, open a separate reviewed integration and cleanup PR in `vbuch/oboapp`. Pin the exact published version with `pnpm add --save-exact`, commit the lockfile, and run Obo's required quality checks and package-to-ingestion contracts before switching the selected source.

For example, from the Obo repository root:

```powershell
pnpm --dir ingest add --save-exact "${packageName}@${packageVersion}"
```

Keep existing source IDs, literal identifiers, localities, schedules, historical document lookups, and a rollback path. Follow [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586) and the consumer repository's instructions for the cutover. Validate the fork's CI and deployed collection behavior over the agreed observation period before preparing a later upstream backport.
