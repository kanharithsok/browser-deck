---
description: Implement the next small, verified BrowserDeck slice
---

Read `AGENTS.md`, the relevant parts of `SPEC.md`, `docs/PHASE_REPORTS.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` first.

Then:

1. Inspect `git status` and the current implementation. Preserve user changes.
2. Identify the next incomplete vertical slice in the current phase. Do not skip Phase 0 or jump to post-MVP features.
3. State a brief plan, then implement the slice completely: UI, main-process behavior, preload/IPC changes, and tests as applicable.
4. Keep pure layout, URL, validation, and shared types in `src/shared` without Vue or Electron imports.
5. Verify native-view behavior in the running app whenever bounds, z-order, focus, sessions, or teardown change.
6. Run the narrowest relevant tests first, then `typecheck`, `lint`, unit tests, relevant integration/e2e tests, and the build.
7. Update `docs/PHASE_REPORTS.md` with actual outcomes. Update `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/MANUAL_CHECKS.md`, and `README.md` when behavior or architecture changes.
8. Do not commit or push unless explicitly asked.

Finish with a concise summary of delivered behavior, exact verification results, and the next smallest slice.
