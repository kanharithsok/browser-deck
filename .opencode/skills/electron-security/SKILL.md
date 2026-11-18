---
name: electron-security
description: Use when changing PaneFlow IPC, preload, navigation, permissions, sessions, filesystem access, persistence, or packaging.
---

# Electron security

Read `SPEC.md` section 13, `AGENTS.md`, and current Electron security guidance for the pinned version before changing a boundary.

## Remote browser panes

Remote websites are hostile.

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`.
- Never attach the application preload or expose `window.paneflow`, `require`, `process`, filesystem, shell, or environment access to remote content.
- Allow only `http:`, `https:`, and `about:blank`. Validate with the URL parser in `src/shared/url.ts`; reject `javascript:`, `data:`, `file:`, `chrome:`, and other custom schemes.
- Enforce navigation policy in main on `will-navigate` and `will-redirect`, not only in the renderer.
- Deny new windows/popups in the MVP. Do not pass remote URLs to `shell.openExternal`.
- Deny permissions by default for every remote session; never auto-grant because one pane asked.
- Deny downloads in the current MVP; revisit with an explicit download design.
- Do not disable web security, ignore certificate errors, spoof user agents to bypass restrictions, or enable insecure content to make a site work.

## IPC and preload

- Expose only specific typed operations through `contextBridge`, never a generic send/invoke.
- In every `ipcMain.handle`, verify the event sender is the trusted shell and the sender frame is its main frame.
- Re-validate types, lengths, IDs, URLs, and geometry in main. Renderer validation is not a security boundary.
- Keep privileged APIs in main/preload. `src/shared` and renderer components do not import Electron.

## Sessions and data

- Partitions are generated internally: `persist:paneflow-profile-<uuid>`. Never derive a partition from a label, URL, tenant, or other user input.
- Do not copy cookies, tokens, credentials, page contents, or session storage into PaneFlow JSON, logs, fixtures, exports, screenshots, or Git.
- Avoid logging full URLs that may contain sensitive query parameters.
- Corrupt persistence files are preserved with a `.corrupt-<timestamp>` suffix and replaced with safe defaults; never silently continue with invalid data.
- Test hook surfaces must be gated by an explicit development/test flag and unavailable in packaged builds.

## Shell

- Use a restrictive CSP and a minimal sandboxed preload for the trusted shell.
- Deny shell navigation, window creation, and webview attachment.
- Prefer a custom application protocol over broad `file://` access when packaging work begins.
- Review Electron fuses and production hardening before packaging. Do not weaken renderer security for packaging convenience.

## Review checklist

- Does any remote page receive a privileged object?
- Is IPC sender identity checked in main?
- Are navigation, redirects, popups, permissions, and downloads covered?
- Can user input influence a partition name, filesystem path, or executable operation?
- Are secrets absent from files, logs, screenshots, fixtures, and error messages?
- Were allowed/denied cases tested, not just assumed?
