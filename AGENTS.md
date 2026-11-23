# BrowserDeck — Project Instructions

## Mission
Build BrowserDeck, a minimal desktop workspace for multiple independent, interactive browser sessions. macOS is the first target; keep the architecture portable to Windows and Linux.

The product requirements and acceptance criteria live in `SPEC.md`. Read the relevant sections before implementing a feature. Do not create a second, conflicting specification.

## How to work
1. Inspect the repository, `git status`, existing files, available scripts, and the relevant parts of `SPEC.md` before changing anything.
2. Work autonomously in small, complete vertical slices. State a brief plan, then implement, test, and document the slice. Do not stop after planning or scaffolding.
3. Preserve existing work. Never discard user changes or use destructive Git commands to get a clean working tree.
4. Make ordinary engineering decisions independently. Ask only for product-defining decisions, credentials, destructive actions, or genuinely blocked choices.
5. Do not commit, push, publish releases, change repository visibility, or modify GitHub settings unless the user explicitly asks.
6. Never claim a feature or check works unless it was actually verified. Report failed, skipped, and unavailable checks accurately.
7. Avoid speculative features, unnecessary abstractions, needless dependencies, and premature optimization.
8. Keep documentation aligned with the implementation. Update `docs/ROADMAP.md`, `.factory/STATE.md`, and `docs/PHASE_REPORTS.md` with exact results after each slice.

## Work tracking
- At session start, read `.factory/STATE.md` and `docs/ROADMAP.md` alongside `AGENTS.md` and the relevant `SPEC.md` sections.
- Work one roadmap task at a time. Pick the single `NEXT` task, or the first `READY` task by priority. `BLOCKED`, `IDEA`, and `DONE` tasks are not eligible without explicit promotion.
- Keep `docs/ROADMAP.md` as the live queue, `.factory/STATE.md` as the one-screen session state, and `docs/PHASE_REPORTS.md` as the detailed evidence log. Do not create a second backlog or a second work log.
- After each slice, update the roadmap status/evidence and the state file with the actual result. Mark `DONE` only when acceptance criteria and required checks passed.
- Run `make agent-check` after changing commands, skills, the roadmap, or the state file.

## Product and UI direction
- Minimal, clean, calm, and developer-focused. BrowserDeck is a tool, not a marketing website.
- The websites inside panes are the primary content. Application chrome should be compact and quiet.
- Prefer system typography, restrained neutral surfaces, subtle separators, consistent spacing, and one restrained accent color.
- Avoid gratuitous cards, gradients, glass effects, shadows, oversized headings, decorative illustrations, excessive badges, and unnecessary sidebars.
- Keep important actions discoverable; place infrequent actions in contextual menus.
- Support system appearance plus light/dark themes, keyboard navigation, visible focus, readable contrast, and reduced-motion preferences.
- Provide useful empty, loading, error, disabled, and recovery states.
- Never add a visible control that does nothing. Either implement it or clearly mark it unavailable for the current phase.
- Load `.opencode/skills/browserdeck-design-system/SKILL.md` before meaningful renderer, component, or CSS work.
- Load `.opencode/skills/browserdeck-ux-design/SKILL.md` before changing user flows, navigation, pane interactions, workspace behavior, menus, dialogs, keyboard shortcuts, or accessibility.
- For meaningful UI work, use both skills: the design-system skill governs visual consistency; the UX skill governs interaction design and usability.
- Load `.opencode/skills/electron-native-views/SKILL.md` before changing native browser-view composition, bounds, z-order, hit-testing, or related interactions.
- Load `.opencode/skills/electron-security/SKILL.md` before changing IPC, preload, navigation, permissions, or packaging.

## Architecture and security guardrails
- Follow the stack and requirements in `SPEC.md`. Do not substitute deprecated Electron APIs.
- Use `BaseWindow` and `WebContentsView` for remote browser panes. Do not use iframes, `<webview>`, or deprecated `BrowserView` as the pane renderer.
- Complete the Phase 0 native-view composition spike before building the full workspace UI. Do not assume DOM overlays, transparency, or click-through behavior works without a running test.
- Keep layout algorithms, validation, URL normalization, and shared types in pure TypeScript modules where practical. They must not import Vue or Electron.
- Keep privileged Electron APIs in the main/preload layers. Expose only a minimal, typed bridge to the trusted local shell.
- Treat every remote website as hostile. Never expose Node APIs, the application bridge, filesystem access, environment variables, or privileged IPC to remote pages.
- Every browser profile must use an internally generated ID and its own persistent Electron partition by default. Sharing a profile must be an explicit user action.
- Validate IPC sender identity and all payloads in the main process. Renderer validation is not a security boundary.
- Do not store cookies, credentials, access tokens, session data, or other secrets in workspace files, exports, logs, fixtures, screenshots, or Git.
- Closing a pane must destroy its active native view and owned `webContents`, remove listeners, and leave no orphaned views.
- Load `.opencode/skills/electron-native-views/SKILL.md` before changing native views, bounds, z-order, emulation, sessions, or popups.
- Load `.opencode/skills/electron-security/SKILL.md` before changing IPC, preload, navigation, permissions, session data, filesystem access, or packaging.

## Verification
- Add or update tests with behavior changes.
- Run the narrowest relevant tests first, then the available typecheck, lint, unit tests, integration/e2e tests, and build.
- Use scripts that actually exist in `package.json`; do not pretend unavailable scripts passed.
- Before a phase is complete, verify its exit criteria in `SPEC.md` and record exact commands/results in `docs/PHASE_REPORTS.md`.
- Run `make check` for the standard local gate; it includes typecheck, lint, unit tests, design-token contrast, and `make agent-check`.
- Use the `/review` command and the relevant security/UX skills when their review scopes apply. Fix confirmed issues before calling the phase complete.

## Public repository hygiene
- Never commit `.env` files, credentials, personal browser data, generated profile stores, local databases, or machine-specific paths.
- Keep `.gitignore`, lockfiles, CI, and setup instructions accurate.
- Do not choose or change an open-source license without the repository owner's instruction. Do not add a license file automatically.
- Review diffs for secrets, generated artifacts, and unrelated edits before proposing a commit.
