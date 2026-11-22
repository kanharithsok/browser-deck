---
description: Report BrowserDeck project and roadmap status without changing files
---

Read `AGENTS.md`, `.factory/STATE.md`, `docs/ROADMAP.md`, `docs/PHASE_REPORTS.md`, and `docs/DECISIONS.md`. Inspect `git status`, the current branch, the last few commits, and the available scripts.

Report:

- branch and working-tree state;
- task counts and the current `NEXT`/`READY`/`BLOCKED`/`IDEA` items;
- what is actually implemented, based on source and tests, not roadmap checkboxes alone;
- last recorded verification, and whether it predates the latest code change;
- blockers and decisions needed from the owner;
- recommended next command (`/next`, `/plan`, or a manual check).

Do not modify files, run destructive commands, or claim a check passed unless it ran in this session. If the state and the repository disagree, say so explicitly.
