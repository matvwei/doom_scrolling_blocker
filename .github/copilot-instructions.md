# GitHub Copilot instructions

Read `AGENTS.md` before changing this repository. Use `docs/SPEC.md` for behavioral requirements and `docs/AI_CONTEXT.md` for the current architecture and task map.

Key rules:

- Keep domain logic in `core/`, Chrome APIs in `adapters/`, orchestration in `entrypoints/background.ts`, and React rendering in components/hooks.
- Preserve all limit, storage, redirect-loop, pending-draft, permission, overlay, and privacy invariants listed in `AGENTS.md`.
- Add every new system string to both RU and EN dictionaries in `core/i18n.ts`; test both languages for UI changes.
- Keep `README.md` in English, `README.ru.md` in Russian, and update `docs/SPEC.md` for behavior changes.
- Never edit generated `.output/`, `.e2e-output/`, `.wxt/`, or `node_modules/` files.
- For every logical change, including docs-only changes, add a `CHANGELOG.md` entry and bump SemVer in `package.json` and `package-lock.json` with `npm version <version> --no-git-tag-version`: MAJOR for incompatible changes (document migration), MINOR for backward-compatible functionality, PATCH for fixes/docs/instructions/refactoring without API changes. Each successful push to `main` publishes a GitHub Release only after all checks pass; PRs do not. CI requires valid stable SemVer, a changelog heading for that version, and a tag not already present remotely, and publishes `v<version>` with generated notes. Release job alone has `contents: write`; it uses `GITHUB_TOKEN` and serialized concurrency. A missing version bump will reuse a tag and is rejected. Never manually create a release/tag during local work. Because a push publishes publicly, do not push without explicit approval for that side effect.
- Run the required tests and builds from `AGENTS.md`; CI in `.github/workflows/ci.yml` runs them on pushes to `main` and pull requests; headed E2E runs under Xvfb. Playwright Chromium belongs only to the isolated test runner and must never be bundled with the extension; do not add Docker solely for this workflow. Never claim success with failing checks.
- After each verified logical change, stage only task files, create a meaningful Conventional Commit, push it to `origin main`, and verify a clean worktree. A push to main publishes a public release automatically; obtain explicit approval for that push. Do not manually create tags/releases.

Safe-main roadmap: run local checks, open a PR, wait for every required CI check to pass, obtain required review, merge, then verify post-merge CI and release. The workflow cannot enforce merge restrictions: repository admins must configure an active `main` ruleset requiring PRs and verify status checks, blocking ordinary direct pushes, force-pushes and deletion; disable bypass except a separately approved/documented emergency process. Release remains limited to successful verify on push to `main`; PRs never release. Required checks reduce ordinary failed merges but cannot prevent flakes or post-merge/environment failures; fix via PR or versioned hotfix/revert.
