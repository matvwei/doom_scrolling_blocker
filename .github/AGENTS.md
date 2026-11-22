# AGENTS.md — GitHub automation

## Purpose

Own GitHub Actions workflows and repository automation under `.github/`.

## Ownership

- `.github/workflows/ci.yml` verifies the extension on pushes to `main` and pull requests targeting `main`.
- `.github/copilot-instructions.md` provides concise contributor guidance; repository-wide requirements remain in the root `AGENTS.md`.

## Local Contracts

- CI uses Node.js 22 and the committed npm lockfile (`npm ci`).
- CI installs Playwright Chromium and its system dependencies on the ephemeral runner, then runs unit tests, type-checking, Chrome/Edge builds, and browser E2E.
- Playwright browser binaries are test-environment assets only. Never add them to extension dependencies, `.output/`, publication archives, or browser-installable extension output.
- Keep workflow permissions minimal and workflow triggers aligned with `main`.

## Work Guidance

- Keep the workflow focused on validation; do not add release, tag, publishing, or deployment steps without explicit user approval.
- Update root `AGENTS.md`, `CHANGELOG.md`, and relevant project documentation whenever CI policy changes.
- Do not modify generated build output or `.a0proj/`.

## Verification

- Run the exact test/build commands represented by the workflow locally when feasible.
- Check workflow diff and `git diff --check`; verify browser binaries remain outside the repository and extension output.

## Child DOX Index

No child instruction files.
