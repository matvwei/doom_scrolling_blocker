# Changelog

This file records user-visible changes for each application version. Entries are
added under the version being prepared, before its version bump is committed.

## Versioning and release workflow

- Follow Semantic Versioning (`MAJOR.MINOR.PATCH`) for stable releases.
- **MAJOR**: incompatible behavior, configuration, storage, or public interface;
  document the breaking change and migration instructions before release.
- **MINOR**: backward-compatible user-facing functionality.
- **PATCH**: backward-compatible fixes, documentation, instructions, and
  refactoring without a public interface change.
- Every logical change, including documentation-only changes, requires a version
  bump and a changelog entry describing the change. Keep package files in sync
  with `npm version <version> --no-git-tag-version`.
- Use a Conventional Commit and push the verified commit to `origin main`. Each
  successful push to `main` publishes a GitHub Release after CI passes, tagged
  `v<package.json version>` with generated release notes. A version bump and
  matching changelog entry are mandatory for each meaningful change; CI rejects
  invalid versions, missing changelog headings, or an already-used tag. PRs do
  not publish releases. The release job needs the repository `GITHUB_TOKEN`
  permission `contents: write`; never manually create tags/releases for a routine
  change.

## [0.6.0]

- Publish a GitHub Release automatically after all checks pass for each push to `main`, using the bumped package version as a unique `vX.Y.Z` tag and GitHub-generated release notes. Reject missing changelog entries and reused tags; pull requests never publish.

## [0.4.2]

- Clarify SemVer and mandatory changelog workflow; document that commit/push do not publish a GitHub Release.
- Document graceful handling when no GitHub latest release is published and cover the API 404 case in popup tests.

## [0.4.1]

- Baseline current application version when this changelog was introduced.

## [0.5.0]

- Add GitHub Actions CI for pushes to `main` and pull requests: install locked npm dependencies and Playwright Chromium on the ephemeral runner, then run unit tests, type-checking, Chrome/Edge builds, and browser E2E.
- Keep Playwright browser binaries and system libraries confined to CI/test environments; they are not extension dependencies or packaged extension assets. No Docker configuration was added because the repository has no Docker build/test setup and GitHub-hosted runners provide the required isolated environment.
