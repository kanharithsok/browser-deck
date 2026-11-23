# BrowserDeck Factory State

> Durable session state. Keep this under one screen. The queue is
> `docs/ROADMAP.md`; detailed evidence is `docs/PHASE_REPORTS.md`. Chat history
> is not a state store.

- Last updated: 2026-11-23
- Current focus: BD-008 is done. No codeable `NEXT` remains; BD-003 requires a human multi-hour profiling run.
- Next up: BD-003 (manual profiling). BD-002 is owner-blocked; release and signing tasks need owner approval/credentials.
- Blockers: BD-003 needs a human profiling run; BD-002 manual VoiceOver pass deprioritized; BD-001 needs release approval; BD-009 needs a paid Apple Developer account; BD-010 is deferred by `SPEC.md` §19.
- Last recorded verification: 2026-11-23 — `make check` PASS (typecheck, lint, 187 unit tests, design-token contrast, `make agent-check`); `npm run build` PASS (main 159.35 kB, preload 9.64 kB, renderer 387.03 kB, CSS 37.64 kB); `npm run test:e2e` PASS (5 Playwright tests in 23.0 s); all 11 local README links resolve.
- Last docs change: 2026-11-23 — documented BD-008's dialog/README import-export caveats, moved it to Done, and recorded that no codeable task remains.

## Working rules

- Read `AGENTS.md`, this file, `docs/ROADMAP.md`, the relevant `SPEC.md` sections, and the relevant skills before editing.
- Work one roadmap task at a time. `BLOCKED` and `IDEA` tasks are not eligible for `/next`.
- Update the roadmap status/evidence and this file after each slice. Keep `docs/PHASE_REPORTS.md` as the detailed log.
- Never publish, sign, commit, or push without explicit approval.
- Native-view, IPC, session, and workspace changes require a running-app check; pure logic changes require unit tests first.

## Session notes

- 2026-11-23: Merged `main` (`cac3e26`, 1.2.0) into `dev` (`7cd15b9`, 1.1.0 plus agent workflow). The only conflict was `docs/PHASE_REPORTS.md`; both tails were kept.
- 2026-11-23: `make check`, `npm run build`, and `npm run test:e2e` passed after the merge. The e2e run covers the accessibility/axe suite, the main integration path, and the many-pane Canvas menu coverage.
- 2026-11-23: `origin/dev` includes the 1.2.0 merge and BD-004. `dev` is 4 commits ahead with BD-005, BD-006, BD-007, and BD-008; nothing is pushed. 1.2.0 is not published, so Homebrew still serves 1.1.0.
- 2026-11-23: BD-004 added `addressSecurityState`, a persistent **Not secure** warning for remote HTTP panes, accessible label/tooltip, narrow-width icon fallback, URL unit tests, and targeted e2e.
- 2026-11-23: BD-002 was deprioritized by the owner. The manual VoiceOver spoken-order pass remains unverified and is recorded as blocked rather than silently removed.
- 2026-11-23: BD-005 added a trusted-shell notice for unexpected self-closed panes, with normal close kept silent. Targeted e2e covers normal close, notice text/dismissal, and cleanup.
- 2026-11-23: BD-006 compacted the inline custom viewport editor at 320 px, hid redundant load-error text at the narrowest width, and added a 720 × 520 / 320 px e2e check for overflow, focus order, and light/dark rendering.
- 2026-11-23: BD-007 re-checked the dependency tree. The runtime audit is clean; the six moderate `minimatch` advisories remain build-only with no stable non-breaking upstream fix. ADR-080 accepts the risk with a release-time review trigger, and `package:dir` still succeeds.
- 2026-11-23: BD-008 added the Workspaces dialog transfer note and accessible description, updated the README capability copy, and verified the dialog in light/dark plus all local README links.
