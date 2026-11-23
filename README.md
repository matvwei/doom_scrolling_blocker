# Doomscroll Blocker

**English** | [Русский](README.ru.md)

A Manifest V3 browser extension for Chrome and Edge that helps prevent doomscrolling with time limits for YouTube, Instagram Reels, TikTok, and custom sites. When a limit is reached, it shows a blocking screen, redirects the tab, or closes it.

There is no custom backend: configuration and statistics are stored in `chrome.storage.local`. Opening the popup makes a request to the public GitHub API to check the latest release; no user data is sent.

## Features

- **Russian and English interface** — switch languages in the popup or settings. The choice is saved and also applies to the blocking screen, validation errors, and confirmation prompts.
- **YouTube** — choose between “Shorts only” (`/shorts`, backward-compatible behavior) and “Entire YouTube” (home, `/watch`, and all pages). Changes apply immediately without reinstalling.
- **Instagram Reels** — the `/` feed, `/reels/*`, and `/reel/*`; profiles, posts, and messages are unaffected.
- **TikTok** — the entire site.
- **Custom sites** — add rules through the settings UI without JSON: `https://example.com` blocks the domain and its subdomains, while `https://example.com/section` blocks one section. Each site has independent counters and settings.
- **Version and updates** — the popup shows the current manifest version, requests a browser update through `chrome.runtime.requestUpdateCheck()`, and compares the version with the latest published GitHub Release. If no GitHub Release exists yet (the latest-release API returns 404), the GitHub check is simply unavailable; this does not affect the browser's independent update check or other features. If the browser cannot install an available update automatically, an **Update extension** button links to the published release. Each push to `main` publishes a GitHub Release automatically only after the complete CI suite passes. The release is tagged `v<package.json version>` and uses GitHub-generated release notes; pull requests never publish. CI requires a stable SemVer version, a matching `CHANGELOG.md` heading, and a tag not already present remotely; a missing bump therefore fails rather than reusing a tag. The release job alone has `contents: write` via `GITHUB_TOKEN`. Each meaningful change needs a version bump and changelog entry. A push is now a public release action, so obtain explicit approval before pushing. GitHub Releases provide separate versioned Chrome and Edge ZIP archives containing only the built extension files. A ZIP is not directly installable as an unpacked extension: extract it, then use **Load unpacked** and select the extracted `chrome-mv3` or `edge-mv3` directory containing `manifest.json`. One-click installation requires publishing through the Chrome Web Store or Microsoft Edge Add-ons; these release ZIPs are for manual/developer-mode installation and are not represented as store-ready submission packages.
- **Immediate limits** — 0 minutes means “block immediately”: the action runs when a tracked page first opens.
- Only active time is counted: the tab is active, its window is focused, and the document is visible.
- Two independent limits per target: session (reset after 10 minutes of inactivity) and day (reset at local midnight).
- Actions: `warning` (a blocking overlay with your message and a short sound), `redirect`, and `close`. The sound plays once per new overlay, not on repeated updates.
- While the limit is exhausted, every target tab is blocked, including new tabs and SPA navigation. After a full page reload, the overlay appears again. It is hidden when leaving tracked pages, raising a limit, disabling a target, or deleting a site; counters are preserved.
- Removing or modifying the overlay through the DOM is detected: it is restored and asks for confirmation without lifting the restriction.
- `redirectUrl` cannot point to a tracked area, preventing infinite redirect loops.
- SPA navigation is handled correctly.

## Privacy and permissions

Permanent site access is limited to YouTube, Instagram, and TikTok. Separate access to `https://api.github.com/` is used only to retrieve the latest version number; the request contains no configuration, statistics, or other user data.

Custom sites use **optional permissions**: domain access is requested through a native browser prompt when settings are saved and revoked when the site is removed. If access is denied, the site is not added and an error is shown. Broad `<all_urls>` access is never requested.

See [docs/SPEC.md](docs/SPEC.md) for the detailed specification (currently in Russian).

For AI agents and contributors: [AGENTS.md](AGENTS.md) contains mandatory workflow and architectural rules, [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md) provides the module map and task playbook, and [.github/copilot-instructions.md](.github/copilot-instructions.md) configures GitHub Copilot.

## Requirements

- Node.js ≥ 22 and npm
- Playwright Chromium for local E2E (`npx playwright install chromium`); CI installs it automatically

## Install dependencies

```bash
npm ci
```

