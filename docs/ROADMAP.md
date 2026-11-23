# BrowserDeck Roadmap

Live work queue for BrowserDeck. `SPEC.md` remains the product and engineering
source of truth; `docs/DECISIONS.md` holds accepted ADRs; `docs/PHASE_REPORTS.md`
is the detailed evidence log. This file records only what is next, ready,
blocked, or worth keeping as an idea.

- Last reviewed: 2026-11-23
- Selection rule: `/next` takes the single `NEXT` task. If none is marked, it
  takes the first `READY` task by priority. `BLOCKED` and `IDEA` tasks are not
  eligible until `/plan` promotes them.
- One task per session. Keep IDs stable; never renumber or reuse one.
- A task is `DONE` only when its acceptance criteria and required verification
  passed. Add an `Evidence` line with the phase-report section or command result.

## Statuses

- `NEXT` — the one task chosen for the next slice.
- `READY` — scoped and unblocked; eligible for `/next`.
- `BLOCKED` — needs an owner decision, credential, external service, or manual event.
- `IDEA` — useful but unscheduled; promote to `READY` before implementing.
- `DONE` — verified; keep with an evidence line.

## Task fields

Every task uses `Status`, `Priority`, `Depends`, `Source`, `Scope`, `Done when`,
and `Verify`. `BLOCKED` tasks also state the blocker; `DONE` tasks state the
evidence. Keep each scope to one vertical slice. If a task needs publishing,
signing, credentials, or a destructive action, make the gate explicit.

## Next

_None assigned. BD-003 is READY but requires a human multi-hour profiling run._

## Ready

### BD-003 — Run multi-hour CPU and memory profiling with loaded pages
- Status: READY
- Priority: P2
- Depends: none
- Source: `README.md` known limitations; `docs/PHASE_REPORTS.md` Phase 4 follow-ups.
- Scope: Run a multi-hour soak with loaded third-party pages; sample CPU and memory per process; profile drag, resize, zoom, pan, and scrolling; record leaks or regressions.
- Done when: a repeatable profiling procedure and dated results exist, and confirmed leaks have a follow-up task.
- Verify: documented profiling commands in `docs/MANUAL_CHECKS.md`; repeatable run with recorded process counts and working set.

## Blocked

### BD-001 — Publish the next BrowserDeck release and refresh the Homebrew cask
- Status: BLOCKED
- Priority: P1
- Depends: none
- Blocker: explicit owner approval to tag, publish, and update the public cask.
- Source: `README.md` "Install with Homebrew" and "Packaging"; `docs/PHASE_REPORTS.md` 1.1.0 release entry.
- Scope: Confirm the release commit and version, build the arm64 DMG/ZIP, publish the GitHub release with `SHA256SUMS.txt`, and update `kanharithsok/tap/browser-deck` to the new version and checksum.
- Done when: the release assets and checksums exist, `brew fetch` verifies the cask, and a clean `brew install --cask` installs the new version.
- Verify: `npm run package:mac`; `shasum -a 256`; `brew fetch`; `brew install --cask`; launch smoke.

### BD-002 — Complete the manual VoiceOver and focus-ring pass
- Status: BLOCKED
- Priority: P1
- Depends: none
- Blocker: owner deprioritized the manual VoiceOver pass; no VoiceOver feature is planned, and spoken-order/announcement review remains unverified.
- Source: `README.md` known limitations; `docs/MANUAL_CHECKS.md`; `SPEC.md` §18.4.
- Scope: Walk the toolbar, pane headers, selection state, status announcements, custom menus, Add dialog, Workspaces dialog, and bottom canvas bar with VoiceOver and keyboard only; fix confirmed defects.
- Done when: the manual checklist has dated results, confirmed focus/order/announcement defects are fixed, and automated axe coverage still passes.
- Verify: manual macOS VoiceOver pass; `make check`; `npm run test:e2e`.

