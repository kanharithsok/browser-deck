---
description: Read-only review of the current BrowserDeck changes
---

Read `AGENTS.md`, `.factory/STATE.md`, and `docs/ROADMAP.md` for the active task. Review the current working tree without modifying files.

Focus on:

- Correctness of pane layout, native view bounds, sizing, focus, and teardown.
- Lifecycle leaks: child views, `webContents`, listeners, stale async events.
- IPC sender validation and payload validation in the main process.
- Remote-content isolation: preload exposure, Node access, permissions, navigation, popups, downloads, TLS.
- Session/profile partition correctness and secret handling.
- Vue state/render loops, unnecessary IPC, accessibility, light/dark appearance, and alignment with the minimal design direction.
- Missing or misleading tests and documentation.

Report findings by severity with file/line references and concrete remediation. Separate confirmed defects from suggestions and do not rubber-stamp the change.
