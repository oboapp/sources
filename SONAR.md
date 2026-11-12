# Coverage and SonarQube Cloud

This repository uses one SonarQube Cloud project, `oboapp_sources`, in the existing
`oboapp` organization. The organization's SonarQube for OSS plan covers its public
repositories, including this one. Each npm package keeps its independent version.
Sonar also analyzes CI workflow YAML for security findings. Workflow configuration
is excluded from runtime test coverage; LCOV measures package TypeScript only.

## Local coverage

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:coverage
```

The coverage build adds inline source maps to the compiled ESM output. The existing
tests run against the package builds, including their CommonJS smoke checks.
Native V8 coverage measures the ESM implementation and remaps it to
`packages/*/src/**/*.ts`. Each source file is measured once. Untested production
files are included. Tests, fixtures, dependencies and generated output are
excluded from the final report.

`coverage/lcov.info` is the scanner input. `coverage/coverage-summary.json` and the
terminal summary show the local measurements. The coverage command checks report
paths and source-file completeness before CI uploads it. A normal `pnpm build`,
including each package's `prepack` build, restores the ordinary release output.
This setup requires no npm publication.

c8 measures V8 source ranges, which can include type declarations and comment
lines after remapping. Record its percentages as the local tool baseline and
verify Sonar's imported measurements independently.

## Maintainer setup

1. In SonarQube Cloud, open the existing `oboapp` organization and import the public
   GitHub repository `oboapp/sources`. Use project key `oboapp_sources`, matching
   `sonar-project.properties`. Keep the current OSS subscription.
2. Choose **With GitHub Actions** as the analysis method. If automatic analysis was
   enabled during import, disable it under **Administration > Analysis Method**.
   CI supplies the LCOV report; automatic analysis does not import coverage.
3. Keep the organization quality profile and quality gate used by `oboapp_oboapp`.
   Check their actual associations on both projects before treating them as equal.
   Set the main branch to `main` and configure the project's new-code definition.
4. Follow Sonar's GitHub Actions setup to obtain an analysis token with access to
   this project. Store it directly in the GitHub repository's **Settings > Secrets
   and variables > Actions** as `SONAR_TOKEN`. An existing organization secret may
   be used if its token already permits this project and the repository has access
   to it. Keep token values out of code, issues and chat.
5. Run CI on `main` to establish the baseline, then analyze a real pull request.
   Confirm the report contains TypeScript paths for the SDK, web utilities,
   website sources and Toplo, with no unresolved LCOV path warnings. Compare
   coverage with the uploaded report and inspect new-code findings.
6. Check the actual quality gate status in SonarQube Cloud. Scanner upload success
   alone is insufficient. After the first successful PR run, require the
   **SonarQube** check by creating or updating branch protection or a ruleset.
   Retain the Node 20, 22 and 24 checks.

The scanner waits for the quality gate and fails the job if it fails. A missing
token produces an explicit configuration error. The first analysis can establish
a baseline without a computed new-code gate; verify a subsequent analysis too.
A PR that only changes tooling or documentation can have no analyzed new code.
Its gate does not establish the packages' overall baseline. Verify coverage,
findings and the gate in a main-branch analysis after enabling CI analysis.

## Pull requests and credentials

Every pull request runs the Node test matrix. Node 22 also creates and validates
coverage, which CI retains as the `source-coverage` artifact for seven days.

Sonar analysis runs for pushes to `main`, manual runs and same-repository pull
requests in `oboapp/sources`. Dependabot-triggered analysis is skipped for all
event types because GitHub withholds Actions secrets. Fork pull requests also run
tests and coverage without Sonar credentials; the Sonar job is skipped. GitHub
treats a skipped required job as successful, so requiring the `SonarQube` job alone
does not enforce analysis for these PRs. Their merge process needs a trusted
follow-up analysis or an explicit maintainer decision about the missing result.
Do not use `pull_request_target` to run
contributor-controlled install, build or test commands with secrets. A separate
trusted analysis workflow for forks can be added when required.

## Adding or migrating a source

Keep production code in the package's `src/` directory and tests in `test/`.
Run `pnpm check` and `pnpm test:coverage`. Confirm its files appear once in LCOV,
including files without tests. Inspect both the CI result and Sonar findings and
quality gate before release. Release verification remains in [RELEASING.md](RELEASING.md).

References:

- [SonarQube Cloud subscription plans](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans)
- [JavaScript and TypeScript coverage](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)
- [GitHub Actions analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud)
- [Tracking issue #663](https://github.com/oboapp/oboapp/issues/663)