### BD-009 — Add Developer ID signing, notarization, and stapling
- Status: BLOCKED
- Priority: P1
- Depends: BD-001; paid Apple Developer account and signing credentials.
- Blocker: no paid Apple Developer account or signing credentials.
- Source: `README.md` known limitations; `SECURITY.md`; `docs/PHASE_REPORTS.md` Phase 4 follow-ups.
- Scope: Add Developer ID signing, hardened runtime, notarization, and stapling to the macOS packaging flow; verify Gatekeeper on a clean machine.
- Done when: a signed and notarized artifact passes Gatekeeper, stapling validates, and release docs describe the credentials.
- Verify: `npm run package:mac`; `codesign --verify --deep --strict`; `spctl --assess`; `stapler validate`.

### BD-010 — Package and release for Windows and Linux
- Status: BLOCKED
- Priority: P3
- Depends: a product decision to support non-macOS targets.
- Blocker: `SPEC.md` §19 defers non-macOS packaging; no target decision or CI runner exists.
- Source: `SPEC.md` §15.3 and §19; `docs/PHASE_REPORTS.md` Phase 4 follow-ups.
- Scope: Audit main-process assumptions, add packaging targets and CI, and document platform-specific limitations.
- Done when: a target decision exists, a build runs on each supported platform, and packaging docs and CI are updated.
- Verify: CI matrix; package smoke on each target.

## Ideas

### BD-011 — URL templates across selected panes
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Replace the hostname while keeping a shared path and query pattern across selected panes.
- Done when: promoted to `READY` with acceptance criteria and a test plan.

### BD-012 — Synchronized navigation across selected panes
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Navigate selected panes together while preserving per-pane isolation and failure handling.
- Done when: promoted to `READY` with interaction and test criteria.

### BD-013 — Synchronized scrolling across selected panes
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Scroll selected panes together where the remote page allows it, without breaking native input.
- Done when: promoted to `READY` with interaction and test criteria.

### BD-014 — Capture one pane or the whole workspace
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Add screenshot capture for a selected pane or the complete Canvas, using the existing native view bounds.
- Done when: promoted to `READY` with format, privacy, and verification criteria.

### BD-015 — Aggregated console and network inspection
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Inspect console and network activity across pane sessions without exposing it to remote content.
- Done when: promoted to `READY` with a threat model and performance budget.

### BD-016 — Reusable profile templates
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `SPEC.md` §5.2.
- Scope: Create reusable profile templates while keeping every browser's default isolation explicit.
- Done when: promoted to `READY` with sharing, naming, and migration criteria.

### BD-017 — Device bezel and frame-resize controls
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `README.md` known limitations.
- Scope: Add optional device-bezel presentation or frame-resize controls without changing the declared viewport size.
- Done when: promoted to `READY` with interaction and accessibility criteria.

### BD-018 — Encrypt cookies at rest
- Status: IDEA
- Priority: P3
- Depends: none
- Source: `README.md` known limitations; `SECURITY.md`.
- Scope: Evaluate Electron `safeStorage`-backed cookie encryption and key management for per-pane sessions.
- Done when: promoted to `READY` with a threat model, platform behavior, and migration plan.

## Done

Completed tasks stay here with the completion date and evidence. Move the whole
task block; do not renumber it.

### BD-004 — Distinguish HTTP from HTTPS in the pane address bar
- Status: DONE
- Priority: P1
- Depends: none
- Source: `README.md` known limitations; `SPEC.md` §13.3.
- Scope: Add a compact, accessible security state to the trusted pane header for `http:` URLs. Do not change navigation policy, URL normalization, or native page content.
- Done when: HTTP panes show a persistent warning indicator with an accessible label or tooltip; HTTPS panes show the normal state; light/dark and narrow pane widths remain readable; tests cover the state mapping.
- Verify: `make check`; targeted Playwright e2e for HTTP and HTTPS panes; manual light/dark check at the minimum pane width.
- Evidence: 2026-11-23 — `make check` passed with 187 unit tests; `npm run test:e2e` passed 4 Playwright tests in 22.3 s; 320 px light/dark screenshots were inspected. See "Post-MVP — Insecure HTTP pane indicator" in `docs/PHASE_REPORTS.md`.