For local browser E2E, install the test browser separately; on Linux use `xvfb-run -a npm run test:e2e` for its headed browser:

```bash
npx playwright install chromium
# Linux only, if required: npx playwright install --with-deps chromium
```

The browser and Linux libraries are test-environment assets; they are not included in extension output or archives.

## Development

```bash
npm run dev          # WXT dev server with automatic rebuilds
```

## Build

```bash
npm run build        # Chrome MV3 -> .output/chrome-mv3
npm run build:edge   # Edge MV3   -> .output/edge-mv3
npm run zip          # Optional WXT archives -> .output/*-mv3.zip
```

## Manual installation

Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Download the Chrome ZIP from the GitHub Release and extract it.
4. Click **Load unpacked** and select the extracted `chrome-mv3` folder (the folder containing `manifest.json`).

Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Download the Edge ZIP from the GitHub Release and extract it.
4. Click **Load unpacked** and select the extracted `edge-mv3` folder (the folder containing `manifest.json`).

After installation, configure services directly from the popup. **Settings** switches the popup to its built-in settings view without opening another tab. It includes limits, actions, redirect URLs, messages, YouTube scope, interface language, and custom sites. The full `options.html` page remains available as a fallback through **Extensions → Doomscroll Blocker → Details → Extension options**.

## Contributing and safe releases

The normal path to `main` is: run local checks → open a pull request → wait for all required CI checks → obtain required review → merge → verify post-merge CI and the expected release. CI runs on pull requests, but workflow YAML does not enforce branch protection. Repository administrators must configure and verify an active `main` ruleset requiring PRs and all verify checks, blocking routine direct pushes, force-push and branch deletion, and disabling bypass except for an explicitly approved, documented emergency process. Releases are published only after successful verification on a push to `main`; pull requests never publish. Required checks cannot prevent flaky or post-merge/environment failures; investigate and fix through a PR, or use a reviewed revert/versioned hotfix as appropriate.

## Tests

```bash
npm test             # Unit tests: Vitest + React Testing Library (181 tests)
npm run compile      # Type checking without emitting files (tsc --noEmit)
npm run build        # Production build must pass
npm run build:edge   # Edge build
xvfb-run -a npm run test:e2e  # Real-browser E2E (Playwright; E2E build runs automatically)
```

E2E loads the built extension into Chrome/Edge with a temporary profile, serves local HTML for YouTube and the test domain, and replaces the GitHub Releases API response with a test release. No internet connection is required after dependencies and Chromium are installed. GitHub Actions runs the full test/build suite on pushes to `main` and pull requests, then publishes a release only for successful `main` pushes; it installs Chromium with `npx playwright install --with-deps chromium` on its ephemeral runner. Playwright browser files never enter the extension build or ZIP. This project uses GitHub-hosted runners rather than a Docker test image; no Docker build/test configuration is needed.

UI geometry is checked in a real browser (`e2e/geometry.mjs`): every visible interactive element and text range in settings and the popup must remain within its container and the window content box, without negative coordinates or horizontal overflow. jsdom has no layout engine, so these checks are not part of the unit tests.

## Project structure

```
core/            Pure domain logic: i18n, URL matching, custom sites, limits, config, time
adapters/        chrome.storage.local, optional permissions, dynamic scripts, updates
components/      Shared React settings and language switcher
entrypoints/     Background service worker, Shadow DOM content overlay,
                 popup (dashboard + settings), and options (React + TypeScript)
hooks/           React hooks for extension data and updates
tests/           Unit and component tests
e2e/             Browser E2E tests (Playwright)
docs/SPEC.md     Detailed specification
```

## Limitations

- One tick accounts for at most 60 seconds of active time, so a long device sleep may leave up to a minute uncounted in the user's favor.
- If the browser aggressively suspends the service worker, alarms and content-script heartbeats preserve accounting, but blocking may be delayed by a few seconds. A zero limit still acts during tab classification without waiting for a tick.
- Limits are whole minutes: 0–720 for sessions and 0–1440 for days.
- Custom-site addresses must use standard ports (80/443): arbitrary ports cannot be expressed in Chrome match patterns.
- Native optional-permission prompts cannot be clicked by automation. E2E covers pre-granted access; request and denial paths are covered by adapter and component tests.
- A native permission prompt closes the popup. Configuration is first saved as a draft (`dsb:pendingConfig`) and is completed automatically after access is granted or restored when settings reopen. Newer configuration saves invalidate stale drafts, and corrupted drafts are discarded without overwriting current data.
