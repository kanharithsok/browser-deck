# BrowserDeck Factory State

> Durable session state. Keep this under one screen. The queue is
> `docs/ROADMAP.md`; detailed evidence is `docs/PHASE_REPORTS.md`. Chat history
> is not a state store.

- Last updated: 2026-11-23
- Current focus: BD-004 is done; next slice is BD-002 (manual VoiceOver and focus-ring pass).
- Next up: BD-002, BD-005, BD-006.
- Blockers: BD-001 needs explicit owner approval to publish; BD-009 needs a paid Apple Developer account; BD-010 is deferred by `SPEC.md` §19.
- Last recorded verification: 2026-11-23 — `make check` PASS (typecheck, lint, 187 unit tests, design-token contrast, `make agent-check`); `npm run build` PASS (main 158.91 kB, preload 9.32 kB, renderer 384.26 kB, CSS 36.25 kB); `npm run test:e2e` PASS (4 Playwright tests in 22.3 s).
- Last docs change: 2026-11-23 — documented BD-004's HTTP security indicator, moved it to Done, and selected BD-002 as the next READY task.

## Working rules

- Read `AGENTS.md`, this file, `docs/ROADMAP.md`, the relevant `SPEC.md` sections, and the relevant skills before editing.
- Work one roadmap task at a time. `BLOCKED` and `IDEA` tasks are not eligible for `/next`.
- Update the roadmap status/evidence and this file after each slice. Keep `docs/PHASE_REPORTS.md` as the detailed log.
- Never publish, sign, commit, or push without explicit approval.
- Native-view, IPC, session, and workspace changes require a running-app check; pure logic changes require unit tests first.

## Session notes

- 2026-11-23: Merged `main` (`cac3e26`, 1.2.0) into `dev` (`7cd15b9`, 1.1.0 plus agent workflow). The only conflict was `docs/PHASE_REPORTS.md`; both tails were kept.
- 2026-11-23: `make check`, `npm run build`, and `npm run test:e2e` passed after the merge. The e2e run covers the accessibility/axe suite, the main integration path, and the many-pane Canvas menu coverage.
- 2026-11-23: `dev` is at version 1.2.0 and is 12 commits ahead of `origin/dev` (main's 11 plus the merge); it has not been pushed. 1.2.0 is not published, so Homebrew still serves 1.1.0.
- 2026-11-23: BD-004 added `addressSecurityState`, a persistent **Not secure** warning for remote HTTP panes, accessible label/tooltip, narrow-width icon fallback, URL unit tests, and targeted e2e. The 320 px light/dark running-app screenshots were inspected and the warning remained readable.
