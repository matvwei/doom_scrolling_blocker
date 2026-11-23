# AGENTS.md — GitHub automation

## Purpose

Own GitHub Actions workflows and repository automation under `.github/`.

## Ownership

- `.github/workflows/ci.yml` verifies the extension on pushes to `main` and pull requests targeting `main`; after successful verification only, a push to `main` publishes a GitHub Release.
- `.github/copilot-instructions.md` provides concise contributor guidance; repository-wide requirements remain in the root `AGENTS.md`.

## Local Contracts

- CI uses Node.js 22 and the committed npm lockfile (`npm ci`).
- CI installs Playwright Chromium and its system dependencies on the ephemeral runner, then runs unit tests, type-checking, Chrome/Edge builds, and browser E2E.
- Playwright browser binaries are test-environment assets only. Never add them to extension dependencies, `.output/`, publication archives, or browser-installable extension output.
- Keep workflow permissions minimal and workflow triggers aligned with `main`. The verify job is read-only; release alone gets `contents: write`.
- Release uses `v<package.json version>`, requires a stable SemVer and matching CHANGELOG heading, rejects a remotely existing tag, and generates notes with GitHub release-note generation. Release concurrency is serialized; PRs never publish.
- A version bump and changelog entry are required for each meaningful change. A push without a new unused version fails safely rather than reusing a tag.

## Work Guidance

- Release automation is explicitly approved: publish only after verify succeeds and only for pushes to `main`. Never manually create a tag/release as part of ordinary local implementation or verification.
- Update root `AGENTS.md`, `CHANGELOG.md`, and relevant project documentation whenever CI policy changes.
- Do not modify generated build output or `.a0proj/`.

## Verification

- Run the exact test/build commands represented by the workflow locally when feasible. Inspect release gating, tag uniqueness, token permissions, and confirm pull requests cannot reach publishing.
- Check workflow diff and `git diff --check`; verify browser binaries remain outside the repository and extension output.

## Child DOX Index

No child instruction files.

## Safe path to main

- Intended roadmap: local checks → PR → all required checks green → review → merge → verify post-merge checks and release.
- CI runs on PRs and pushes, but workflow YAML cannot enforce merge policy. Repository administrators must configure and verify an active `main` ruleset/branch protection: require PRs and all verify checks, prohibit ordinary direct pushes, force-push and deletion, and disable admin/bot bypass except a separately approved, documented emergency process. Select check names as shown by GitHub after a successful run.
- The release job must remain gated by successful `verify`, a push event and `refs/heads/main`; PRs never release. A red post-merge run may still result from flakes, environment changes, or post-merge regressions; investigate and fix through PR, or use a versioned hotfix/revert PR when needed.
