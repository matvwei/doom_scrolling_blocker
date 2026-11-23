# AI project context

This file is a practical snapshot for AI agents. Mandatory workflow rules are in `AGENTS.md`; normative behavior is in `docs/SPEC.md`.

## Project identity

- Product: Doomscroll Blocker, Manifest V3 for Chrome and Edge.
- Repository: `https://github.com/matvwei/doom_scrolling_blocker.git`.
- Main branch: `main`; remote: `origin`.
- Current application version: **0.6.1**.
- Runtime dependencies: React 18 and React DOM 18.
- Toolchain: WXT 0.21, TypeScript 5.9, Vite through WXT, Vitest 3, React Testing Library, Playwright.
- No backend. Configuration and usage are local; the only external request is the public GitHub latest-release check from the popup.
- Interface languages: Russian (`ru`, default/migration) and English (`en`).

## Runtime model

1. `entrypoints/background.ts` loads and normalizes `dsb:config`, rehydrates `dsb:state`, queries open tabs/windows, and restores custom content-script registrations.
2. `core/matching.ts` classifies a tab URL as a custom target first, then a built-in target. The selected target has independent configuration and counters.
3. Active tab/window/document state arrives from tab events and content-script heartbeats. `core/limits.ts` advances session/daily counters and determines `blockedReason`.
4. Background enforces the configured action on every tracked tab while blocked: warning overlay, redirect, or close. Runtime redirect-loop protection falls back to warning.
5. Warning payload includes localized target/reason labels and `language`. `entrypoints/content.ts` renders a Shadow DOM overlay, plays a short sound once, and restores the overlay after DOM tampering.
6. Popup and options read configuration/state through `hooks/useExtensionData.ts`. Settings use the same `components/SettingsApp.tsx` in full and compact modes.
7. `hooks/useUpdates.ts` requests the browser's native update check and fetches the latest GitHub release. A newer GitHub version produces a manual release link when native installation is unavailable.

## Storage contracts

- `dsb:config`: `ExtensionConfig` version 2, including `language`, `youtubeScope`, three built-in services, and `customSites`.
- `dsb:state`: `Record<targetId, ServiceState>`; target IDs are `youtube`, `instagram`, `tiktok`, or generated custom-site IDs.
- `dsb:pendingConfig`: interrupted settings draft. It is freshness-sensitive and must never overwrite a newer config.

`adapters/storage.ts` serializes writes/removals through a shared queue. `normalizeConfig` supplies localized defaults and clamps damaged values. Pending drafts are deliberately **not** repaired with defaults: invalid drafts are discarded.

## Module map

| Path | Responsibility |
|---|---|
| `core/i18n.ts` | RU/EN dictionaries, `Language`, `MessageKey`, interpolation |
| `core/config.ts` | Config types, defaults, validation, normalization/migrations |
| `core/matching.ts` | URL classification and custom-before-built-in priority |
| `core/customSites.ts` | Custom URL parser/normalizer and Chrome match patterns |
| `core/limits.ts` | Pure counter state machine, rehydration, remaining time, reason labels |
| `core/services.ts` | Built-in registry and localized YouTube scope label |
| `core/messages.ts` | Content/background message contracts, overlay language |
| `core/warningSound.ts` | Short Web Audio warning with safe cleanup |
| `core/updates.ts` | GitHub API, version comparison, release URL |
| `adapters/storage.ts` | Serialized local storage, config/state/draft operations |
| `adapters/pendingResume.ts` | Strict pending-draft validation and safe resume |
| `adapters/permissions.ts` | Optional host permission requests/checks/cleanup |
| `adapters/scripting.ts` | Dynamic custom content scripts and already-open tabs |
| `adapters/updates.ts` | Manifest version and `runtime.requestUpdateCheck()` |
| `components/SettingsApp.tsx` | Shared settings, validation, permissions, language switching |
| `components/LanguageSwitcher.tsx` | Shared RU/EN selector |
| `hooks/useExtensionData.ts` | Reactive config/state and config save |
| `hooks/useUpdates.ts` | Combined browser/GitHub update state |
| `entrypoints/background.ts` | Tabs, focus, ticking, enforcement, reconciliation, updates |
| `entrypoints/content.ts` | Heartbeat, SPA signals, overlay, sound, tamper recovery |
| `entrypoints/popup/App.tsx` | Dashboard, version/update UI, language selector, settings view |
| `entrypoints/options/App.tsx` | Full settings fallback |
| `wxt.config.ts` | Manifest permissions, hosts, E2E-only origin/output |
| `tests/fakeChrome.ts` | In-memory Chrome/storage/fetch test double |
| `e2e/e2e.mjs` | Real-browser integration and regression scenarios |
| `e2e/geometry.mjs` | Real-layout containment/overflow assertions |

