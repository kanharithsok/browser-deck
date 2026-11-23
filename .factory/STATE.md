# BrowserDeck Factory State

> Durable session state. Keep this under one screen. The queue is
> `docs/ROADMAP.md`; detailed evidence is `docs/PHASE_REPORTS.md`. Chat history
> is not a state store.

- Last updated: 2026-11-23
- Current focus: BD-005 is done; next slice is BD-006 (minimum-width pane header).
- Next up: BD-006, BD-007, BD-008. BD-003 needs a human multi-hour profiling run; BD-002 is owner-blocked.
- Blockers: BD-002 manual VoiceOver pass deprioritized by the owner; BD-001 needs release approval; BD-009 needs a paid Apple Developer account; BD-010 is deferred by `SPEC.md` §19.
- Last recorded verification: 2026-11-23 — `make check` PASS (typecheck, lint, 187 unit tests, design-token contrast, `make agent-check`); `npm run build` PASS (main 159.35 kB, preload 9.64 kB, renderer 385.93 kB, CSS 36.53 kB); `npm run test:e2e` PASS (4 Playwright tests in 22.5 s).
- Last docs change: 2026-11-23 — documented BD-005, blocked BD-002 per owner decision, and selected BD-006 as the next codeable task.

## Working rules

- Read `AGENTS.md`, this file, `docs/ROADMAP.md`, the relevant `SPEC.md` sections, and the relevant skills before editing.
- Work one roadmap task at a time. `BLOCKED` and `IDEA` tasks are not eligible for `/next`.
- Update the roadmap status/evidence and this file after each slice. Keep `docs/PHASE_REPORTS.md` as the detailed log.
- Never publish, sign, commit, or push without explicit approval.
- Native-view, IPC, session, and workspace changes require a running-app check; pure logic changes require unit tests first.

## Session notes

- 2026-11-23: Merged `main` (`cac3e26`, 1.2.0) into `dev` (`7cd15b9`, 1.1.0 plus agent workflow). The only conflict was `docs/PHASE_REPORTS.md`; both tails were kept.
- 2026-11-23: `make check`, `npm run build`, and `npm run test:e2e` passed after the merge. The e2e run covers the accessibility/axe suite, the main integration path, and the many-pane Canvas menu coverage.
- 2026-11-23: `origin/dev` now includes the 1.2.0 merge and BD-004. `dev` is 1 commit ahead with BD-005, which has not been pushed. 1.2.0 is not published, so Homebrew still serves 1.1.0.
- 2026-11-23: BD-004 added `addressSecurityState`, a persistent **Not secure** warning for remote HTTP panes, accessible label/tooltip, narrow-width icon fallback, URL unit tests, and targeted e2e.
- 2026-11-23: BD-002 was deprioritized by the owner. The manual VoiceOver spoken-order pass remains unverified and is recorded as blocked rather than silently removed.
- 2026-11-23: BD-005 added a trusted-shell notice for unexpected self-closed panes, with normal close kept silent. Targeted e2e covers normal close, notice text/dismissal, and cleanup.
