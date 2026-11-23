---
description: Resume a BrowserDeck session by checking state, roadmap, and repository truth
---

Read `AGENTS.md`, `.factory/STATE.md`, `docs/ROADMAP.md`, and the relevant parts of `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/PHASE_REPORTS.md`.

Then:

1. Inspect `git status`, the current branch, and the last few commits. Preserve all user changes.
2. Run `make agent-check` and report failures. Do not repair files unless the user asks.
3. Reconcile `STATE.md` and the roadmap with the actual code. Do not mark work done from a checkbox or a stale report.
4. Identify the single `NEXT` task, or the first `READY` task when no `NEXT` is set. Never select `BLOCKED`, `IDEA`, or `DONE`.
5. Report: branch and working-tree state, current focus, next task, blockers, last recorded verification, and any stale or contradictory state.
6. Stop after reporting. Do not implement code, edit state, or run the app unless the user asks for that next.

Safety: no commit, push, publish, sign, or destructive action.
