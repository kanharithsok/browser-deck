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

## ADR-002 — Authentication state belongs to each website profile

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Phase 1 must prove that two panes can authenticate independently on the same origin and keep those sessions across restarts without leaking cookies, tokens, or credentials into PaneFlow configuration or logs. PaneFlow is a browser workspace, not an identity provider.

- **Decision:**
  1. Websites own authentication. PaneFlow creates a separate persistent Electron partition per profile and otherwise does not mediate sign-in, passwords, tokens, or authorization.
  2. PaneFlow never copies cookies or credentials into workspace files, profile JSON, logs, exports, fixtures, screenshots, or Git.
  3. The deterministic fixture provides two synthetic accounts but no passwords. A form POST creates a server-side session and sets an HttpOnly, persistent cookie in the requesting profile's jar.
  4. Session checks are server-rendered. Page JavaScript cannot read the HttpOnly session cookie, which also proves the app is not relying on a privileged page bridge.
  5. Persistence is verified by relaunching the app with the same user-data directory and opening `/account` directly in both reused profiles.

- **Alternatives considered:**
  - **Store credentials or session tokens in PaneFlow configuration.** Rejected: violates the security boundary and would leak secrets outside Electron-managed profile storage.
  - **Copy cookies between profiles to simulate sharing.** Rejected: bypasses explicit profile selection and undermines isolation.
  - **Build an application-level account vault.** Out of scope; sites already provide their own authentication.
  - **Use query-string cookies as the final proof.** Rejected as insufficient for the exit criterion; Phase 0 used query cookies only as a basic isolation check.

- **Consequences:**
  - Login compatibility depends on the website and its treatment of Electron; PaneFlow does not spoof user agents or promise universal compatibility.
  - Session-only cookies and `sessionStorage` remain outside restart guarantees. Persistent cookies, localStorage, IndexedDB, and persistent HttpOnly session cookies are covered.
  - Future profile clear/delete actions must use Electron's session APIs rather than editing cookie jars manually.
  - The fixture server holds sessions in memory for the lifetime of the test run; this is test infrastructure, not production storage.

- **Evidence / verification:**
  - E2e signs Alice in through `/login` in pane one and Bob in pane two on the same origin, verifies each account page and HttpOnly session isolation, signs Bob out without affecting Alice, signs Bob back in, restarts the app, and verifies both account sessions and profile IDs persist.
  - The same test verifies persistent profile cookies and localStorage survive restart, and IndexedDB/localStorage stay isolated within the run.
  - See the Phase 1 section of `docs/PHASE_REPORTS.md`.

## ADR-003 — Pure layout engine and normalized freeform geometry

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Phase 2 needs grid reflow, freeform movement/resizing, snapping, z-order, maximize/restore, and window-size adaptation. Layout math inside Vue components or IPC handlers would be hard to test and easy to desynchronize from native view bounds.

- **Decision:**
  1. `src/shared/layout.ts` owns layout calculations and imports neither Vue nor Electron.
  2. Grid geometry is computed directly in CSS pixels/DIP for equal-width, row-major columns. Grid order is the pane-ID order. Minimum row height produces a `needsVerticalScroll` signal rather than dropping or arbitrarily shrinking panes; narrow columns produce a separate signal.
  3. Freeform pane geometry is stored normalized (0..1) and converted to pixels for the current canvas. Conversion, movement, and resizing clamp to the canvas and enforce the minimum card size; when the canvas itself is smaller than the minimum, the canvas wins.
  4. Snapping uses canvas edges/centers, neighbor edges/centers, and optional grid lines within a configurable threshold. It returns aligned guides for display during drag/resize only.
  5. Array order represents pane ordering, and the last item is the front/topmost pane. Maximize returns both maximized and restore rectangles.
  6. Native bounds remain the main process's responsibility. The renderer may use engine rectangles to position cards, but main still validates every reported native view rectangle.

