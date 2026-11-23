# BrowserDeck Factory State

> Durable session state. Keep this under one screen. The queue is
> `docs/ROADMAP.md`; detailed evidence is `docs/PHASE_REPORTS.md`. Chat history
> is not a state store.

- Last updated: 2026-11-23
- Current focus: `main` 1.2.0 merged into `dev`; next slice is BD-004 (HTTP address indicator).
- Next up: BD-004, BD-002 (manual), BD-005.
- Blockers: BD-001 needs explicit owner approval to publish; BD-009 needs a paid Apple Developer account; BD-010 is deferred by `SPEC.md` §19.
- Last recorded verification: 2026-11-23 — `make check` PASS (typecheck, lint, 184 unit tests, design-token contrast, `make agent-check`); `npm run build` PASS (main 158.91 kB, preload 9.32 kB, renderer 382.90 kB, CSS 35.58 kB); `npm run test:e2e` PASS (3 Playwright tests in 31.9 s).
- Last docs change: 2026-11-23 — merged `main` at 1.2.0 into `dev`, kept the roadmap/agent workflow, and reconciled the state and phase log.

## Working rules

- Read `AGENTS.md`, this file, `docs/ROADMAP.md`, the relevant `SPEC.md` sections, and the relevant skills before editing.
- Work one roadmap task at a time. `BLOCKED` and `IDEA` tasks are not eligible for `/next`.
- Update the roadmap status/evidence and this file after each slice. Keep `docs/PHASE_REPORTS.md` as the detailed log.
- Never publish, sign, commit, or push without explicit approval.
- Native-view, IPC, session, and workspace changes require a running-app check; pure logic changes require unit tests first.

## Session notes

- 2026-11-23: Merged `main` (`cac3e26`, 1.2.0) into `dev` (`7cd15b9`, 1.1.0 plus agent workflow). The only conflict was `docs/PHASE_REPORTS.md`; both tails were kept.
- 2026-11-23: `make check`, `npm run build`, and `npm run test:e2e` passed after the merge. The e2e run covers the accessibility/axe suite, the main integration path, and the many-pane Canvas menu coverage.
- 2026-11-23: `dev` is now at version 1.2.0 and is 12 commits ahead of `origin/dev` (main's 11 plus the merge); it has not been pushed. 1.2.0 is not published, so Homebrew still serves 1.1.0.
