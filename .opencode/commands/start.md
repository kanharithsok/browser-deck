---
description: Start PaneFlow Phase 0 — bootstrap and native-view spike
---

Read `AGENTS.md`, `SPEC.md` (especially sections 12, 13, 17, 18, and Phase 0), and the current `docs/PHASE_REPORTS.md` before changing anything.

Then:

1. Inspect `git status`, the existing files, Node/npm versions, and the available scripts. Never reset or discard user changes.
2. If Phase 0 is already reported complete, verify its stated commands and stop. Do not rebuild or delete working code just to repeat the phase.
3. Otherwise implement Phase 0 only: a runnable Electron + Vue + TypeScript scaffold, a `BaseWindow` shell, at least two independently navigable `WebContentsView` panes, working pane chrome outside native bounds, persistent per-pane sessions, bounds synchronization, and reliable view/`webContents` teardown.
4. Prove the native-view composition by running it. Do not build the full workspace UI on an unproven overlay or click-through assumption.
5. Add real tests for the pure logic and a local-fixture integration test for the native composition. Use only npm scripts that actually exist.
6. Run the checks, record exact commands and results in `docs/PHASE_REPORTS.md`, record the composition decision and limitations in `docs/DECISIONS.md`, and align `docs/ARCHITECTURE.md` and `README.md`.
7. Do not commit, push, package a release, or change repository settings.

Report passed, failed, skipped, and unavailable checks separately. Stop after Phase 0 and summarize the evidence for review.