- **Alternatives considered:**
  - **Rely on CSS grid/flex for layout math.** Rejected as the long-term engine: hard to unit-test, normalize, persist, or apply snapping.
  - **Store freeform geometry in pixels.** Rejected because window resizing would require ad-hoc rescaling and could lose relative arrangement.
  - **Clamp panel geometry inside Vue components.** Rejected because it duplicates logic and weakens testability.
  - **Allow grids to shrink panes indefinitely.** Rejected; it makes pane controls unusable and silently changes the layout contract.

- **Consequences:**
  - Grid mode does not yet solve scrolling or native-view clipping; the engine exposes the overflow condition so the renderer can handle it explicitly.
  - Normalized geometry can collide when the window becomes too small to honor minimum sizes; the conversion clamps, and the UI must surface/reorganize collisions later.
  - The 160 × 140 CSS-pixel card minimum is a layout-engine default, distinct from the existing 80 × 60 native-view minimum. Rendering is verified at tested sizes, but the two contracts should be unified.
  - Snap distances are CSS-pixel/DIP values; shell zoom remains disabled to avoid coordinate drift.

- **Evidence / verification:**
  - `tests/unit/layout.test.ts` covers 33 cases for grid placement/reflow, columns 1–5, overflow flags, add/remove/reorder, clamping, move/resize, normalized conversion, snapping, ordering, and maximize/restore.
  - `npm run test:unit` passes with 67 tests across 5 files.
  - Grid mode was subsequently wired in ADR-004; freeform and native-aware scrolling remain engine-only.

## ADR-004 — Grid mode uses engine placements and defers native-aware scrolling

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** The pure layout engine was ready, but the renderer still used CSS auto-fit, which could not expose a user-selectable column count or guarantee equal pane geometry. Native `WebContentsView`s are not clipped by DOM scroll containers, so allowing an overflowing grid to scroll immediately would let browser views escape their workspace or cover chrome.

- **Decision:**
  1. Grid mode renders absolutely positioned `.pane-slot` elements from `layoutGrid` rectangles. The workspace content box is measured with `ResizeObserver`, and native pane content is re-measured after Vue commits each layout.
  2. A compact toolbar selector exposes columns 1–5; add/remove and window resize reflow through the engine.
  3. The engine reports vertical overflow and narrow columns. Until native-aware scrolling lands, the shell shows a notice and keeps the workspace non-scrollable rather than allowing native views to escape or misalign.
  4. Native bounds remain measured from DOM content rectangles and validated by main. The grid engine does not write native bounds directly.
  5. Freeform panes, drag reorder, and column persistence remain deferred.

- **Alternatives considered:**
  - **Keep CSS auto-fit.** Rejected because it hides layout math in CSS, cannot expose a real column count, and cannot be reused for freeform layout.
  - **Enable DOM scrolling immediately.** Rejected because native views do not scroll or clip with the DOM; it would break alignment or draw browser content over chrome.
  - **Hide excess panes.** Rejected; panes must never be silently dropped from the workspace.

- **Consequences:**
  - A window too short for all rows now scrolls; the native-aware visibility behavior is defined in ADR-005.
  - Narrow columns produce a warning but remain usable in tested sizes; the engine and native minimums still need unification.
  - Columns reset to the default on restart until workspace persistence arrives in Phase 3.
  - Absolute pane placement makes later freeform and z-order integration possible without changing the native bounds path.

- **Evidence / verification:**
  - E2e switches 2 → 5 → 1 → 2 columns, verifies card geometry, compares DOM content rectangles with native `view.getBounds()` after each reflow, and repeats alignment after pane add/close.
  - Manual macOS run showed the two-column grid, column control, 623 × 696 native pane viewports, and aligned chrome.
  - Existing authentication, lifecycle, teardown, popup/permission, and restart-persistence checks still pass.

## ADR-005 — Native-aware scrolling shows only fully visible panes

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Grid rows can exceed the workspace height. DOM scrolling clips pane cards, but native `WebContentsView`s are outside the DOM and cannot be clipped by the shell's overflow. Leaving off-screen views visible could cover chrome, overlap toolbar content, or appear over the wrong pane.

