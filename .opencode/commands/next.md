---
description: Implement exactly one BrowserDeck roadmap task end-to-end
---

Read `AGENTS.md`, `.factory/STATE.md`, `docs/ROADMAP.md`, the selected task's source documents, and the relevant skills before editing.

1. Inspect `git status` and the current diff. Preserve user changes.
2. Select the task:
   - If $ARGUMENTS names a `BD-###`, confirm it exists and is `NEXT` or `READY`.
   - Otherwise take the single `NEXT` task, then the first `READY` task by priority.
   - Stop on `BLOCKED`, `IDEA`, or `DONE`; do not silently promote it.
3. Before coding, state the task ID, outcome, acceptance criteria, scope, affected modules/files, risk areas (native views, IPC, sessions, security, accessibility, persistence), and test plan. Proceed without asking for routine approval.
4. Implement one complete vertical slice. Do not bundle unrelated refactors, dependencies, or features.
5. Load the relevant skill before UI, native-view, security, or design work. Keep pure layout, URL, validation, and shared types free of Vue and Electron imports.
6. Add or update tests with the behavior. For native-view, bounds, z-order, focus, session, or teardown changes, verify in the running app. For pure logic, run the narrowest unit tests first.
7. Run `make check`, then `npm run test:e2e` when native/IPC/session/workspace behavior changed, then `npm run build`. Do not invent scripts or claim a check ran when it did not.
8. Review the diff for secret leaks, IPC sender/payload validation, view/webContents teardown, scope creep, and generated noise.
9. Update the records truthfully:
   - `docs/ROADMAP.md`: status and evidence for this task.
   - `.factory/STATE.md`: focus, next up, blockers, last verification.
   - `docs/PHASE_REPORTS.md`: exact commands and results.
   - `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/MANUAL_CHECKS.md`, and `README.md` when behavior or architecture changed.
   Mark `DONE` only when every acceptance criterion and required check passed. Otherwise leave `READY`, or set `BLOCKED` with evidence.
10. Stop after this one task. Do not start another.

Safety: do not commit, push, publish, sign, deploy, or delete user data unless the user explicitly asks. If a task requires publishing, signing, credentials, a destructive action, or a manual GUI verification you cannot perform, stop and report the gate as `BLOCKED` or `NOT RUN`.
