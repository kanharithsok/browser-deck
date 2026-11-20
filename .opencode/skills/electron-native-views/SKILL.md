---
name: electron-native-views
description: Use when changing BrowserDeck BaseWindow composition, WebContentsView panes, native bounds, z-order, focus, sessions, or pane teardown.
---

# Electron native views

Read `SPEC.md` sections 12, 18.3, and the current `docs/DECISIONS.md` / `docs/ARCHITECTURE.md` first. The accepted Phase 0 approach is ADR-001: a trusted shell `WebContentsView` plus inset pane `WebContentsView`s.

## Composition rules

- Use `BaseWindow` + `WebContentsView`. Never use iframes, `<webview>`, or deprecated `BrowserView` for remote panes.
- A `BaseWindow` has no `webContents`; create a trusted shell `WebContentsView` and load the Vue app there.
- Add the shell view first at `(0, 0)` covering `win.getContentBounds()`. Add pane views afterwards so they stack above it only within their rectangles.
- Keep pane chrome, toolbar, empty states, and error panels in the shell. Do not assume DOM elements can draw over or receive clicks through native browser content.
- Use native `Menu.popup` for menus that must overlap browser content.
- A native view is not clipped by DOM overflow. Do not put a native view inside a scrolling DOM region without hiding or repositioning it yourself.

## Bounds

- Measure the pane content placeholder's `getBoundingClientRect()`; use CSS pixels/DIP.
- Do not multiply by `devicePixelRatio`. Verify Retina behavior on the target Electron version. The Phase 0 Retina run reported DPR 2 while bounds stayed aligned.
- Treat renderer geometry as untrusted. Validate known pane IDs, finite values, minimum size, and shell/window canvas bounds in main.
- Coalesce updates with `requestAnimationFrame`; do not send one IPC call per pointer event.
- Re-measure after layout changes, pane add/remove, window resize/maximize/fullscreen changes, and visibility changes.
- Hide a view until it has valid bounds. Hide it for `about:blank` and load errors when the shell needs to show replacement UI.

## Lifecycle

- One `WebContentsView` per active pane; attach listeners at creation.
- On close: remove the child view, remove owned listeners, close DevTools, close the owned `webContents`, delete the record, and emit fresh state.
- On window close: destroy every pane view, then close the shell `webContents`. `BaseWindow` does not do this automatically.
- Guard every async callback against destroyed/stale panes and destroyed `webContents`.
- Do not delete a browser profile just because its pane closed.

## Verification

Prove changes in the running app, not only in unit tests:

- two panes load and remain independently interactive;
- DOM chrome is visible and clickable;
- native bounds match DOM placeholders before and after resizing the window;
- a native menu stacks above browser content;
- closing one pane leaves the other and its session intact;
- closing the window leaves no orphaned pane views or `webContents`.
