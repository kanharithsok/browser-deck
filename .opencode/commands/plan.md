---
description: Refine or capture BrowserDeck roadmap tasks without implementing code
---

Read `AGENTS.md`, `.factory/STATE.md`, `docs/ROADMAP.md`, `docs/PHASE_REPORTS.md`, `docs/DECISIONS.md`, and the relevant `SPEC.md` sections. This is a planning-only command: do not change application code, tests, dependencies, schemas, packaging, or generated files.

Optional focus: $ARGUMENTS

If $ARGUMENTS is empty, review the roadmap for stale, duplicate, or missing tasks and report; do not invent work.

1. If $ARGUMENTS describes a new task, dedupe it against every roadmap task and the known limitations in `README.md`, `SPEC.md`, and `PHASE_REPORTS.md`. If it is already covered, report the existing `BD-###` and stop. Otherwise add a new task under `## Ideas` with a unique ID, priority, dependencies, source, scope, done-when, and verification.
2. If asked to refine or promote an existing task, review its scope and dependencies first. Split tasks that bundle unrelated work. Promote only a clearly scoped, unblocked task to `READY`; keep at most one `NEXT`.
3. Keep IDs stable. Never renumber or reuse an ID. Preserve completed tasks; never mark anything `DONE` without evidence.
4. Check that every task has a clear done-when and a real verification command. Flag owner decisions instead of inventing an answer.
5. Run `make agent-check`.
6. Update `.factory/STATE.md` only if the current focus, next-up list, or blockers changed.
7. Report tasks added/changed, duplicates found, unresolved decisions, and the next eligible task.

Safety: no implementation, commits, pushes, releases, or destructive actions.