- **Decision:**
  1. The workspace scrolls to the layout engine's full `contentHeight`.
  2. After every scroll/layout pass, the renderer computes each pane content rectangle against the visible workspace rectangle.
  3. A pane is marked visible only when its entire content rectangle is inside the workspace viewport. Partially visible and off-screen panes report `visible: false`.
  4. Main validates the visibility boolean. Visible panes receive validated bounds; hidden panes have no new native bounds applied and are hidden via `View.setVisible(false)`.
  5. Hidden panes render a shell message while off-screen, so the blank card has an explanation.
  6. On scrolling back, the newly visible pane receives fresh bounds and is shown again.

- **Alternatives considered:**
  - **Let native views scroll with the DOM.** Not possible; native views are composed outside the renderer DOM.
  - **Clip native views with a native container.** Not implemented in this slice; `WebContentsView` does not inherit DOM clipping.
  - **Show partial views and accept overlap.** Rejected because native views could cover chrome or the wrong pane.
  - **Shrink panes to fit.** Rejected because it silently changes pane geometry and makes minimum-size controls unusable.

- **Consequences:**
  - Partially visible panes are hidden and not interactive until fully scrolled into view.
  - Pointer scrolling can show a one-frame shell/native update lag; measurement is rAF-coalesced.
  - The shell continues to own native visibility policy; main remains the validation boundary.
  - More stress testing is needed for large pane counts and rapid scrolling.

- **Evidence / verification:**
  - E2e adds two panes, forces four single-column rows into a short window, confirms the grid scroll height exceeds the workspace, and verifies some native views are hidden.
  - It scrolls to the bottom, confirms the hidden set changes, and checks every visible native view stays within the workspace's top/bottom bounds.
  - Existing column reflow, native alignment, authentication, lifecycle, and restart checks still pass.

## ADR-006 — Grid drag reorder hides native views to keep pointer events in the shell

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Dragging a pane header across another pane would cross a native `WebContentsView`, which sits above the shell and receives OS pointer events. The shell would stop receiving pointer moves, so it could neither show a drop target nor complete a reorder reliably.

- **Decision:**
  1. Grid display order is renderer state, reconciled with pane add/remove but independent of the main-process snapshot order.
  2. Pointer-down on a pane title row starts a thresholded drag. Once movement exceeds 5 CSS px, the renderer enters drag mode.
  3. In drag mode, all native panes report `visible: false` through the existing validated bounds path. The shell is therefore exposed across the workspace and continues receiving pointer move/up events.
  4. Drop targets are calculated from shell pane-card rectangles. A shell outline marks the target; the dragged card is dimmed.
  5. On drop, order changes through `reorderPaneIds`. Exiting drag mode re-measures and restores native views at their new bounds.
  6. Buttons, inputs, links, and other interactive child controls inside the title row never start a drag.

- **Alternatives considered:**
  - **Rely on pointer capture across native views.** Rejected; pointer capture in the shell renderer does not make native views part of the shell hit-test surface.
  - **Global mouse polling from main.** Rejected for this slice because it needs platform-specific mouse-button tracking and adds latency/complexity.
  - **HTML5 drag/drop only.** Rejected; it still has to cross the native view hit-test boundary.
  - **Reorder via menu only.** Rejected as the primary interaction because the spec calls for dragging a pane to change grid order.

- **Consequences:**
  - Websites are temporarily hidden during a drag; this is intentional and ends on drop/cancel.
  - Drag reorder is pointer-only for now; keyboard reordering is still needed for accessibility.
  - Grid order is not persisted across restarts until workspace persistence lands.
  - Drop-target outlines are shell DOM and visible because native views are hidden for the drag duration.

- **Evidence / verification:**
  - E2e drags Bob's title row onto Alice, asserts all native views are hidden during the drag, verifies the new card order, and confirms native alignment after views restore.
  - It drags back to the original order and re-verifies alignment.
  - Existing column, scrolling, auth, lifecycle, and persistence checks still pass.

## ADR template

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