### BD-005 — Show a notice when a website closes its own pane
- Status: DONE
- Priority: P2
- Depends: none
- Source: `README.md` known limitations.
- Scope: Surface a non-blocking shell notice when a remote page closes its `WebContentsView`; preserve safe teardown and do not resurrect the view.
- Done when: the pane is removed safely, a visible notice explains what happened, and no orphaned view, `webContents`, or listener remains; tests cover normal close versus self-close.
- Verify: `make check`; targeted unit or e2e test; `npm run test:e2e`.
- Evidence: 2026-11-23 — `make check` passed with 187 unit tests; `npm run test:e2e` passed 4 Playwright tests in 22.5 s; the targeted self-close run passed. See "Post-MVP — Self-closed pane notice" in `docs/PHASE_REPORTS.md`.

### BD-006 — Keep the pane header usable at the minimum window width
- Status: DONE
- Priority: P2
- Depends: none
- Source: `README.md` known limitations; `docs/MANUAL_CHECKS.md`.
- Scope: Adjust the two-row pane header, address field, and viewport controls so they remain usable at the minimum supported window and pane widths without clipped or overlapping controls.
- Done when: minimum-width checks show no overlap or clipping; focus order remains address, Add, viewport, reload, open, actions, close; light/dark and 320 px pane widths pass.
- Verify: `make check`; targeted Playwright at minimum window and pane sizes; manual light/dark check.
- Evidence: 2026-11-23 — 720 × 520 window / 320 px pane e2e passed with no header or editor overflow, preserved focus order, and light/dark checks; `make check` passed 187 unit tests; `npm run test:e2e` passed 5 tests in 23.0 s. See "Post-MVP — Minimum-width pane header" in `docs/PHASE_REPORTS.md`.

### BD-007 — Resolve or explicitly accept the developer-toolchain audit advisories
- Status: DONE
- Priority: P2
- Depends: none
- Source: `README.md` known limitations; `npm audit` output.
- Scope: Re-check the moderate `minimatch` advisories in the `electron-builder` and `@electron/universal` chain; upgrade when a non-breaking fix exists, otherwise document the risk and the next review trigger.
- Done when: the dependency tree is re-checked, a documented decision exists, and the runtime audit remains clean.
- Verify: `npm audit --omit=dev`; full `npm audit`; `make check`; `npm run package:dir` if packaging tooling changes.
- Evidence: 2026-11-23 — runtime audit 0; full audit 6 moderate `minimatch` advisories; no stable non-breaking upstream fix. Accepted in ADR-080/`SECURITY.md` with a release-time review trigger. `npm run package:dir` and `make check` passed. See "Dependency audit — minimatch dev-toolchain acceptance" in `docs/PHASE_REPORTS.md`.

### BD-008 — Make workspace import/export session behavior explicit
- Status: DONE
- Priority: P3
- Depends: none
- Source: `README.md` known limitations; `SPEC.md` §11.4.
- Scope: Clarify in the import/export UI and docs that configuration transfers but sessions do not, and that exported URLs may contain query strings or secrets. Do not change the export format.
- Done when: the dialog and README state both caveats, no secret-bearing example is added, and the docs remain aligned.
- Verify: `make check`; manual dialog copy check; README link check.
- Evidence: 2026-11-23 — Workspaces dialog and README state both caveats; accessibility e2e asserts the visible note and dialog description; light/dark dialog screenshots inspected; all 11 local README links resolve. `make check` passed 187 unit tests, `npm run test:e2e` passed 5 tests in 23.0 s. See "Workspace transfer copy — session and URL caveats" in `docs/PHASE_REPORTS.md`.
