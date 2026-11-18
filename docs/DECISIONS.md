# Architecture Decision Records

Record material technical decisions here. Keep entries short but include context, alternatives, decision, consequences, and evidence.

## ADR-001 — Phase 0 native-view composition: shell view plus inset browser views

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** PaneFlow needs multiple interactive Chromium panes and usable application controls in one macOS window. `WebContentsView` is a native view outside the renderer DOM, so DOM controls cannot be assumed to draw over it or receive clicks through it. Phase 0 had to prove a composition that works with the pinned Electron version before building the full workspace.

- **Decision:**
  1. A `BaseWindow` hosts a trusted local shell `WebContentsView` at `(0, 0)` covering the window content area.
  2. Each browser pane is a separate `WebContentsView`, added after the shell, bounded exactly to a content placeholder rectangle inside that pane's card.
  3. Toolbar, pane titles, address controls, navigation buttons, empty states, and error states live in the shell and occupy space outside native browser bounds. They do not overlay native content, so no transparent click-through behavior is required.
  4. The shell reports content-placeholder rectangles with `getBoundingClientRect()`. The main process validates pane IDs, finite values, minimum sizes, and canvas bounds before applying them. Renderer values are treated as untrusted input.
  5. Browser bounds and the shell both use CSS pixels/DIP on macOS. The implementation does not multiply by `devicePixelRatio`. A Retina test reported `devicePixelRatio === 2` while native bounds continued to match CSS rectangles.
  6. Infrequent overlays use native menus (`Menu.popup`), which correctly stack above native browser views. DOM popovers over browser content are not part of the Phase 0 approach.
  7. A pane's native view is hidden until it has valid bounds. It is also hidden for `about:blank` and load failures so the shell can show an empty state or recovery panel in the same rectangle.
  8. Closing a pane removes its child view, removes its listeners, closes its owned `webContents`, and removes its record. Closing the window destroys all remaining pane views and closes the shell `webContents`.

- **Alternatives considered:**
  - **DOM chrome or overlays above native views.** Rejected as a foundation. It would need proven transparency and hit-testing behavior, and the Phase 0 product only needs chrome outside browser bounds.
  - **A native chrome view per pane.** Rejected for now because it duplicates UI and increases lifecycle complexity without a proven need.
  - **One `BrowserWindow` per browser pane.** Rejected because PaneFlow is a single flexible workspace, not a collection of independent windows.
  - **`iframe`, `<webview>`, or deprecated `BrowserView`.** Prohibited by the project specification and unsuitable for independent real sessions.

- **Consequences:**
  - Pane chrome is fixed to the top of each pane; arbitrary floating DOM controls cannot cover a live website.
  - Native views are not clipped by DOM scroll containers. The Phase 0 grid shrinks panes instead of scrolling; scroll-aware clipping and partial off-screen panes are deferred to Phase 2.
  - During a live window resize the shell can repaint one frame before native bounds update. The bounds converge after the layout frame; the integration test waits for alignment.
  - The shell is responsible for measurement, while the main process remains the validation boundary.
  - Native rounded corners use `View.setBorderRadius(8)`; this is cosmetic and was visually checked.

- **Evidence / verification:**
  - `npm run test:e2e` launched the built app, rendered two fixture panes, compared DOM content rectangles with native `view.getBounds()` before and after a window resize, and confirmed alignment within 1 CSS pixel.
  - Manual macOS run on a Retina display showed both fixture pages at `623 × 696` CSS pixels with `devicePixelRatio` 2 and native views aligned to their card content.
  - Manual run showed each pane's own persistent profile cookie (`alice` vs `bob`) and independent `localStorage`.
  - The native pane-actions menu was opened and visually confirmed above the native browser content.
  - Closing a pane was verified in the integration test to destroy its `webContents` while leaving the other pane and its session intact.
  - See `docs/PHASE_REPORTS.md` for exact commands and results.

## ADR template

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
