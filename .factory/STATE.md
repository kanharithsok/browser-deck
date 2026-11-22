# BrowserDeck Factory State

> Durable session state. Keep this under one screen. The queue is
> `docs/ROADMAP.md`; detailed evidence is `docs/PHASE_REPORTS.md`. Chat history
> is not a state store.

- Last updated: 2026-11-22
- Current focus: Security and UI hardening; next slice is BD-004 (HTTP address indicator).
- Next up: BD-004, BD-002 (manual), BD-005.
- Blockers: BD-001 needs explicit owner approval to publish; BD-009 needs a paid Apple Developer account; BD-010 is deferred by `SPEC.md` §19.
- Last recorded verification: 2026-11-22 — `make check` PASS (typecheck, lint, 176 unit tests, design-token contrast, `make agent-check`); `npm run build` PASS (main 158.13 kB, preload 9.31 kB, renderer 358.96 kB, CSS 31.58 kB). `npm run test:e2e` NOT RUN because no native, IPC, session, or workspace behavior changed.
- Last docs change: 2026-11-22 — added the roadmap, state, `/plan`, and `/status`; upgraded `/start` and `/next`; added the agent-config validator.

## Working rules

- Read `AGENTS.md`, this file, `docs/ROADMAP.md`, the relevant `SPEC.md` sections, and the relevant skills before editing.
- Work one roadmap task at a time. `BLOCKED` and `IDEA` tasks are not eligible for `/next`.
- Update the roadmap status/evidence and this file after each slice. Keep `docs/PHASE_REPORTS.md` as the detailed log.
- Never publish, sign, commit, or push without explicit approval.
- Native-view, IPC, session, and workspace changes require a running-app check; pure logic changes require unit tests first.

## Session notes

- 2026-11-22: Added the lightweight agent workflow. No application code, dependencies, tests, or packaging changed.
- 2026-11-22: `make check` and `npm run build` passed for the workflow setup; e2e was not needed.
- 2026-11-22: The current checkout is `dev` at 1.1.0; `main` contains the later 1.2.0 work. Confirm the target branch before publishing.