## High-risk invariants

- Zero minutes blocks immediately; it never disables a limit.
- Session/day counters survive restarts and do not accelerate with multiple tabs.
- Full page loading resets per-tab delivery/action flags; SPA navigation does not destroy the document.
- Custom rules shadow built-ins, use strict scheme/path boundaries, and reject nonstandard ports/credentials.
- No redirect may target any currently tracked URL.
- Disabled targets unblock immediately but retain counters.
- Overlay updates are idempotent; normal `show`/`hide` is not tampering.
- No mandatory `<all_urls>`; denied custom-site permission prevents saving.
- New config saves invalidate stale pending drafts.
- All system UI strings exist in both locales; user messages/site names remain user-authored.
- GitHub release links are manual for unpacked installations; do not claim ZIP auto-installation.

## Test snapshot

At version 0.6.0 the verified baseline is:

- **181 unit/component tests** across 12 test files.
- **126 E2E assertions** across 25 scenarios.
- TypeScript, Chrome production build, and Edge production build.
- `.github/workflows/ci.yml` runs `npm ci`, installs Playwright Chromium with Linux dependencies on the ephemeral GitHub Actions runner, then runs headed browser E2E via Xvfb alongside unit tests, type-check, Chrome/Edge builds, and E2E. Chromium is test-only and never enters extension output; this repository has no Docker build/test configuration.

Update these numbers only after a successful run. E2E uses a temporary browser profile and local/mocked network responses. It covers blocking, multi-tab behavior, reload, SPA transitions, redirect/close, custom-site registration, pending drafts, UI geometry, updates, language switching, and the English overlay.

## Change playbook

### Config field

Update `ExtensionConfig`, defaults, normalization/migration, form conversion and validation, pending-draft compatibility, localized errors, tests, SPEC, and both READMEs when user-visible.

### UI text or control

Update both dictionaries, popup/options compact and full modes as applicable, accessible labels, unit tests, and real-browser geometry in RU and EN.

### Blocking behavior

Cover zero/nonzero limits, multi-tab, full reload, SPA enter/leave, disabling/re-enabling, storage persistence, and redirect-loop protection. Use pure unit tests for the state machine and E2E for browser orchestration.

### Permissions/custom site

Cover grant/denial, already-open tabs, registration reconciliation after restart/edit, removal, usage pruning, and optional-origin cleanup. Never bypass the native permission path silently.

### Release/version

Use SemVer and add a `CHANGELOG.md` entry for every logical change, including documentation-only changes: MAJOR for incompatible behavior/API/configuration/storage (document migration), MINOR for backward-compatible functionality including CI automation, PATCH for fixes/docs/instructions/refactoring without API change. Keep package files and changelog aligned; use `npm version <version> --no-git-tag-version`. Update fake manifest versions and use a newer mock GitHub release when testing update availability. The popup checks the browser update service independently from GitHub Releases; if no GitHub latest release is published (for example, API 404), it quietly shows no GitHub version/link and core functionality remains available. A successful push to `main` publishes a GitHub Release after verify succeeds, tagged `v<version>` with generated notes; pull requests never publish. The workflow requires stable SemVer, a matching changelog heading, and an unused remote tag. It grants `contents: write` only to the release job and serializes release runs. A push without a version bump is rejected because the tag is already used. Build to verify the manifest. Commit and push are mandatory per `AGENTS.md`; a push that triggers publication requires explicit approval; never create the tag/release manually.

## Safe-main roadmap

Local checks → PR → all required verify checks pass → review/approval → merge → verify post-merge checks and expected release. GitHub Actions runs on PRs but cannot itself enforce branch protection. Repository admins must activate and verify a `main` ruleset/branch protection requiring PRs and all verify checks, blocking routine direct pushes, force-push and deletion, with bypass disabled except an explicitly approved and documented emergency process. The release job remains gated to successful verification on push to `main`; PRs never publish. Flaky, environment, or post-merge failures remain possible: investigate and fix through PR, or use a reviewed revert/hotfix with a new version and changelog when appropriate.

## Documentation map

- `AGENTS.md`: mandatory instructions, invariants, verification, versioning, commit/push policy.
- `.github/copilot-instructions.md`: short Copilot-specific entry point.
- `.github/workflows/ci.yml`: automated test/build pipeline; `.github/AGENTS.md` owns workflow rules.
- `docs/SPEC.md`: detailed behavioral specification in Russian.
- `docs/AI_CONTEXT.md`: this practical architecture/task snapshot.
- `README.md`: primary user documentation in English.
- `README.ru.md`: Russian user documentation.

When architecture, workflow, storage, permissions, or public behavior changes, update every affected document rather than leaving contradictory sources of truth.
