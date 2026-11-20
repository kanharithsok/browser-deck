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
  - Login compatibility depends on the website. Responsive and custom panes keep Electron's UA; fixed presets use category UAs from ADR-057. Universal compatibility is not promised.
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
  5. Freeform panes and drag reorder were deferred to later Phase 2 slices; column selection now persists through the Phase 3 workspace store.

- **Alternatives considered:**
  - **Keep CSS auto-fit.** Rejected because it hides layout math in CSS, cannot expose a real column count, and cannot be reused for freeform layout.
  - **Enable DOM scrolling immediately.** Rejected because native views do not scroll or clip with the DOM; it would break alignment or draw browser content over chrome.
  - **Hide excess panes.** Rejected; panes must never be silently dropped from the workspace.

- **Consequences:**
  - A window too short for all rows now scrolls; the native-aware visibility behavior is defined in ADR-005.
  - Narrow columns produce a warning but remain usable in tested sizes; the engine and native minimums still need unification.
  - Columns are persisted with the workspace.
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
  - Grid order is persisted with the workspace; drag reordering remains pointer-only.
  - Drop-target outlines are shell DOM and visible because native views are hidden for the drag duration.

- **Evidence / verification:**
  - E2e drags Bob's title row onto Alice, asserts all native views are hidden during the drag, verifies the new card order, and confirms native alignment after views restore.
  - It drags back to the original order and re-verifies alignment.
  - Existing column, scrolling, auth, lifecycle, and persistence checks still pass.

## ADR-007 — Freeform geometry stays normalized and manipulates the shell while native views hide

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Freeform panes need arbitrary positions, overlap, resizing, snapping, and z-order while their websites remain native `WebContentsView`s. Native views obscure the shell, so DOM resize handles drawn over browser content would be unreachable, and pointer movement across panes would leave the shell.

- **Decision:**
  1. Freeform geometry is stored per pane as normalized rectangles and converted to the current workspace canvas. Grid order/columns and freeform geometry are independent state preserved across mode switches.
  2. On first entry, existing panes are seeded from their current grid placements; new panes use a cascading default. Window resizes adapt normalized geometry with minimum/canvas clamping.
  3. Freeform panes reserve a 6px shell inset around native content. Eight edge/corner handles live in that shell area and remain clickable while the website is visible.
  4. Moving uses the title row; resizing uses shell handles. Both hide native views for the active interaction so the shell receives pointer events and can show alignment guides.
  5. Move/resize uses the pure engine’s clamping and snapping helpers. Candidate guides are rendered as shell overlays while native views are hidden.
  6. Freeform z-order is renderer state. Bring-front and send-back actions update both the renderer order and native child view order through typed IPC; grid mode retains its own order.
  7. Tidy converts a grid arrangement into normalized freeform geometry.

- **Alternatives considered:**
  - **Resize handles overlapping native content.** Rejected; native views would intercept pointer events.
  - **Keep native views visible during manipulation.** Rejected because pointer capture does not cross native view hit testing and guides would be obscured.
  - **Store freeform pixels.** Rejected because window resizing would not preserve relative arrangement.
  - **Use a separate overlay window for drag/guides.** Deferred; hiding views is simpler and already uses the validated visibility path.

- **Consequences:**
  - Websites are temporarily hidden during freeform manipulation.
  - Freeform mode is pointer-only for now; keyboard manipulation and maximize/restore remain.
  - Normalized minimum-size clamping can make panes overlap on very small windows.
  - Freeform normalized geometry and z-order are persisted with the workspace.
  - A fully covered pane may be unreachable until the covering pane is moved or another z-order control is added.

- **Evidence / verification:**
  - E2e switches grid → freeform, drags a pane, verifies all native views hide during manipulation and native bounds align after the drop.
  - It resizes from SE and NW handles, verifies both dimensions change, switches back to grid, and then back to freeform to confirm both arrangements are preserved.
  - E2e brings a pane forward, verifies native child order and DOM z-index, sends it back, and verifies both orders reverse.
  - Existing grid reflow, scrolling, drag reorder, auth, lifecycle, and restart checks still pass.

## ADR-008 — Maximize is temporary renderer state over the preserved arrangement

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** A pane needs to temporarily fill the workspace without destroying or overwriting the user’s grid/freeform arrangement. Multiple native views cannot all remain visible in the same rectangle, and maximize must not be persisted.

- **Decision:**
  1. `maximizedPaneId` is renderer-only temporary state. It is cleared on close, mode switch, and app restart.
  2. The maximized pane gets a fixed workspace-inset slot. Other pane slots keep their normal DOM rectangles for measurement but are visually hidden and report `visible: false`; their native views hide through the existing validated visibility path.
  3. The underlying grid/freeform model is not mutated, so restore simply clears the state and returns to the prior arrangement.
  4. Native bounds for the maximized pane are re-measured like any other layout change; no special main-process geometry path is used.
  5. Dragging/resizing is disabled while maximized.

- **Alternatives considered:**
  - **Overwrite the pane geometry with a maximized rect.** Rejected because restore would need an ad-hoc snapshot and could drift from the engine state.
  - **Destroy/hide pane DOM for non-maximized panes.** Rejected because the shell would stop reporting their native bounds, leaving their views visible or stale.
  - **Persist maximize state.** Rejected; the specification treats focus/maximize as temporary state.

- **Consequences:**
  - Non-maximized pane cards remain in the shell DOM but are invisible; their native views are hidden.
  - The workspace scrolls to the top when maximizing.
  - Restore returns to the current arrangement, including changes made to freeform normalized geometry while unmaximized.
  - Explicit z-order controls remain separate work.

- **Evidence / verification:**
  - E2e maximizes the first pane, verifies only one native view remains visible, confirms the card fills the workspace and visible bounds align.
  - Restoring shows both views, verifies native alignment, and checks the original grid position/width are restored within 2px.
  - Existing grid, scroll, drag, freeform, auth, lifecycle, and restart checks still pass.

## ADR-009 — Keyboard commands route through the native menu to the active pane

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:** Keyboard shortcuts must work when focus is inside a remote native pane or the shell. Renderer-only `keydown` handlers would miss native view focus, and common accelerators can conflict with Electron menu roles. Pane commands also need an unambiguous active pane without exposing generic IPC.

- **Decision:**
  1. A native **Pane** application menu owns accelerators for add, close, reload active/all, toggle maximize, and toggle grid/freeform.
  2. Menu items send a typed `PaneCommand` to the trusted shell. Remote pages have no command bridge.
  3. The renderer tracks the active pane from shell pointer/focus interactions and from main-process native `webContents` focus notifications.
  4. Commands act on the active pane; add selects the new pane and close falls back to the first remaining pane. With no active pane, reload falls back to reload-all.
  5. Menu item IDs are stable so e2e can invoke the menu path without OS-level key automation.

- **Alternatives considered:**
  - **Renderer-only keyboard handlers.** Rejected because key events do not reach the shell when focus is in a native website.
  - **Global shortcuts.** Rejected; they can steal keys system-wide and conflict with normal app behavior.
  - **Generic IPC send.** Rejected by the existing security boundary; commands remain typed and shell-only.
  - **Track active pane in main.** Deferred; the renderer owns pane UI state and native focus notifications are enough for this slice.

- **Consequences:**
  - Accelerators are discoverable in the native menu and work with native pane focus.
  - Active-pane inference is not yet accompanied by a focused-pane outline.
  - Raw key-chord automation remains a follow-up; menu command routing is covered by e2e.
  - Pane commands are intentionally limited to workspace actions, not arbitrary remote-page control.

- **Evidence / verification:**
  - E2e invokes menu items for add, close, maximize toggle, and layout toggle; verifies pane counts, one-visible maximize state, and mode changes.
  - The eight-pane stress run adds four panes through the menu and verifies native bounds across four grid rows, then freeform drag/resize, z-order, maximize, and grid restore.

## ADR-010 — Viewport emulation uses desktop positioning and a display-only scale

- **Status:** Accepted; the fit/actual mode choice is superseded by ADR-028, and the desktop-only emulation mechanism by ADR-064
- **Date:** 2026-11-18
- **Context:** `SPEC.md` §10 requires per-pane viewport presets, custom dimensions, a device scale factor, and fit/actual display scale modes. The emulated CSS viewport must match the configured values even when visual fit changes the rendered size. Electron 45 exposes `webContents.enableDeviceEmulation` with `screenPosition`, `screenSize`, `viewPosition`, `deviceScaleFactor`, `viewSize`, and `scale`.

- **Decision:**
  1. Keep preset definitions, validation, custom parsing, and fit-scale math in the pure TypeScript `src/shared/viewports.ts` module.
  2. Apply emulation with `screenPosition: 'desktop'` and `viewSize` equal to the requested CSS width and height. Desktop positioning keeps `window.innerWidth`, `window.innerHeight`, and media queries at the configured dimensions. Mobile positioning produced Chromium's 980 px fallback layout for fixture pages without a viewport meta tag.
  3. Set `deviceScaleFactor` to the preset or custom value. Set `scale` to the fit ratio in fit mode and `1` in actual mode. Disable emulation for responsive panes.
  4. Keep the native view inside its validated pane bounds. Only the CSS layout and render scale are emulated; touch, GPS, and device API behavior are not spoofed. User-agent handling is defined later in ADR-057.
  5. Store viewport state in the main-process pane record and expose it in `PaneState`; the renderer owns the controls and sends validated settings through typed IPC.
  6. Reject invalid custom values in both the renderer and main process. Do not silently clamp input.

- **Alternatives considered:**
  - **`screenPosition: 'mobile'`.** Rejected for this slice because pages without a viewport meta tag fall back to a 980 px layout, so the fixture cannot prove that presets set the intended CSS viewport.
  - **Resize the native view to the emulated dimensions.** Rejected because native views cannot extend or clip within the pane safely, and changing the view size changes the CSS viewport.
  - **Renderer CSS transforms or iframes.** Rejected; native `WebContentsView` is the required pane renderer and cannot be transformed or clipped by DOM.
  - **User-agent strings named after devices.** Rejected at the time as beyond the viewport-only scope. ADR-057 later added category-level UAs for fixed presets; exact model identities remain out of scope.
  - **Persist viewport state immediately.** Deferred to the workspace persistence slice so all pane state is restored through one versioned store.

- **Consequences:**
  - Preset and custom dimensions are exact inside the page, and two panes can hold different viewports simultaneously.
  - Fit mode can leave unused space because the emulated view is scaled and left-aligned inside the pane.
  - Actual mode renders at 1:1 and clips a viewport that is larger than the pane; pane-level panning/scroll for the emulated surface is not implemented.
  - Viewport settings are persisted with the workspace (see ADR-011).
  - Narrow pane headers wrap their controls rather than hiding them.

- **Evidence / verification:**
  - E2e reads `window.innerWidth`, `window.innerHeight`, and `window.devicePixelRatio` from fixture pages: mobile 390 × 844 at DPR 3, tablet 820 × 1180 at DPR 2 in a second pane at the same time, and custom 500 × 700 at DPR 2.
  - E2e verifies fit mode reports a scale below 1, actual mode reports scale 1, and the CSS viewport remains unchanged. Responsive mode disables emulation.
  - E2e submits a 100 px custom width and confirms the visible alert plus unchanged mobile preset.
  - Manual macOS capture shows mobile fit scaled inside the pane and actual at 1:1 with the lower content clipped at the pane edge while the page still reports 390 × 844.
  - Five-column layout e2e asserts no header overflow and a usable address width.

## ADR-011 — Workspace state is persisted by main from validated renderer layout

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Phase 3 must restore pane URLs, per-pane viewports, order, profile references, and grid/freeform layout after restart. Pane ownership is split: `BrowserManager` owns native views, URLs, viewports, and profile IDs; the renderer owns grid order, columns, freeform geometry, z-order, and mode. `SPEC.md` §11 requires validated, versioned, atomically written JSON and warns against storing browser contents or secrets.

- **Decision:**
  1. `WorkspaceStore` in the main process owns `app-state.json` and `workspaces/<id>.json`. `app-state.json` stores the schema version and active workspace ID; the workspace file stores pane definitions and layout state.
  2. Pane definitions contain stable pane IDs, profile IDs, absolute `http:`/`https:`/`about:blank` URLs, and validated viewport settings. They never contain cookies, storage, page content, or credentials.
  3. The renderer sends normalized layout state through typed `save-workspace-layout` IPC. The main process validates/normalizes it against current pane IDs, appends missing references, drops unknown panes, and writes atomically. Renderer saves are skipped during active drags and committed after the interaction.
  4. On startup, main loads the workspace and creates panes before loading the shell, so the renderer's first `getState` sees restored panes and layout. Missing profile records are reconstructed with the same profile ID so existing partitions retain their sessions.
  5. Invalid workspace/app-state files are preserved with `.corrupt-<timestamp>` and the app starts from safe defaults. Invalid pane URLs/viewports are rejected before writing.
  6. Maximized/focused state is intentionally not persisted. That slice only had the default workspace and active workspace pointer; workspace management arrived in ADR-014.
  7. Device emulation is deferred until `did-stop-loading`; enabling emulation on an empty view before first navigation caused an Electron SIGSEGV.

- **Alternatives considered:**
  - **Renderer-owned localStorage/IndexedDB.** Rejected because main must validate persisted URLs/layout, writes must be atomic/versioned, and future main-side workspace switching needs the data.
  - **Store complete ShellState including profile/session data.** Rejected; profile partitions remain Electron-managed and workspace JSON contains only references.
  - **Persist only URLs and recreate panes with new IDs/profiles.** Rejected; it would lose stable pane identity and authenticated sessions.
  - **Load the shell before creating restored panes.** Rejected because the renderer could read an empty transient state and overwrite the saved layout.
  - **Persist maximize/focus.** Rejected by specification; these are temporary interaction state.
  - **Apply viewport emulation before load.** Rejected after an isolated macOS SIGSEGV.

- **Consequences:**
  - Restarts restore pane identity, profile sessions, URLs, viewports, columns, mode, grid order, and freeform geometry.
  - Workspace JSON grows with pane/layout data but contains no secrets.
  - The renderer must serialize layout changes and copy reactive proxies into plain objects before IPC.
  - Window bounds, theme, multiple workspaces, and profile management UI remain future work.
  - Overlapping freeform panes can still cover shell chrome; persistence does not change native/dwm composition.

- **Evidence / verification:**
  - Unit tests cover workspace schema validation, unknown/missing pane normalization, corrupt-file recovery, atomic store reloads, invalid pane rejection, and profile-ID restoration.
  - E2e closes and relaunches with the same user data and verifies the restored pane ID, Alice profile ID, authenticated `/account` URL, mobile viewport (390 × 844, DPR 3), one-column grid setting, freeform mode/geometry, native alignment, and retained Bob profile cookies.
  - A standalone restore smoke test exposed an Electron SIGSEGV when emulation was applied before load; deferring emulation until `did-stop-loading` removed the crash and the same restore then succeeded.

## ADR-012 — Profile lifecycle lives in the trusted shell with main-enforced usage rules

- **Status:** Superseded by ADR-062 (Profiles manager and sharing removed)
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §9.4 requires a profile manager listing labels/creation data and pane usage, renaming, clearing data, and deleting unused profiles with protection against deleting active profiles. Remote pane content must never receive profile metadata or session controls. Shell DOM overlays are covered by native pane views.

- **Decision:**
  1. A **Profiles** toolbar action opens a trusted shell dialog. While it is open, all native pane views are hidden through the existing validated visibility path; closing re-measures and restores them.
  2. Main exposes typed `list-profiles`, `rename-profile`, `clear-profile`, and `delete-profile` IPC. Every handler validates the shell sender and payload. Responses contain labels, creation timestamps, pane IDs, and usage only—never cookies or storage values.
  3. Clear and delete are rejected while any live pane uses the profile. The dialog also disables those actions and explains why.
  4. Rename validates non-empty, bounded, duplicate-free labels, persists metadata, and emits a pane-state refresh so live headers update.
  5. Clear calls `clearStorageData`, `clearCache`, and `clearAuthCache` on the profile partition after inline confirmation. Delete performs the same clear, removes `profiles.json` metadata, and best-effort removes the partition directory.
  6. Focus is trapped in the dialog, Escape cancels the current rename/confirmation or closes it, and focus returns to the toolbar action.
  7. That slice kept fresh-profile-only pane creation; explicit sharing from the profile manager was added in ADR-015.

- **Alternatives considered:**
  - **Native menu-only profile actions.** Rejected for rename/confirmation UX and list presentation.
  - **A separate settings window.** Deferred; hiding native views and using the trusted shell keeps one window and reuses the visibility path.
  - **Clear/delete in-use profiles with automatic pane closure.** Rejected for this slice because it needs a close-and-delete flow and stronger confirmation.
  - **Render cookie/storage values in the manager.** Rejected by security requirements; only metadata and usage are shown.
  - **Delete only metadata and leave partition data.** Rejected; clear runs first and directory removal is best-effort.

- **Consequences:**
  - The dialog is temporarily an opaque workspace overlay; pane websites are hidden while it is open.
  - Users must close panes before clearing or deleting their profile.
  - Duplicate profile labels are rejected case-insensitively.
  - Partition directory removal can be incomplete if Chromium still holds files, but profile data has already been cleared and is no longer reachable.
  - Profile sharing is explicit via ADR-015; close-and-delete was added in ADR-019.

- **Evidence / verification:**
  - Unit tests verify profile rename, duplicate/empty rejection, metadata removal, and reload persistence.
  - E2e opens the manager, verifies native views hide, checks in-use Alice actions are disabled, renames Bob, clears Bob's partition cookies, deletes Bob's profile metadata, and closes the dialog with native views restored aligned.
  - The existing restart test first verifies Bob's retained cookies before the manager clears/deletes the unused profile.

## ADR-013 — Window bounds persist only when safe for the current displays

- **Status:** Accepted; presentation-flag clause superseded by ADR-027
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §11.3 suggests persisting safe application window bounds in `app-state.json`. Restoring stale coordinates can place the window entirely off-screen after a display change, and persisting maximized/fullscreen geometry can produce surprising restores.

- **Decision:**
  1. Store optional normal window bounds (`x`, `y`, `width`, `height`) in `app-state.json`; keep active workspace ID in the same file.
  2. Validate bounds in the shared app-state parser: minimum 720 × 520, maximum 10,000 px width/height, finite positions, rounded integers. Invalid bounds are ignored without discarding the active workspace.
  3. Save normal bounds (`getNormalBounds`) after debounced move/resize/maximize/fullscreen events and immediately before close. Do not persist maximized/fullscreen state. (Presentation restore is superseded by ADR-027.)
  4. On startup, restore bounds only when at least 120 × 80 px intersects a connected display's work area. Otherwise keep the default window.
  5. Capture the workspace file path when a save is queued, so an active-workspace change cannot redirect an older queued write.
  6. Flush pending app-state writes on window close and app quit.

- **Alternatives considered:**
  - **Restore bounds without display checks.** Rejected; windows can become unreachable after monitor changes.
  - **Persist maximized/fullscreen flags.** Rejected for this slice; normal bounds are safer and match the temporary-state guidance.
  - **Clamp all restored windows to the work area.** Deferred; visibility checking avoids off-screen windows without resizing intentional large windows.
  - **Store bounds in workspace JSON.** Rejected; window state is application state, not workspace layout, and may be shared across workspaces.

- **Consequences:**
  - Normal window size/position survives restart when still visible.
  - Off-screen or malformed bounds fall back to the default 1280 × 860 window.
  - Theme preference is handled separately in ADR-016; maximized/fullscreen presentation is now handled by ADR-027.
  - Tests use a distinctive window bound and verify the app-state file plus restored geometry.

- **Evidence / verification:**
  - Unit tests validate accepted/rejected bounds and app-state reload persistence.
  - E2e sets a 1120 × 760 window, waits for `app-state.json`, relaunches, and asserts the restored normal bounds.

## ADR-014 — Workspace switching rebuilds native panes from the versioned store

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §11.1 requires creating, renaming, duplicating, switching, and deleting workspaces. Pane views are native and owned by `BrowserManager`; each workspace has independent pane definitions, profiles, layout, and saved URLs. Keeping multiple workspaces' native views alive would consume memory and complicate focus/z-order.

- **Decision:**
  1. One JSON file per workspace under `workspaces/`; `app-state.json` stores the active workspace ID. Names are validated and unique case-insensitively.
  2. The shell workspace switcher uses typed IPC for list/create/rename/duplicate/switch/delete. Native views are hidden while the dialog is open.
  3. Switching persists current pane definitions/layout, flushes writes, activates the target file, destroys the current `BrowserManager` and its `webContents`, creates a new manager, restores target panes/profiles/layout, then sends a full state refresh.
  4. Duplicating clones URLs/viewports and maps grid/freeform IDs while generating new pane IDs and fresh profiles. Deleting a workspace leaves profiles/partitions for independent profile-manager cleanup.
  5. The active and final workspace cannot be deleted. Creation and rename reject empty/duplicate names.
  6. Renderer layout state resets when `ShellState.workspace.id` changes and reapplies the target layout. Layout saves are rejected while main is switching.
  7. Test hooks resolve the current global manager/store so e2e can inspect a switched workspace.

- **Alternatives considered:**
  - **Keep all workspace views warm.** Rejected for memory/complexity; switching reloads pages.
  - **One combined workspace file.** Rejected; per-workspace files match the spec and isolate corruption.
  - **Renderer-only switching.** Rejected; native view teardown/creation belongs in main.
  - **Delete workspace profiles automatically.** Rejected; profile lifecycle is separate and explicit.
  - **Duplicate using the same profiles.** Rejected by the spec; duplicates receive fresh profiles.

- **Consequences:**
  - Workspace switching has a short teardown/recreation cost and reloads pages.
  - Duplicated workspaces eagerly create fresh profiles, which appear unused until opened.
  - Window bounds remain application-wide rather than per workspace.
  - Workspace imports/exports remain future work; close-and-delete profile flows were added in ADR-019.

- **Evidence / verification:**
  - Unit tests cover workspace create/list/switch/rename/delete, unique names, active/final deletion protection, and reload persistence.
  - E2e creates a second workspace, switches to it, adds a pane, renames it, duplicates it with fresh profiles, switches back to the authenticated original workspace, verifies active-state persistence, deletes the extras, and checks native alignment.

## ADR-015 — Profile sharing is an explicit profile-manager action

- **Status:** Superseded by ADR-062 (Profile sharing removed)
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §9.1 requires fresh profiles by default and permits sharing only when the user explicitly selects an existing profile. Shared status must be visible so it cannot happen accidentally. Profile metadata and pane creation are trusted-shell operations.

- **Decision:**
  1. Keep the toolbar Add pane action fresh-profile-only.
  2. Add **Open pane** to every profile row and a typed `add-pane-with-profile` IPC. Main resolves the profile by validated ID and rejects unknown IDs; it never accepts arbitrary partition names from the renderer.
  3. Shared-profile panes use the same profile ID/partition and therefore share cookies and site storage intentionally.
  4. Pane headers display `· N panes` when more than one pane references the profile. Profile manager usage displays the count and pane titles.
  5. That slice kept clear/delete blocked while any pane referenced the profile; ADR-019 added the confirmed close-panes flow.
  6. The profile manager closes after creating the pane so the new pane can be measured and displayed with other panes.

- **Alternatives considered:**
  - **Profile picker in the main Add pane flow.** Deferred to keep the toolbar compact; the profile manager is the explicit sharing surface.
  - **Duplicate pane with a fresh profile.** Deferred; duplication remains future work.
  - **Share profiles by default when opening the same URL.** Rejected; sharing must be intentional.
  - **Spoof or copy session data between fresh profiles.** Rejected; partitions remain isolated.

- **Consequences:**
  - Sharing is discoverable and labeled but requires opening the profile manager.
  - Shared panes intentionally expose the same cookies/storage; this is not a private mode boundary.
  - Profile clear/delete may require closing multiple panes.
  - Duplicating panes and workspace import/export remain future work.

- **Evidence / verification:**
  - E2e opens two panes with the same unused profile, verifies distinct pane IDs and `2 panes` headers, navigates both to the fixture, writes localStorage in one, reads it from the other, verifies profile-manager usage and clear/delete protection, then closes both panes.
  - Fresh-pane, isolation, session-restart, workspace, and profile-manager tests still pass.

## ADR-016 — Theme preference uses explicit shell tokens plus native chrome

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` requires system appearance plus light/dark themes and suggests a persisted theme preference. Electron `nativeTheme.themeSource` changes native window chrome, but in the tested Electron/Playwright environment it did not reliably propagate `prefers-color-scheme` to pre-created shell renderers.

- **Decision:**
  1. Persist `system`/`light`/`dark` as an optional app-state theme; invalid values fall back to system.
  2. Expose a native **View → Theme** radio submenu. Selection updates `nativeTheme.themeSource`, native window/shell background colors, menu checkmarks, persistence, and shell state.
  3. The shell applies `data-theme="light"` or `data-theme="dark"` with explicit CSS token overrides. `system` removes the attribute and uses the existing `prefers-color-scheme` block.
  4. Theme preference is application-wide, not per workspace. It is applied at startup from app-state without persisting a redundant write.
  5. The shell state carries `theme` so renderer restarts, workspace switches, and menu actions converge on the same preference.

- **Alternatives considered:**
  - **Rely only on `nativeTheme.themeSource` + media query.** Rejected after the tested renderer remained light when the main process reported Dark.
  - **Renderer localStorage.** Rejected; app-state is the validated main-owned persistence layer.
  - **Inject a preload theme class before render.** Deferred; the first state read applies the attribute before interaction.
  - **Per-workspace themes.** Rejected for this slice; theme is application chrome, not workspace content.

- **Consequences:**
  - Light/dark selection is deterministic and testable even if Chromium media propagation fails.
  - CSS token definitions are duplicated for explicit light/dark blocks; the system media block remains the default.
  - Native titlebar/chrome and shell tokens stay synchronized through the same preference.
  - Theme is not restored per workspace.

- **Evidence / verification:**
  - Unit tests validate theme parsing and workspace-store persistence.
  - E2e selects Dark via the native menu, verifies `app-state.json` and dark shell tokens, restarts the app, confirms Dark restores, and resets to System.
  - Existing light/dark token emulation checks still pass.

## ADR-017 — Unsigned arm64 packaging precedes Developer ID notarization

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Phase 4 needs a runnable macOS artifact. The local machine has only an Apple Development certificate, no Developer ID Application certificate or notarization credentials. The owner selected PaneFlow 0.1.0, bundle ID `com.kanharithsok.paneflow`, arm64-only, MIT, and a generated icon. Signing/notarization must not block local verification.

- **Decision:**
  1. Use `electron-builder` 26.18.0 with a checked-in `electron-builder.yml`.
  2. Package PaneFlow 0.1.0 for arm64 with `com.kanharithsok.paneflow`, developer-tools category, asar, and `build/icon.icns`.
  3. Build DMG + ZIP plus an unpacked app under ignored `dist/`.
  4. Disable signing with `identity: null` for this slice; do not claim the artifacts are signed, notarized, or safe for frictionless distribution.
  5. Keep the icon SVG source under `build/` and generate the `.icns` locally with macOS tooling.
  6. Add an MIT license and matching package metadata.
  7. Document Developer ID certificate, notarytool credentials, hardened runtime, stapling, and release-channel decisions as prerequisites for distribution.

- **Alternatives considered:**
  - **Wait for Developer ID credentials.** Rejected; local packaging and launch checks are independently useful.
  - **Ad-hoc sign only.** Electron already produces an ad-hoc/linker-signed bundle; explicit identity remains null.
  - **Universal build.** Deferred by owner choice; arm64 keeps artifacts smaller.
  - **Electron Forge instead of builder.** Rejected for this slice; builder already handles DMG/ZIP and arm64 targets with concise config.
  - **Commit generated DMG/ZIP.** Rejected; artifacts and local profile data must stay out of Git.

- **Consequences:**
  - Local artifacts launch, but Gatekeeper may block them on other machines.
  - Signing/notarization remains a credential-gated release task.
  - The package is arm64-only.
  - Version/name/bundle ID/license are now fixed for 0.1.0 packaging.
  - `dist/` stays ignored and no release publishing/auto-update exists.

- **Evidence / verification:**
  - `npm run package:mac` produced `PaneFlow-0.1.0-arm64.dmg` (118 MB), ZIP (115 MB), and a 273 MB `.app`.
  - `file` reports an arm64 binary; `Info.plist` reports the expected bundle ID, version, icon, and category; `codesign` shows unsigned/ad-hoc as configured.
  - The packaged app launched, rendered the shell and panes, and quit cleanly.

## ADR-018 — Leak stress checks webContents and native-view counts across switches

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Workspace switching destroys and recreates native `WebContentsView` instances. A failure to close old views would leak renderer processes, file handles, and memory. Automated memory thresholds are noisy across machines, but exact ownership counts are deterministic.

- **Decision:**
  1. Expose a read-only test hook counting all non-destroyed Electron webContents.
  2. Create a four-pane stress workspace once, then perform one initial and three round-trip switches to the authenticated original workspace.
  3. After each return, assert the webContents count equals the baseline and native view states equal the active pane count.
  4. Assert four stress-workspace native views are present during each activation.
  5. Delete the stress workspace at the end; leave deeper memory/CPU profiling to a separate benchmark slice.

- **Alternatives considered:**
  - **Assert RSS/working-set thresholds.** Rejected as flaky across OS/Electron/GPU states.
  - **Long-duration soak test in e2e.** Deferred; too slow for the integration suite.
  - **Only count pane records.** Rejected; pane records can disappear while native webContents/views leak.
  - **Skip stress after workspace tests.** Rejected; switching is the highest-risk teardown path.

- **Consequences:**
  - Regressions in view/webContents teardown fail deterministically.
  - The test does not prove long-term memory stability or loaded-page performance.
  - The stress workspace creates four additional profiles retained after workspace deletion (profile-manager cleanup remains explicit).

- **Evidence / verification:**
  - E2e passes the four-cycle stress and keeps webContents/native-view counts at baseline.
  - Existing eight-pane alignment, profile, workspace, restart, and packaging checks remain green.

## ADR-019 — Clearing/deleting an in-use profile requires closing its panes

- **Status:** Superseded by ADR-062 (Profile manager removed)
- **Date:** 2026-11-19
- **Context:** `SPEC.md` allows deleting an active profile only through a confirmed flow that closes panes using it. Disabling Clear/Delete forced users to find and close every pane manually and did not satisfy the lifecycle requirement.

- **Decision:**
  1. Keep Clear/Delete enabled for in-use profiles.
  2. Confirmation names the exact pane count and offers **Close panes & clear** or **Close panes & delete**.
  3. Main receives an explicit `closePanes` boolean, closes all matching `BrowserManager` panes, verifies usage is empty, then clears session data and optionally removes metadata/partition.
  4. No panes are closed unless the user confirms the close-panes action.
  5. Pane destruction emits one state refresh; the manager list refreshes after the operation and reports that panes were closed.
  6. The existing unused-profile flows remain unchanged.

- **Alternatives considered:**
  - **Keep disabling actions.** Rejected; fails the required close-and-delete flow.
  - **Close panes automatically on first click.** Rejected; destructive actions need confirmation.
  - **Delete metadata before closing panes.** Rejected; session/view teardown should happen first.
  - **Separate close-all UI.** Rejected; combining confirmation and lifecycle keeps the profile context clear.

- **Consequences:**
  - Users can clear/delete profiles without manually locating every pane.
  - Confirmation is destructive and precise about pane count.
  - Closing a profile used by many panes can remove a large part of the workspace after explicit confirmation.
  - If pane teardown somehow leaves usage non-empty, the operation aborts before clearing data.

- **Evidence / verification:**
  - E2e shares one profile between two panes, opens the manager, confirms Close panes & delete, verifies both panes disappear, the profile row is removed, Alice remains, and native alignment restores.
  - Existing unused-profile clear/delete and in-use rename/open-pane checks still pass.

## ADR-020 — Duplicate pane uses a fresh profile

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` requires duplicating a pane to copy URL and viewport settings while creating a fresh profile by default. No duplication action existed.

- **Decision:**
  1. Add `duplicatePane(paneId)` to BrowserManager and typed IPC.
  2. Create a fresh profile via ProfileStore, then create a new pane with the source URL and copied viewport settings.
  3. Expose **Duplicate Pane** in the native Pane menu (`CmdOrCtrl+D`) and the pane context menu.
  4. Route the app-menu command through the active pane; context-menu duplication acts on its source pane.
  5. Do not copy cookies, storage, custom titles, or session data. Sharing remains explicit through the profile manager.

- **Alternatives considered:**
  - **Copy the source profile.** Rejected; duplication defaults to fresh isolation.
  - **Duplicate only from the toolbar.** Rejected; active-pane menu and context action are more direct.
  - **Copy page history/session state.** Rejected; only URL/viewport are required and safe.
  - **Duplicate custom pane titles.** Deferred; titles remain page-derived.

- **Consequences:**
  - Duplication cannot accidentally share authentication.
  - The duplicate loads the URL in a new profile, so signed-in state is not copied.
  - Viewport and URL stay aligned with the source.
  - A dedicated header button is not added; menu/context menu are the discoverable surfaces.

- **Evidence / verification:**
  - E2e selects Alice, invokes Pane → Duplicate Pane, verifies three panes, a fresh profile, matching URL/viewport, then closes the duplicate and returns to two panes.
  - Existing menu, profile, workspace, and native alignment checks remain green.

## ADR-021 — Workspace transfer files exclude profiles and imports get fresh identities

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` allows workspace import/export only for configuration, never cookies/credentials, and requires fresh isolated profiles on import. Imported files are untrusted and need strict validation.

- **Decision:**
  1. Use a separate versioned `paneflow-workspace` JSON format, not the internal workspace file.
  2. Export only workspace name, pane URLs, viewport settings, and index-based layout. Strip pane/profile IDs, profile records, cookies, storage, session data, paths, and executable content.
  3. Export through a native Save dialog with atomic JSON writing; the default filename is sanitized.
  4. Import through a native Open dialog with a 1 MB limit and strict validation of format/version, name, URL schemes, viewport settings, pane-index order, and normalized freeform geometry.
  5. Generate fresh profiles and pane IDs on import; map layout indices to new IDs, ensure a unique imported name, and create the workspace inactive.
  6. Keep transfer/materialization logic in a pure shared module and unit-test it; native dialog orchestration stays in main.

- **Alternatives considered:**
  - **Export internal workspace JSON directly.** Rejected; it contains profile IDs and internal paths/schema.
  - **Restore profile IDs/sessions on import.** Rejected by isolation and secret-handling requirements.
  - **Trust the file and let store validation catch issues later.** Rejected; import validates before creating profiles or writing state.
  - **Import as the active workspace immediately.** Rejected; creating inactive lets the user review before switching.
  - **Commit exported files/fixtures.** Rejected; transfer files remain user data.

- **Consequences:**
  - Imported workspaces preserve layout/URLs/viewports but require sign-in again.
  - Invalid or oversized imports fail without creating profiles/workspaces.
  - Native dialogs are not covered by e2e; pure logic is comprehensively unit-tested.
  - Exporting is limited to the active workspace in the current UI.

- **Evidence / verification:**
  - Five unit tests cover serialization, profile stripping, JSON round-trip, fresh-ID materialization, unsafe URLs/viewports, invalid order/freeform geometry, and mapping errors.
  - Build/typecheck/lint/e2e remain green; no native dialog automation is claimed.

## ADR-022 — Workspace shortcuts call the existing main-process switch path

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Phase 4 added the remaining useful keyboard shortcuts. Workspace switching is not a pane command: it persists the current workspace, tears down every native pane, loads another workspace, recreates views, and persists the active ID. Keyboard access must work when focus is inside a remote native page, and overlapping switches could corrupt active-workspace state.

- **Decision:**
  1. A native **Workspace** menu owns **Next Workspace** (`CmdOrCtrl+Shift+]`) and **Previous Workspace** (`CmdOrCtrl+Shift+[`), with stable IDs `workspace-next` and `workspace-previous`.
  2. Menu clicks resolve the neighboring workspace from a pure shared helper in deterministic name order with wraparound, then call the existing trusted `switchWorkspaceTo` path. No new IPC channel or renderer key handler is added.
  3. `switchWorkspaceTo` rejects overlapping switches while allowing one in-flight operation to finish; menu actions are disabled during a switch and while no window/store is available.
  4. Menu enablement is refreshed after startup, create/import/duplicate/delete/switch, and is enabled only when at least one other workspace exists. Async refreshes use a token so a stale read cannot re-enable a menu during a switch.
  5. New workspace state is sent to the shell only after the switch lock and menu state settle, so the UI and menu agree.
  6. Raw accelerator chords and the native menus stay available regardless of whether focus is in the shell or a remote pane.

- **Alternatives considered:**
  - **Renderer `keydown` handlers.** Rejected; native pane focus bypasses the shell.
  - **Reuse `PaneCommand`.** Rejected; it targets the active pane and cannot carry workspace-switch lifecycle safely.
  - **`globalShortcut`.** Rejected; it steals keys system-wide.
  - **One menu item per workspace.** Deferred; next/previous covers the request without unbounded menu growth.
  - **Recent-use ordering.** Rejected; only update timestamps exist, and name order is stable and predictable.

- **Consequences:**
  - Workspace cycling order is alphabetical by name, not user-defined.
  - Switching still reloads target workspace pages because native views are recreated.
  - Native menu state must be refreshed after workspace lifecycle mutations.
  - The menu shortcuts are discoverable and usable from native pane focus.

- **Evidence / verification:**
  - Three unit tests cover next/previous selection, wraparound, input-order stability, and unavailable targets.
  - E2e reads both menu items (IDs, accelerators, disabled initially), creates workspaces, invokes the real menu items in both directions across three workspaces, verifies each target's pane IDs/profiles/URLs and native alignment, then confirms both items disable after returning to one workspace.

## ADR-023 — The shell loads from a secure custom protocol with an environment-specific CSP

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §13.2 prefers a secure custom application protocol over broad `file://` access, and Phase 4 packaging made that decision actionable. The shell CSP also allowed localhost HTTP/WebSocket sources in every build because development HMR and production shared one static policy.

- **Decision:**
  1. Register `paneflow` as a standard, secure, non-CORS scheme before app readiness. Register it as privileged only for normal fetch/stream behavior; no service workers, extensions, CSP bypass, or CORS.
  2. Serve built renderer files through `protocol.handle('paneflow', …)` from `paneflow://shell/index.html`. Resolve only paths inside the built renderer root, reject traversal/backslash/null/ambiguous segments, set explicit MIME types, and add `nosniff`, no-referrer, no-store, and CSP headers.
  3. Build CSP in the pure `src/shared/shell.ts` module. Production uses `connect-src 'self'` with no development sources. Development adds only the exact loopback `ELECTRON_RENDERER_URL` origin and its matching `ws:`/`wss:` URL.
  4. Keep inline styles allowed because Vue binds pane geometry through inline style attributes. Never allow inline script, eval, objects, frames, forms, or base changes.
  5. Remove the static CSP meta tag so there is one authoritative, mode-correct policy.

- **Alternatives considered:**
  - **Keep `file://` and tighten the meta tag.** Rejected: production and development need different policies, file origins are broad, and header enforcement is more reliable.
  - **Keep the development CSP in production.** Rejected: a compromised shell could exfiltrate to localhost services.
  - **Allow inline script to simplify development.** Rejected: it weakens the primary XSS boundary.

- **Consequences:**
  - The shell is served from a narrow, same-origin custom scheme and cannot read outside its renderer bundle.
  - Production has no network destination beyond itself; development has one exact loopback exception.
  - The e2e test can prove inline script and cross-origin fetch are blocked.
  - `style-src 'unsafe-inline'` remains a documented, deliberate exception.

- **Evidence / verification:**
  - Unit tests cover production/development CSP construction, malformed development URLs, trusted shell document matching, and asset path traversal/MIME handling.
  - E2e observes `paneflow://shell/index.html`, blocks an inline script, blocks a fixture fetch from the shell, and completes the full existing browser/workspace suite.

## ADR-024 — IPC sender checks include the trusted document URL

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** IPC handlers already compared the event sender `WebContents` and main frame with the shell. Shell navigation is denied, but a future regression that navigates the shell to remote content would still share the same `WebContents` and main frame. The manual checklist also had no direct cross-sender test.

- **Decision:**
  1. Validate sender `WebContents`, main frame, and document URL. Production accepts only `paneflow://shell/index.html`; development accepts only the validated loopback dev-server origin.
  2. Return an empty default `ShellState` for unauthorized state reads rather than leaking workspace metadata.
  3. Keep payload validation in every handler; sender validation is not a substitute.
  4. Add a test-only e2e path that creates a separate node-enabled `BrowserWindow` in the same Electron process and invokes IPC directly. It must receive an empty state and `Unauthorized sender.` for a pane command.

- **Alternatives considered:**
  - **Rely on `WebContents` identity alone.** Rejected as fragile against future navigation changes.
  - **Throw on unauthorized `get-state`.** Rejected because returning a harmless empty state is simpler and avoids exposing data.
  - **Inject a preload into a real remote pane for testing.** Rejected; it would weaken the tested production boundary.

- **Consequences:**
  - A same-process webContents with direct `ipcRenderer` access cannot invoke shell operations.
  - The sender URL check is part of the durable boundary and can be unit-tested independently.

- **Evidence / verification:**
  - Unit tests cover production and development trusted-document matching.
  - E2e creates the separate sender, confirms empty state, and confirms the unauthorized pane command error.

## ADR-025 — Unsigned local packages apply Electron fuses but remain unsigned

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** `SPEC.md` §13.6 requires reviewing Electron fuses for packaging. The MVP still has no Developer ID certificate or notarization credentials, and the build must remain locally packageable without paid-account work.

- **Decision:**
  1. Configure `electronFuses` in `electron-builder.yml`: disable `RunAsNode`, Node options, inspector arguments, and `file://` extra privileges; enable embedded ASAR integrity validation and only-load-from-ASAR; reset the ad-hoc Darwin signature after flipping fuses.
  2. Keep `identity: null`, `hardenedRuntime: false`, and `gatekeeperAssess: false` for unsigned local builds.
  3. Read the packaged fuses back with `npx electron-fuses read --app …` and record the result.
  4. Do not enable cookie encryption at rest until a signed-distribution build can be verified with Keychain behavior. Document this gap.

- **Alternatives considered:**
  - **Wait for signing before applying fuses.** Rejected; the fuses harden local builds immediately and are not paid-account work.
  - **Enable every fuse including cookie encryption.** Deferred; unsigned ad-hoc builds have unverified Keychain behavior.
  - **Leave defaults.** Rejected; it would permit Node CLI modes and non-ASAR code loading.

- **Consequences:**
  - The packaged app must load from `app.asar`; the shell protocol reads its assets through the asar-aware filesystem.
  - Node debugging/environment override paths are unavailable in packaged builds.
  - Local artifacts still trigger Gatekeeper warnings on other machines and are not notarized.

- **Evidence / verification:**
  - `npm run package:dir` succeeds with fuse application.
  - `electron-fuses read` reports the expected fuse states.
  - A fresh packaged app launch with an isolated `HOME` and remote debugging reported the shell at `paneflow://shell/index.html`, proving the ASAR-backed custom protocol works with fuses enabled. See `SECURITY.md` and the Phase 4 report.

## ADR-026 — macOS uses a hidden-inset title bar with the toolbar as the drag region

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** The default macOS title bar adds a separate 28 px chrome strip that duplicates the app identity above PaneFlow's compact toolbar. The product direction calls for quiet, minimal chrome while preserving standard macOS window controls.

- **Decision:**
  1. Set `titleBarStyle: 'hiddenInset'` on macOS and position the traffic lights at `(16, 16)` inside the 46 px toolbar.
  2. Let the shell `WebContentsView` fill the full window content bounds; no separate title-bar view is added.
  3. Make the toolbar the window drag region with `-webkit-app-region: drag`, and mark buttons, selects, and their wrappers `no-drag`.
  4. Reserve 84 px at the toolbar's leading edge so content never sits under the traffic lights.
  5. Keep the default native frame on non-macOS platforms until their own window-chrome design is implemented.

- **Alternatives considered:**
  - **`frame: false` with custom HTML window controls.** Rejected; reimplementing close/minimize/zoom would duplicate native behavior and reduce accessibility.
  - **Keep the default title bar.** Rejected; it adds a redundant chrome row and conflicts with the compact toolbar.
  - **`titleBarStyle: 'hidden'`.** Rejected in favor of `hiddenInset`, which gives the intended inset traffic-light placement.
  - **Make the whole window draggable.** Rejected; native pane interactions and shell controls must keep their pointer behavior.

- **Consequences:**
  - The shell and toolbar extend to the top of the window; native pane bounds are unaffected because they are measured relative to shell content.
  - Toolbar interactive controls must remain `no-drag`, or they will not receive clicks.
  - Future Windows/Linux chrome needs a separate platform-specific decision.
  - The native window title remains available to the OS and menus even though it is not painted in the content area.

- **Evidence / verification:**
  - E2e asserts content bounds equal window bounds, traffic lights report `{ x: 16, y: 16 }`, the toolbar computed `-webkit-app-region` is `drag`, the brand starts at least 76 px from the leading edge, and the toolbar does not overflow at 760 px.
  - A macOS window capture confirmed the traffic lights sit inside the toolbar without overlapping the brand or workspace switcher.

## ADR-027 — Restore maximized and full-screen window presentation after safe bounds

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** ADR-013 persisted normal window position and size but deliberately left maximized/full-screen state unpersisted. Users closing a maximized or full-screen window expect it to reopen in that state, not merely at the old normal bounds.

- **Decision:**
  1. Store optional `maximized` and `fullScreen` booleans beside `windowBounds` in `app-state.json`.
  2. Save the complete window snapshot — normal bounds plus presentation flags — after debounced move/resize/maximize/unmaximize/full-screen events and immediately before close.
  3. On startup, apply the validated normal bounds first. Restore full-screen or maximized state only when those bounds remain visible on a connected display.
  4. Clear the stored presentation flags when the window returns to normal state.
  5. Do not persist minimized or focused state.

- **Alternatives considered:**
  - **Always reopen at the normal window size.** Rejected; it ignores the user's last visible state.
  - **Persist raw maximized/full-screen bounds.** Rejected; those bounds are display-dependent and unsafe after monitor changes.
  - **Restore minimized state.** Rejected; launching into a hidden window is surprising.
  - **Restore presentation even when bounds are off-screen.** Rejected; fall back to a safe normal window instead.

- **Consequences:**
  - Window position, size, maximized state, and full-screen state survive a normal quit or window close when the display layout is still valid.
  - Off-screen bounds discard both the saved position and presentation flags.
  - Pane maximize remains temporary renderer state; this ADR applies only to the application window.

- **Evidence / verification:**
  - Unit tests cover parsing, persistence, clearing, and invalid presentation values.
  - E2e maximizes a window, verifies app-state, relaunches, asserts maximized restoration, then unmaximizes and verifies the flags clear.
  - A focused relaunch script verified full-screen persistence, restoration, and clearing.

## ADR-028 — Fixed viewports always fit the pane frame

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** PaneFlow exposed a per-pane `fit`/`actual` display-scale selector. The product requirement is now simpler: every pane's website should always fit its pane content, including after window, grid, freeform, or maximize resizing. Keeping `actual` as a persisted mode with no visible control would leave some panes clipped and inconsistent.

- **Decision:**
  1. Remove `displayScale` from `PaneViewport` and remove the header selector.
  2. Fixed viewport presets and custom dimensions always use the fit scale: `min(availableWidth / width, availableHeight / height)`, clamped to the existing safe range.
  3. Recompute the scale from the current native view bounds on every bounds update; the existing `setBounds` path re-applies emulation.
  4. Responsive panes continue to disable emulation and use the pane content size directly.
  5. Accept legacy workspace and transfer records containing `displayScale` but ignore the value, so existing files migrate to always-fit without a schema break.

- **Alternatives considered:**
  - **Keep `actual` hidden and persisted.** Rejected; it would still produce clipped pages with no way to change the mode.
  - **Require a workspace version migration.** Rejected; ignoring the obsolete field is simpler and preserves existing files.
  - **Width-only scaling to fill the frame.** Rejected; it would crop height and break the guarantee that the whole viewport is visible.
  - **CSS transforms in the renderer.** Rejected; pane content is a native `WebContentsView` and must be scaled through Electron device emulation.

- **Consequences:**
  - Fixed viewports always show the complete emulated page, with letterboxing when aspect ratios differ.
  - The pane header has one fewer control and remains simpler at narrow widths.
  - Existing `displayScale: 'actual'` values silently become fit; the obsolete field is no longer written.
  - There is no actual-size/overflow mode for users who want a 1:1 clipped viewport.

- **Evidence / verification:**
  - Unit tests cover preset parsing, legacy `displayScale` values becoming fit, fit-scale math, and recomputation for different available sizes.
  - E2e selects mobile and custom viewports, verifies the scale is below 1, narrows the grid to five columns, verifies the fit scale decreases and matches the new native bounds, restores two columns, and verifies the original scale returns.

## ADR-029 — Add-pane device picker uses a native menu and validated viewport creation

- **Status:** Superseded by ADR-037
- **Date:** 2026-11-19
- **Context:** The add-pane action always created a responsive pane. Users want to create a pane directly at a common device/viewport size. A DOM dropdown anchored to the toolbar would extend over native `WebContentsView` content, where the shell cannot draw or receive clicks. A permanent select would add unnecessary chrome and duplicate the primary add action.

- **Decision:**
  1. Keep the primary Add pane button for the default responsive pane and add a compact chevron button as a split control.
  2. Open a native `Menu.popup` from the chevron with Responsive plus the existing mobile, tablet, laptop, and desktop presets. Use viewport-class labels and dimensions, not device-brand names.
  3. Return the selected preset to the renderer; the renderer calls the typed `paneflow:add-pane-with-viewport` operation rather than creating the pane inside the menu callback.
  4. Validate the viewport again in main, create a fresh browser profile, and create the pane with that viewport.
  5. Keep the existing menu and keyboard Add pane action as the responsive default.

- **Alternatives considered:**
  - **DOM dropdown in the toolbar.** Rejected; it would be covered by native pane views as soon as it extended below the toolbar.
  - **Permanent select control.** Rejected; it adds toolbar density and makes the add action less obvious.
  - **Create the pane directly from the native menu callback.** Rejected; errors would bypass the renderer's action-error surface and the normal focus/state update path.
  - **Device-brand/model names.** Rejected; SPEC §10 requires honest viewport-class labels without physical-device claims.

- **Consequences:**
  - Selecting a menu item takes one additional typed IPC round trip to create the pane.
  - The native menu itself is not directly automatable through Playwright; the renderer control, main validation, and creation-with-viewport path are covered by e2e.
  - New panes still receive isolated profiles and persist their selected viewport normally.

- **Evidence / verification:**
  - E2e verifies the toolbar device button is present and accessible, rejects an unknown preset, creates a pane with the mobile 390 × 844 DPR 3 preset, verifies the new pane's viewport and fit emulation, and closes it cleanly.

## ADR-030 — Website panes follow the effective app appearance through CDP media emulation

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** The app-wide appearance preference already persisted System/Light/Dark and updated native chrome and shell tokens. Remote `WebContentsView` pages did not follow it: in Electron 45 on this machine, changing `nativeTheme.themeSource` or reloading a pane left `prefers-color-scheme` unchanged. The shell also remained light in System mode because its media query did not reliably receive the OS appearance.

- **Decision:**
  1. Add an Appearance menu button to the toolbar. It opens a native radio menu (System, Light, Dark) because a DOM popover would extend over native pane views.
  2. Keep `nativeTheme.themeSource` as the source of truth for window chrome and persistence, and expose a resolved `light`/`dark` value in shell state. The shell always applies an explicit `data-theme`, including System mode.
  3. For every browser pane, attach Electron's debugger and send `Emulation.setEmulatedMedia` with the resolved `prefers-color-scheme`. Apply it on pane creation, load completion, navigation, load, and theme changes.
  4. When the preference is System, reapply the resolved scheme when `nativeTheme` reports an OS appearance change. Never reload panes to apply a theme.
  5. Set each native view's background color to match the scheme so transparent pages do not flash the wrong surface.

- **Alternatives considered:**
  - **Rely only on `nativeTheme.themeSource`.** Rejected; it did not update existing or newly created remote renderers in the tested environment.
  - **Reload all panes on theme change.** Rejected; it loses page state and makes appearance switching disruptive.
  - **Inject CSS or classes into remote pages.** Rejected; it cannot change the `prefers-color-scheme` media query that sites actually read.
  - **Keep System mode on the CSS media query.** Rejected; the shell and panes could disagree with native chrome.
  - **Per-pane theme overrides.** Not introduced; appearance remains application-wide.

- **Consequences:**
  - Panes receive a real media-query change without reloading; pages that deliberately force a color scheme may still look unchanged.
  - The app keeps a debugger attached to each pane for color-scheme emulation. Pane DevTools still opens in a separate window; if another debugger client detaches the app's debugger, the scheme is reattached on the next load or theme change.
  - Shell theme styling is deterministic and no longer depends on Chromium media propagation.
  - The resolved theme is part of the shell state contract.

- **Evidence / verification:**
  - E2e selects Dark from the native menu, verifies shell tokens and persistence, and verifies `matchMedia('(prefers-color-scheme: dark)')` becomes true inside a loaded pane without reloading it. It repeats the pane check after restart.
  - The appearance button's accessible name and menu semantics are covered by the accessibility e2e; selecting items from the native menu remains a manual GUI check.

## ADR-031 — Pane chrome preview modes are an app-wide temporary comparison

- **Status:** Accepted for preview
- **Date:** 2026-11-19
- **Context:** The current two-row pane header is denser than the desired minimal direction. Three alternatives need comparison in the running app before choosing one: A (quiet single-row bar), B (Figma-like canvas label), and C (global browser bar). C cannot be mixed per pane because the address and navigation belong to the active pane.

- **Decision:**
  1. Add a temporary app-wide pane-chrome preference with A as default, persisted in shell localStorage under a preview-only key.
  2. Offer A/B/C under the Add pane chevron's native menu, labeled “Pane chrome preview (all panes)”, so the comparison is available when creating panes. New panes use the current style.
  3. A keeps title, profile, compact URL, viewport, navigation, and actions in one wrapping row that becomes two rows at narrow widths.
  4. B shows only title/profile/viewport while a pane is inactive and reveals navigation, address, and viewport when it becomes active.
  5. C moves address, navigation, active-pane context, and the active viewport control into a global bar; pane headers keep title/profile and actions, with viewport labels on inactive panes only.
  6. Keep A as the default for the existing e2e and accessibility baseline. The chosen final style will replace this preview switch and the unused modes.

- **Alternatives considered:**
  - **Per-pane A/B/C selection.** Rejected; C is a global navigation model and mixing it with per-pane address bars would be incoherent.
  - **DOM chrome picker.** Rejected; it would be covered by native pane views.
  - **Ship all three permanently.** Rejected; this is a design comparison, not a product feature.

- **Consequences:**
  - The renderer temporarily carries three chrome layouts and a preview-only storage key.
  - The Add pane menu now has a second, non-creation section; selecting a chrome style changes every pane without adding one.
  - The final cleanup should remove the switch, localStorage key, and unused variants.
  - Native menu item selection is not automatable through Playwright, so the switch itself needs a manual GUI pass.

- **Evidence / verification:**
  - `npm run typecheck`, `npm run lint`, unit tests, and the default-A e2e suite pass.
  - Rendered all three variants against the same two-pane workspace and checked header height, wrapping, active/inactive behavior, and the C global bar.
  - The Add pane/Appearance native menu interactions remain manual GUI checks.

## ADR-032 — Canvas layout uses snapshot-assisted native panning

- **Status:** Accepted for first Canvas slice
- **Date:** 2026-11-19
- **Context:** Responsively and Figma present a clean infinite canvas with a dotted backdrop and world-space pan/zoom. Figma renders the editor scene itself in WebGL; Responsively transforms DOM `<webview>` elements inside a CSS-transformed world. PaneFlow uses native `WebContentsView`s for remote pages, which cannot be CSS-transformed or clipped by the shell, and cannot be overlaid with DOM chrome. A direct copy would either break the native security/session architecture or let pane content slide under the toolbar.

- **Decision:**
  1. Add Canvas as a third layout alongside Grid and Freeform.
  2. Store per-pane world positions in `WorkspaceLayout.canvas`; derive frame size from the pane viewport (560 × 700 for responsive, exact dimensions for fixed/custom viewports) plus a 32px label row.
  3. Draw a 20px radial-gradient dot field in the workspace; move its background position with the pan offset.
  4. Pan by dragging empty canvas. A Hand tool hides all native views and lets the user pan from anywhere. The pan offset is transient viewport state, not persisted.
  5. While panning or using the Hand tool, hide native views and show recent in-memory JPEG snapshots. On release, restore live native views for frames fully inside the workspace; partially visible frames remain snapshots.
  6. Clicking a partially visible frame centers it and restores its native view.
  7. Use the existing active-pane controls in the top toolbar and compact per-pane labels in Canvas mode.
  8. Drag a pane's header/label area to move that pane in world coordinates. Website content stays in the native view and keeps normal page interaction; dragging content does not move the frame or canvas.
  9. Defer device bezels and frame resizing. Canvas zoom is covered by ADR-033.

- **Alternatives considered:**
  - **Use `<webview>`/iframes to get a live CSS-transformed world.** Rejected; violates the accepted native-view architecture and weakens security.
  - **Keep native views visible while panning.** Rejected; they cannot be clipped by the workspace and would cover the toolbar or disappear at edges.
  - **Render live page pixels into a canvas.** Rejected; no supported lossless interactive path for `WebContentsView` content.
  - **Clamp panning so all panes stay visible.** Rejected; it is not an infinite canvas.
  - **Add zoom immediately.** Deferred; native view scaling and clipping need a separate native-emulation proof.

- **Consequences:**
  - Panning previews are visual snapshots; pages are not interactive during the gesture.
  - Snapshots can be stale until the next capture (canvas entry, pan end, or explicit refresh).
  - Fully visible panes remain live native views; partially visible panes are visual-only until centered.
  - Canvas positions survive restart; pan position resets.
  - The canvas does not yet match device bezels or live interaction during motion. Zoom and the temporary Space hand tool are covered by ADR-033.

- **Evidence / verification:**
  - Unit tests cover frame sizing, default row arrangement, canvas position validation, workspace normalization, and persistence.
  - E2e switches to Canvas, checks the dotted workspace and global bar, verifies native views hide during a pan and restore afterward, verifies Hand-tool hiding, and switches back to Grid.
  - `npm run test:e2e` passes with the Canvas step; snapshots are captured for both fixture panes.

## ADR-033 — Canvas zoom uses device emulation and Space is a temporary Hand tool

- **Status:** Accepted; zoom range and controls superseded by ADR-038
- **Date:** 2026-11-19
- **Context:** Canvas panning works, but users need Figma/Responsively-style temporary hand navigation and wheel zoom. Native `WebContentsView`s cannot be CSS-transformed. A naive wheel handler also moved the canvas and snapshots without hiding native views, leaving live page content at stale screen positions.

- **Decision:**
  1. Holding Space while shell chrome has focus temporarily enables the Hand tool; releasing Space restores the previous manual Hand state. The Hand button remains available.
  2. In Canvas mode, wheel panning uses a short hide/measure gesture: hide native views, move the shell world, then restore fully visible native views after wheel idle. This prevents native content drift.
  3. While the Hand tool is active, wheel input zooms between 50% and 200% around the cursor. Ctrl/Cmd+wheel also zooms outside Hand mode.
  4. Pane frames, positions, and snapshots scale in the shell. Main receives the zoom through `paneflow:set-canvas-zoom`; responsive panes use fixed 560 × 700 device emulation at that scale, while fixed/custom viewports derive their fit scale from the scaled native bounds.
  5. A toolbar percentage resets zoom to 100% around the workspace center.
  6. Zoom and pan are viewport state, not workspace state. Pane positions remain persisted.

- **Alternatives considered:**
  - **CSS-transform native views.** Rejected; native views cannot follow a shell transform.
  - **Use `webContents.setZoomFactor`.** Rejected; it changes the CSS viewport and responsive breakpoints.
  - **Snapshot-only zoom.** Rejected as the default; live native views are restored whenever a frame fits fully.
  - **Keep all panes interactive while partially visible.** Rejected; native views cannot be clipped to the workspace.
  - **Intercept Space in remote pages.** Rejected; it would break spaces in website text fields.

- **Consequences:**
  - Zoom persists until reset or leaving/re-entering the workspace; it is not saved.
  - At zoom levels where a frame cannot fit fully inside the workspace, its live native view is hidden and the snapshot remains. This is most visible when zooming in.
  - Space only works while shell chrome has focus; a focused website keeps normal keyboard behavior.
  - Wheel panning now briefly replaces pages with snapshots, fixing stale native content after a moved pane.
  - Canvas positions remain stable in world coordinates while zoom changes.

- **Evidence / verification:**
  - E2e holds Space, verifies the Hand class and hidden native views, wheel-zooms out, verifies the page CSS viewport stays 560 × 700 while pane emulation scale drops below 1, resets zoom, and verifies emulation disables.
  - E2e wheel-pans and verifies visible native bounds realign with the DOM after the gesture.
  - Existing content-interaction, pane-header drag, background pan, and Hand-tool checks continue to pass.

## ADR-034 — Canvas overview is a persistent native minimap

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Users can pan or zoom far enough to lose every pane. The shell is a `WebContentsView` beneath live pane views, so ordinary DOM cannot float above them. A modal overview is safe but requires a reveal action and temporarily hides live pages.

- **Decision:**
  1. Add a small trusted `WebContentsView` rendered from `minimap.html` and pinned to the bottom-right above pane views. Show it whenever Canvas mode is active; no reveal button. Hide it while the Profiles or Workspaces dialog is open.
  2. Include both pane bounds and viewport bounds in the projection, so distant panes remain visible after panning far away. Draw the viewport as a dashed outline.
  3. Selecting a frame centers and focuses that pane; selecting empty map space recenters the world point there. Add **Fit all panes** to the minimap header and keep it in the top toolbar.
  4. Adapt the panel width between 168 and 208 px as the window narrows. Let the panel collapse to a compact header and expand again; the collapsed header stays visible.
  5. Keep the minimap above native views through the native child order. Do not hide covered pane views or swap them for snapshots; pane content remains live outside the minimap rectangle.
  6. Validate the shell and minimap senders separately. Projection state flows shell → main → minimap; focus/recenter/fit actions flow minimap → main → shell. Main returns focus to the shell after an action so Space and other shell shortcuts keep working.
  7. Keep viewport pan/zoom transient. The collapse state is session-local and no persistence format changes.

- **Alternatives considered:**
  - **DOM overlay plus hiding intersecting native views.** Rejected; it loses live content under the panel and adds snapshot bookkeeping to a persistent control.
  - **Modal overview.** Rejected; recovery takes an extra action and the live pages disappear.
  - **Persistent side dock.** Rejected for the minimal layout; it shrinks the canvas and shifts every pane.
  - **Native menu listing panes.** Rejected; it provides no spatial preview.
  - **Fit-only control with no map.** Rejected; users still need to understand where panes went.

- **Consequences:**
  - The panel occupies a small bottom-right area and intercepts input there; panes remain live elsewhere.
  - The window owns one extra persistent webContents that is not part of pane lifecycle or workspace persistence.
  - Fit all may change pan and zoom; it does not modify world positions.
  - The minimap must be handled separately during window close, resize, and theme changes.

- **Evidence / verification:**
  - Unit tests cover frame projection, viewport inclusion, far-away viewport bounds, adaptive panel sizing, state validation, and every action payload.
  - E2e verifies the minimap is already visible in Canvas, sits at the bottom-right margin, renders two frame buttons and the viewport, recenters from the map, fits all panes, collapses and expands with a resized native view, returns focus to the shell, and hides while a custom menu or dialog is open.
  - Existing Canvas pan/zoom/drag/content tests continue to pass.

## ADR-035 — Canvas is the only workspace layout

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** PaneFlow originally exposed Grid, Freeform, and Canvas modes with separate arrangements. The product direction is now a single infinite Canvas: one mental model for arranging panes, one set of controls, and one persistence path. Keeping mode controls and separate arrangements adds cognitive load and prevents the custom Canvas menu from becoming the primary workspace surface.

- **Decision:**
  1. Remove the Grid/Freeform/Canvas mode switcher, grid-column selector, Freeform Tidy action, and the native grid/freeform toggle command.
  2. Start every window in Canvas. `applyPersistedLayout` and workspace resets always select Canvas.
  3. Default and normalize workspace layout mode to Canvas. Keep legacy `columns`, `gridOrder`, `freeform`, and `freeformOrder` fields readable for migration, but never expose or actively edit them.
  4. Persist Canvas positions, pane order, viewport settings, and URLs. If a migrated workspace has no Canvas position for a pane, use the deterministic default arrangement.
  5. Keep pure Grid/Freeform helpers only for legacy validation/migration and historical tests; they are not part of the current UI.

- **Alternatives considered:**
  - **Keep modes hidden in a menu.** Rejected; two arrangements and mode state would still complicate persistence, recovery, and tests.
  - **Delete legacy fields from the schema immediately.** Rejected; old workspace files would lose readable data and migration would be harder.
  - **Convert old layouts geometrically into Canvas positions.** Deferred; current migration uses saved Canvas positions when present and otherwise falls back to the default arrangement.

- **Consequences:**
  - One layout model, one set of controls, and simpler user flows.
  - Existing Grid/Freeform arrangements are not visually recreated; their panes open on the Canvas.
  - Legacy fields remain in JSON/transfer schema for compatibility.
  - Code paths in `layout.ts` and `App.vue` for Grid/Freeform are no longer user-reachable and can be removed incrementally.

- **Evidence / verification:**
  - Unit tests verify default Canvas mode, legacy mode normalization, Canvas default placement, and canvas position validation.
  - E2e verifies Canvas-only startup, no layout switch/grid-column controls, pane dragging with snapping, workspace restart, and the active-pane/focus flows without any mode switch.

## ADR-036 — Canvas pane dragging snaps in world space with visible guides

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** In a free canvas, panes are easy to misalign. Users need the precision of edge/center alignment without a separate freeform mode. Native pane views hide during a pane drag, so shell-rendered guides remain visible if the snap calculation is pure and screen-coordinate independent.

- **Decision:**
  1. Add `snapCanvasRect` in `src/shared/canvas.ts`. It checks the dragged frame's leading, center, and trailing edge on each axis against the same three edges of every other frame.
  2. Use an 8 screen-pixel threshold divided by canvas zoom for world-space comparisons.
  3. Return snapped world coordinates plus at most one vertical and one horizontal guide target.
  4. The renderer applies snapped positions during `onCanvasPanePointerMove`, converts guide targets to screen coordinates, renders 1px guides, and clears them on release/cancel.
  5. Do not snap to the dragged frame itself. Do not add grid/origin snapping in this slice.
  6. Keep the existing native-view hiding during pane drags so guides and snapshots are visible.

- **Alternatives considered:**
  - **Reuse the freeform `snapRect` helper.** Rejected for Canvas; it clamps to a canvas and uses screen-space assumptions that do not fit an infinite world.
  - **Snap to a fixed world grid.** Rejected; pane-to-pane alignment is the useful default for comparing layouts.
  - **Only snap to pane edges, not centers.** Rejected; center alignment is common for screenshots and responsive comparison.
  - **Show guides permanently.** Rejected; guides are interaction feedback, not workspace decoration.

- **Consequences:**
  - Small movements can snap to a neighboring edge; users can move beyond the 8px threshold to break the snap.
  - Guides are visible only during pane drags and clear on release.
  - Overlapping panes can still be aligned; but overlapping headers can hide controls.
  - The threshold feels consistent at every zoom.

- **Evidence / verification:**
  - Unit tests cover edge, center, threshold, invalid-input, and no-snap cases.
  - E2e drags a pane near another, verifies at least one `.alignment-guide` appears during the drag, verifies the guide clears on release, and asserts the snapped edges are flush.

## ADR-037 — Canvas add and context menus are custom in-shell menus

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Native menus do not match the product's compact design language, and the Canvas needs a quiet **+** add control plus a right-click background menu. The shell is a `WebContentsView` beneath native pane views, so a DOM menu cannot simply float above pane content.

- **Decision:**
  1. Replace the native add-pane menu with a custom in-shell menu component used by a quiet toolbar **+** button. Group presets into Phones, Tablets, and Desktop; show dimensions as muted metadata; include Responsive.
  2. Add a right-click menu on empty Canvas with Add pane, Fit all panes, Reset zoom, Hand tool, Profiles, Workspaces, and Appearance.
  3. Keep the menu compact and Herdr-inspired: rounded surface, sections, monochrome icons, 32px items, muted details, checked/radio states, visible focus, shadow, and light/dark tokens.
  4. When a menu opens, measure its panel rectangle in viewport coordinates. Hide only native pane views whose content rectangles intersect the panel and show their snapshots; keep uncovered panes live. Hide the native minimap while any custom menu is open.
  5. Support ArrowUp/Down, Home/End, Enter/Space activation, Escape, Tab-to-close, and click-outside dismissal. Return focus to the trigger on close unless a dialog or pane is taking focus.
  6. Validate the selected preset through the existing `addPaneWithViewport` path. Add a validated `paneflow:set-theme` call for the custom Appearance items.
  7. Keep native menus for pane actions and app-level commands; only Canvas add/context menus use the custom component.

- **Alternatives considered:**
  - **Native menus for both add and context actions.** Rejected; system menu styling cannot match the requested compact design.
  - **A dedicated native `WebContentsView` menu.** Rejected for this slice; it adds another IPC surface and dynamic sizing without a clear user benefit over intersection-hiding.
  - **Hide all native panes while a menu is open.** Rejected; uncovered panes can remain live with only intersecting views hidden.
  - **Draw the menu in the remote page.** Rejected; remote pages are hostile and have no app bridge.
  - **Leave the toolbar split button.** Rejected; the user asked for a quiet single **+** control.

- **Consequences:**
  - Menus are fully styleable and keyboard-accessible in the shell.
  - Panes under a menu show snapshots, not live content, while the menu is open.
  - The minimap is temporarily hidden during menus.
  - Custom menus require their own focus/keyboard handling and intersection bookkeeping.
  - The pane action menu remains a native system menu.

- **Evidence / verification:**
  - Unit tests cover the viewport preset catalog and device/selection metadata.
  - E2e verifies the **+** control has only a plus, opens the 10-item Add menu, shows section headings, creates an iPhone 15 Pro pane, closes with Escape, restores the minimap, opens the right-click menu, switches to Add pane, toggles Hand mode, and changes appearance. Accessibility e2e verifies menu semantics, ArrowDown focus, and Escape close.

## ADR-038 — Canvas controls bar is a native overlay, and workspaces fit on open

- **Status:** Accepted; bar contents extended by ADR-041 and scaling refined by ADR-042
- **Date:** 2026-11-19
- **Context:** The top-right percentage button was a small reset affordance, not a zoom control. Responsively-style zoom needs persistent zoom-out/zoom-in buttons and an exact percentage menu. The shell DOM cannot render a persistent bar above native pane views, so the bar must be a trusted native overlay. Users also lose orientation when a workspace opens at a saved pan far from its panes.

- **Decision:**
  1. Add a trusted `WebContentsView` rendered from `zoom.html`, pinned to the bottom center at 280 × 40 DIP with a 12 px margin, above pane views and the minimap. The bar holds Hand, zoom-out, the percentage button, zoom-in, and appearance.
  2. Show zoom-out and zoom-in buttons with a 10% step and a percentage button between them. Clicking the percentage button opens the standard in-shell `AppMenu` above the bar with 25%, 50%, 75%, 100%, 125%, 150%, 200%, Fit all, and Reset (100%).
  3. Extend the Canvas zoom range to 25–200%. The shell clamps every wheel, step, preset, and reset action and applies it around the workspace center for button/menu actions.
  4. Hide the canvas bar and minimap for dialogs and non-zoom/non-appearance custom menus. Keep both visible while the zoom or appearance menu is open because those menus sit above the bar and do not overlap the minimap; using a bar or minimap action closes the menu first. The menu still hides intersecting native pane views through the existing menu path.
  5. Validate the zoom bar sender separately from the shell and minimap. State flows main → bar; actions flow bar → main → shell. Main only accepts the built `paneflow://shell/zoom.html` document or the validated development origin.
  6. Fit all panes when a workspace first appears and after switching workspaces, using a short ready/retry loop until the workspace has non-zero size. Do not refit on ordinary state updates.
  7. A primary click on empty canvas with less than 4 px of movement clears the active pane; the top toolbar stays mounted with a quiet empty state. Panning, middle-button drags, pointer cancellation, and clicks that start on a pane do not clear it. Selecting a pane, its header, or a minimap frame restores selection. The cleared state is transient.
  8. Remove the top-right percentage control and make all top-right toolbar buttons borderless.

- **Alternatives considered:**
  - **Keep zoom controls in the shell DOM.** Rejected; native pane views cover the bottom-center shell area.
  - **Render the dropdown inside the zoom view.** Rejected for this slice; expanding the native view to the full window would block the entire canvas and duplicate the menu styling. The shell menu already handles intersection hiding and keyboard behavior.
  - **Use discrete buttons only.** Rejected; exact presets and Fit all/Reset are useful and requested.
  - **Fit on every state update.** Rejected; it would fight user pan/zoom during pane changes.
  - **Keep the active pane after an empty click.** Rejected; the global bar and outline then imply a selection the user did not make.

- **Consequences:**
  - The bar occupies a small bottom-center rectangle and intercepts input there.
  - The window owns one more persistent webContents that is not part of pane or workspace persistence.
  - Opening the zoom or appearance menu keeps the bar and minimap visible; other custom menus and dialogs still hide them.
  - Using the canvas bar or minimap while a bar menu is open closes the menu before applying the action.
  - Zoom range increases from 50–200% to 25–200%; very small zoom scales pane chrome and snapshots down together (see ADR-042).
  - The cleared active-pane state is not persisted and does not modify workspace data.

- **Evidence / verification:**
  - Unit tests cover zoom/hand/theme state and action validation, and trusted zoom document URLs in production and development.
  - E2e verifies the bar's bottom-center bounds, Hand, step control, 7 preset radio items, Fit all, Reset, startup fit, empty-canvas deselection/reselection, and borderless top-right toolbar buttons. It also verifies that the bar and minimap remain visible while the zoom menu is open. Accessibility e2e verifies the bar's named controls, appearance menu, keyboard focus, Escape dismissal, and an axe audit of the bar.

## ADR-039 — Keep the active-pane controls mounted to stabilize the Canvas

- **Status:** Accepted; placement moved into the top toolbar by ADR-041
- **Date:** 2026-11-19
- **Context:** In Canvas, selecting a pane mounted a 34 px active-pane bar between the toolbar and the workspace; clearing the selection removed it. The workspace therefore moved down and up on every selection change, which made panes appear to jump. A left or right inspector was considered as an alternative home for the address and viewport controls.

- **Decision:**
  1. Keep the active-pane controls mounted whenever Canvas chrome is active. They occupy a stable row in the top toolbar, which is always 42 px.
  2. When no pane is selected, show a quiet empty state: "No pane selected" plus "Click a pane to edit its address". When the workspace has no panes, show "No panes" plus "Add a pane to get started". Keep Fit all at the right and disable it when there are no panes.
  3. Keep the populated content within the same height at supported window widths. Titles, profiles, and status text truncate instead of wrapping; the custom viewport editor replaces the address row instead of adding a second row.
  4. Do not move the address/viewport controls into a left or right sidebar in this slice. A persistent side panel would permanently narrow the canvas and add more chrome; the stable top toolbar preserves the canvas-first layout with a smaller change.
  5. Clear selection without resizing the workspace, so pane frames and native views do not shift.

- **Alternatives considered:**
  - **Reserve a blank 34 px strip when no pane is selected.** Rejected; it stabilizes the layout but wastes the row. The empty state explains the row and keeps Fit all available.
  - **Overlay the bar on top of the workspace.** Rejected; it would cover the top of panes or require an extra canvas inset, complicating fit and pan.
  - **Left or right inspector panel.** Deferred; it is a larger redesign that permanently reduces canvas width. The stable top toolbar solves the reported jump without changing the canvas-first model.
  - **Keep removing the bar and animate the workspace.** Rejected; animation does not remove the layout shift and adds motion without solving the underlying instability.

- **Consequences:**
  - The top toolbar is always present and stable; there is no separate 34 px row.
  - The empty state provides a stable place for the address controls and a hint for new users.
  - Selecting or clearing a pane no longer changes the workspace rectangle or native bounds.
  - A future side-inspector design can reuse the same empty-state and stable-height principles.

- **Evidence / verification:**
  - E2e captures the workspace rectangle while a pane is selected, after an empty-canvas click, and after reselecting a pane; all three rectangles are identical.
  - E2e verifies the empty toolbar shows "No pane selected" and the populated toolbar exposes the address input.
  - Visual check at 1280 × 860 and 720 × 560 confirms the single-row toolbar stays 42 px and the empty state remains readable.

## ADR-040 — Pane actions stay visible when Canvas frames narrow

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Pane frames scale with Canvas zoom, but their layout width is the scaled width. A `@container (max-width: 340px)` rule hid `.pane-actions` entirely. At 80% zoom, a 430 × 932 iPhone frame stayed at 344 px and kept its controls, while a 393 × 852 frame fell to about 314 px and lost maximize, actions, and close. The result looked like a random pane losing its header controls.

- **Decision:**
  1. Never hide the pane action cluster based on container width. Maximize, pane actions, and close remain available at every Canvas zoom and viewport preset.
  2. Truncate the title and hide lower-priority metadata first. The profile is hidden below 470 px; the viewport badge may be hidden later if an even narrower layout needs the space.
  3. Keep the single-row, non-wrapping header. The action cluster is `flex: none`; the main region shrinks and the title ellipsizes.
  4. Do not collapse the dedicated controls into the ellipsis menu in this slice; the ellipsis already lists pane actions, but requiring an extra menu to close or maximize would be a regression.

- **Alternatives considered:**
  - **Keep the 340 px hide.** Rejected; it makes core controls disappear at ordinary zoom levels and is the reported bug.
  - **Hide only the close button at narrow widths.** Rejected; close and maximize are both core controls, and the ellipsis alone is not a substitute.
  - **Collapse all actions into the ellipsis.** Rejected for this slice; it adds a click for common actions and requires reworking the native menu.
  - **Hide the viewport badge at 340 px instead.** Deferred; the header currently fits at ~314 px with the badge hidden for the active pane and the title truncating, so there is no need to remove more metadata yet.

- **Consequences:**
  - At extreme zoom-out, titles may truncate heavily, but the actions stay reachable.
  - The header no longer silently loses controls at a width threshold.
  - Pane actions remain visually dimmer on inactive panes but are always present.

- **Evidence / verification:**
  - E2e sets a 430 × 932 pane and a 393 × 852 pane, fits them, resets to 100%, zooms out to 80%, confirms the card widths straddle 340 px, and asserts maximize, pane actions, and close are visible on both.
  - A manual visual pass at 80% shows both headers with controls and no header overflow (`scrollWidth === clientWidth`).

## ADR-041 — Top toolbar embeds active-pane controls; management moves to native menus

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** The top toolbar mixed app chrome (workspace switcher, Hand, Profiles, appearance), while a separate 34 px active-pane row held the address, navigation, and viewport controls. The result felt crowded and split related controls across two rows. The user asked to clean up the top bar, move Workspace and Profiles to the menubar, move Hand and appearance to the bottom, keep Reload/Add, and put the URL bar at the top.

- **Decision:**
  1. Make the top toolbar a single stable 42 px row: PaneFlow brand, active-pane context, back/forward/reload, address, viewport selector, Fit all, Reload all, and Add pane. The context hides when the embedded active-pane region is narrower than 640 px.
  2. Remove the workspace switcher and Profiles button from the toolbar. Add **Workspaces…** to the native Workspace menu and a native **Profiles → Manage Profiles…** menu. Both send shell commands that open the existing dialogs; closing a dialog returns focus to the active address input (or Add pane when no pane exists).
  3. Move Hand and appearance into the bottom canvas bar. Hand sends a validated action to the shell; appearance opens the in-shell System/Light/Dark menu above the bar. The native View → Theme menu remains.
  4. Keep Reload all and Add in the top toolbar. Fit all stays adjacent to the active-pane controls.
  5. Render the custom viewport editor inline in the top toolbar, replacing the address row for the same 42 px height. Do not add a second row that would move the workspace.

- **Alternatives considered:**
  - **Put the active-pane controls in a left/right sidebar.** Deferred; it permanently narrows the canvas and adds more chrome. The single-row toolbar preserves the canvas-first layout.
  - **Keep the separate active-pane row.** Rejected; it duplicates the toolbar row and makes the top of the window feel heavy.
  - **Keep Workspace/Profiles as toolbar buttons.** Rejected; native menus are the requested home and leave room for the URL controls.
  - **Open appearance as a native menu from the bottom bar.** Rejected; a native menu anchored at the bottom is harder to position. The existing shell menu renders above the bar and stays inside the window.
  - **Let the custom viewport editor wrap the toolbar.** Rejected; it would shift the canvas. Replacing the address row keeps the height stable.

- **Consequences:**
  - The top toolbar is dense at wide widths but collapses the pane context at narrow widths.
  - Workspace/profile discovery moves to the macOS menu bar; the dialogs remain unchanged.
  - The custom viewport editor temporarily hides the address row while editing.
  - The bottom canvas bar carries five controls and is 280 px wide.
  - Keyboard focus return from native-menu dialogs goes to the active address rather than a toolbar trigger.

- **Evidence / verification:**
  - E2e verifies the single-row toolbar, absence of workspace/profile/hand/appearance toolbar buttons, native Workspaces/Profiles menu commands, custom viewport editing at a stable 42 px height, and Hand/appearance controls in the bottom bar.
  - Accessibility e2e verifies toolbar roles/names, tab order, native-menu dialog focus return to the address input, bottom-bar Hand/Appearance controls, and axe audits.

## ADR-042 — Canvas zoom scales the whole pane while the viewport stays fixed

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Canvas zoom shrank or grew the pane slot and the page content, but the pane header chrome stayed at a fixed 32 px height and 12 px type. At 50% the page looked zoomed while the header stayed full size; at 200% the page was huge while the header stayed small. The user clarified that a 100 × 100 frame must remain a 100 × 100 viewport at 50%, and the whole pane should zoom as one unit rather than changing the page's internal zoom.

- **Decision:**
  1. Keep the pane's logical world frame at its declared viewport size plus the 32 px header. Canvas zoom is a visual scale of that frame.
  2. Size the pane slot to `frame.height × zoom` and `frame.width × zoom`. Give the header wrapper `32 px × zoom`; lay the header out at its world width and apply `transform: scale(zoom)` with `transform-origin: top left`.
  3. Keep the page's CSS viewport at the declared size. Main applies device-emulation scale equal to the Canvas zoom (or the fixed-viewport fit scale), so the page is rendered at the same visual scale without reflowing or changing `window.innerWidth/Height`.
  4. Derive fit and centering math from the full frame height, not the old unscaled header offset.
  5. Keep shell-only chrome such as the top toolbar and bottom canvas bar at normal size; only the pane is scaled.

- **Alternatives considered:**
  - **Keep the header fixed while the page scales.** Rejected; it makes zoom feel like page zoom and causes controls to disappear at narrow scaled widths.
  - **Keep the page at 100% and resize only the frame.** Rejected; responsive pages would reflow and fixed viewports would crop or scroll, breaking design comparison.
  - **Use CSS `zoom` on the whole pane.** Rejected; native `WebContentsView`s cannot be CSS-transformed as part of the shell and would desynchronize native bounds.
  - **Scale only the page content.** Rejected; it violates the requirement that the frame be treated as its declared size as a whole.

- **Consequences:**
  - Pane header text and controls scale with zoom; at 25–50% they are small but proportionally correct.
  - Click targets and drag handles scale with the pane.
  - The page viewport stays fixed at every zoom, so responsive breakpoints do not change.
  - Snapshot and native bounds share the same scaled content rectangle.

- **Evidence / verification:**
  - Manual measurement at 100%, 50%, and 200%: a 560 × 700 frame stays a 560 × 700 page viewport while the card renders at 560 × 732, 280 × 366, and 1120 × 1464; the header renders at 32, 16, and 64 px.
  - E2e continues to verify native bounds alignment after zoom and responsive emulation below 100%.

## ADR-043 — Device-first chrome actions, terminology, and shortcuts

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** The selected-device header devoted a control to maximize, while back/forward/reload were available only in the top toolbar/legacy navigation row. The user asked to replace maximize with those navigation actions, add rotation and screenshot, use “device” in user-facing copy, and support Cmd+D/Delete for the selected device.

- **Decision:**
  1. Replace the per-pane maximize button with back, forward, and reload. Maximize remains available through the native **Device → Toggle Maximize** menu and its accelerator.
  2. Put rotate viewport and capture screenshot in the device actions menu. Rotation is disabled for responsive viewports; screenshots use a native save dialog and write PNG data only after the user chooses a path.
  3. Store rotation as an optional `rotated` flag on `PaneViewport`. Fixed viewports swap their effective width/height for emulation, fit scaling, canvas frames, and labels. Responsive viewports cannot rotate.
  4. Use **device** in visible UI copy and accessible names. Keep **pane** as the internal and architecture term for the native view and its IDs, IPC channels, storage fields, and code types.
  5. Keep `Cmd+D` as the native Device-menu accelerator for duplicating the selected device. Add `Delete`/`Backspace` in the trusted shell when no dialog/menu is open, the event has no modifiers, and focus is not in a text-entry control.

- **Alternatives considered:**
  - **Keep maximize and add three navigation buttons.** Rejected; the user explicitly asked to replace maximize, and five header controls already consume meaningful width on small device frames.
  - **Put rotate and screenshot in the header.** Rejected; screenshot is infrequent and rotation does not apply to responsive devices. The actions menu keeps the header quiet.
  - **Handle Cmd+D only in the shell.** Rejected; a focused remote website must not be able to suppress or spoof workspace shortcuts, and the native menu accelerator works without access to remote pages.
  - **Allow Delete/Backspace from any focus context.** Rejected; editing an address or device name must not close the device.
  - **Rename internal APIs and storage to device.** Rejected; it would churn the validated IPC/storage contract without changing user-visible behavior.

- **Consequences:**
  - Visible copy and accessible names are consistent across the pane card, global bar, menus, dialogs, minimap, and errors.
  - Rotation persists with the workspace viewport and changes the canvas frame shape.
  - Screenshot paths are chosen by the user; capture failures use a native error box.
  - Legacy workspaces load with an upright viewport because `rotated` is optional.

- **Evidence / verification:**
  - Unit tests cover rotation parsing, toggling, effective sizing, fit scaling, rotated canvas frames, and screenshot filename safety.
  - E2e verifies per-device header back/forward/reload, rotated emulation and frame geometry, PNG screenshot output through the validated IPC path, the Cmd+D menu accelerator, and Delete closing the selected device while text-entry focus is protected.



## ADR-044 — Make errors, profile sharing, and shortcut semantics explicit

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** A UI review found four concrete problems: invalid addresses only showed a red border because the live status was visually hidden; `Cmd+R` used generic Electron View roles and could reload the whole shell; shared-profile usage disappeared from Canvas because the header profile label is hidden; and “device” was doing double duty for both a browser frame and a viewport preset. Maximize also became hard to find after the header button removal.

- **Decision:**
  1. Render address validation errors as a compact inline danger message in the toolbar, while retaining the screen-reader live region and `aria-describedby` relationship. Do not add a floating overlay below the toolbar because native views would cover it.
  2. Remove generic View-menu reload/force-reload roles. Map `Cmd/Ctrl+R` to Reload Device and add `Cmd/Ctrl+L` Focus Address. Keep `Cmd/Ctrl+Alt+Shift+R` for Reload All.
  3. Pass the active profile's device count into the toolbar and show `Profile N · M devices` plus a shared-profile tooltip when the count is greater than one.
  4. Rename add-menu sections to viewport language (`Start with viewport`, `Phone viewports`, `Tablet viewports`, `Desktop viewports`) and rename the profile action to `New device`. Explain that new devices and duplicates receive fresh profiles.
  5. Add **Maximize/Restore Device** and **Copy URL** to the native device actions menu. Maximize requests are routed back to the shell with the pane ID so the action always targets the menu's pane.

- **Alternatives considered:**
  - **Floating error popover below the toolbar.** Rejected; native `WebContentsView`s would cover it.
  - **Keep the generic View reload roles.** Rejected; reloading the trusted shell is never the intended device action.
  - **Show the shared count only in the profile dialog.** Rejected; profile sharing changes cookie/storage behavior and must be visible while using a device.
  - **Rename panes back to browsers.** Rejected; the user chose device-first copy. Viewport language removes the ambiguity without another rename.
  - **Use the active-pane command for menu maximize.** Rejected; routing the pane ID avoids applying the toggle to a different selection.

- **Consequences:**
  - Invalid addresses now consume toolbar width temporarily; long messages truncate with a full-text tooltip and remain fully announced.
  - `Cmd+R` is consistent whether shell chrome or a website has focus.
  - The toolbar makes shared-profile usage visible in Canvas without re-enabling the hidden header metadata.
  - Native pane-menu items remain outside Playwright automation and need a manual GUI pass.

- **Evidence / verification:**
  - E2e asserts visible and announced address errors, Escape recovery, `Cmd/Ctrl+L`/`Cmd/Ctrl+R` menu accelerators and focus behavior, shared-profile toolbar copy, and the renamed add/profile flows.
  - Unit tests, typecheck, lint, build, and the existing e2e suite pass. A visual pass at 1280 × 860 and 720 × 560 confirms the inline error fits without toolbar overflow.

## ADR-045 — Blocked remote actions report a transient device notice

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The remote policy denies popups, downloads, and permission requests, but the UI previously failed silently. Sites looked broken and users could not tell whether PaneFlow blocked the action or the website malfunctioned. The security model must remain deny-by-default.

- **Decision:**
  1. Keep all popup, download, permission, and device-access decisions denied.
  2. Report a transient, non-interactive notice to the shell with the pane ID and a short message.
  3. Resolve permission requests by `webContents` ID, downloads by profile plus initiator origin, and popups directly from the pane handler. Ignore events that cannot be attributed to a pane.
  4. Display the notice in that device's header status area for six seconds. Coalesce identical messages and reset the timer instead of stacking notices.
  5. Do not add Allow/Prompt actions, download handling, or permission controls in this slice.

- **Alternatives considered:**
  - **Native dialog per blocked action.** Rejected; permission checks can repeat and modal dialogs would be disruptive.
  - **Global banner below the toolbar.** Rejected as the first pass; it would resize the workspace/native views on every event. The device header keeps feedback attached to its source without layout movement.
  - **Show full URLs or permission details.** Rejected; short generic labels avoid leaking query strings and keep the message readable.
  - **Grant once or remember decisions.** Rejected for this slice; that requires a separate security and persistence design.

- **Consequences:**
  - A malicious or noisy page can only cause a bounded transient status message, not a privileged prompt.
  - Off-screen panes still record the notice in their header; if the event source cannot be resolved, no message is shown.
  - Downloads triggered outside a known profile/pane are silently denied as before.

- **Evidence / verification:**
  - E2e opens a popup, requests notifications, and triggers a Blob download in the fixture. It verifies `Popup blocked`, `Notifications blocked`, and `Download blocked` in the corresponding device headers.
  - Typecheck, lint, unit tests, build, and the full Playwright suite pass.

## ADR-046 — Device palette is a trusted shell quick switcher

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The Canvas overview helps with spatial recovery, but not with finding a device by name, host, profile, or viewport when many panes are open. A permanent sidebar would add chrome and narrow the canvas. Native menus cannot provide search.

- **Decision:**
  1. Add a `Find Device…` native Device-menu command with `Cmd/Ctrl+K`.
  2. Render a trusted shell palette with a combobox input and listbox results filtered by title, hostname, profile label, and effective viewport.
  3. Keep the active device first, then sort by title; arrows move the active option, Enter centers/selects the device and focuses its address, Escape restores the previous address focus.
  4. Hide all native pane views, the minimap, and the bottom canvas bar while the palette is open; restore them through the normal validated visibility path on close.
  5. Limit the first slice to device results. Do not add action commands, recent items, or fuzzy scoring yet.

- **Alternatives considered:**
  - **Permanent searchable sidebar.** Rejected; it permanently narrows the canvas and conflicts with the quiet-workspace direction.
  - **Native dynamic Devices menu.** Rejected as the primary path; it cannot filter or scale to many devices.
  - **Overlay the palette without hiding native views.** Rejected; native views sit above the shell and would cover the palette.
  - **Keep the palette while navigating.** Rejected; a quick switcher should close on selection and restore the workspace immediately.

- **Consequences:**
  - Opening the palette briefly freezes live pages behind snapshots. This is the same tradeoff already accepted for dialogs and menus.
  - While the palette is open, native menu commands other than Find Device are ignored until it closes.
  - Search results intentionally exclude full URLs and query strings.

- **Evidence / verification:**
  - E2e opens the palette from the native menu command, verifies the dialog/combobox/listbox semantics, filters by title, selects with Enter, checks center/active/focus behavior, verifies Escape and the no-match state, and confirms native views and overlay visibility restore.
  - Typecheck, lint, unit tests, build, and the full Playwright suite pass.

## ADR-047 — Device palette discovery and scannability

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The initial `Cmd/Ctrl+K` palette worked but was only discoverable through the native Device menu. Results were a flat title-and-detail line, so users could not see which part of a title, host, or viewport matched their query.

- **Decision:**
  1. Add a magnifier icon to the top toolbar, disabled when the workspace has no devices.
  2. Keep the same palette and native shortcut; the toolbar button is an additional entry point, not a new overlay.
  3. Highlight matching substrings in titles, host/profile details, and viewport badges.
  4. Move the effective viewport into a compact right-aligned badge so each result has a clear title, metadata, and size hierarchy.
  5. Keep full URLs and query strings out of results.

- **Alternatives considered:**
  - **Permanent searchable sidebar.** Rejected; it adds permanent chrome and narrows the canvas.
  - **Make the toolbar entry the only entry point.** Rejected; `Cmd/Ctrl+K` remains the fastest path and stays available while a website has focus.
  - **Highlight only the title.** Rejected; host, profile, and viewport are common search targets.

- **Consequences:**
  - The toolbar has one additional icon and focusable control.
  - The palette result list is slightly denser but easier to scan.
  - Search remains title/host/profile/viewport based; full URLs are not displayed.

- **Evidence / verification:**
  - E2e checks the toolbar entry, native accelerator, viewport badge, title and viewport highlighting, Enter selection, Escape, and no-match state.
  - Typecheck, lint, unit tests, build, full Playwright suite, and a 1280 × 860 visual pass pass.

## ADR-048 — Pane actions use the custom shell menu and the selection ring lives outside native bounds

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The `+` menu, Canvas menu, zoom menu, and appearance menu use a custom in-shell component. The per-device `…` menu was still a native `Menu.popup`, so its typography, spacing, icons, and interaction model did not match. Separately, the selected-device accent was an inset card shadow; native website content covered it everywhere except the shell header, making the selection look like a top-only underline.

- **Decision:**
  1. Replace the native pane actions popup with the same `AppMenu` component used by the `+` menu.
  2. Keep the existing native-view hiding strategy: measure the custom menu, hide only intersecting native views, and show their snapshots.
  3. Reuse validated pane operations and add two narrow IPC commands for Copy URL and detached DevTools. Remove the obsolete native-menu request and maximize event surface.
  4. Draw the selected-device ring on `.pane-slot`, outside the native content rectangle, instead of using an inset card shadow.
  5. Leave the macOS application menu bar native; it is OS chrome, not an in-app context menu.

- **Alternatives considered:**
  - **Keep the native pane menu.** Rejected; it cannot match the custom menu design and was the reported inconsistency.
  - **Draw a custom menu over native content without hiding it.** Rejected; native views sit above the shell.
  - **Inset the native view by one pixel to reveal an inner ring.** Rejected; it would change the effective viewport/content rectangle.
  - **Use an inset card shadow for selection.** Rejected; native content covers it below the header.

- **Consequences:**
  - All in-app context menus now share one visual and keyboard model.
  - Pane actions that need privileged behavior use explicit, validated IPC (`copyPaneUrl`, `openPaneDevTools`, rotate, screenshot).
  - The selection ring remains one screen pixel at every Canvas zoom and does not alter pane geometry.
  - The OS application menu remains visually native by necessity.

- **Evidence / verification:**
  - E2e opens the pane actions menu, verifies `.app-menu`, section headings, all 11 items, native-view hiding, Escape focus return, and Copy URL clipboard output.
  - Visual checks confirm the menu matches the `+` menu and the accent ring surrounds the entire selected pane.
  - Typecheck, lint, unit tests, contrast, build, and the full Playwright suite pass.

## ADR-049 — Remove pane maximize and preserve selection during Reload All

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Pane maximize added a second presentation mode that was rarely used and was buggy when the Canvas zoom was not 100%. The product already supports Canvas zoom and Fit all, which cover the useful ways to focus a pane. Separately, Reload All could let incidental native focus events change the selected pane while the bulk reload settled.

- **Decision:**
  1. Remove pane maximize completely: renderer state, slot geometry branch, native/custom menu items, `Cmd/Ctrl+Shift+M`, command routing, the layout helper, and its tests.
  2. Keep application-window maximize/full-screen behavior unchanged.
  3. In Reload All, capture the selected pane, suppress incidental native focus selection for a short settle window, and restore the captured selection after the request.
  4. Keep the Canvas zoom, Fit all, minimap, and device palette as the ways to locate and work with panes.

- **Alternatives considered:**
  - **Keep maximize in the menu only.** Rejected; it still adds a separate geometry mode and the same native-scale edge cases.
  - **Fix maximize at non-100% zoom.** Rejected; the feature is low-value and the fix would add per-pane presentation state.
  - **Remove all pane focus handling.** Rejected; clicking a website must still select its pane.
  - **Restore the selected pane without suppression.** Rejected; a late native focus event could still select another pane.

- **Consequences:**
  - Canvas has one layout mode and one source of pane geometry; no hidden maximized-pane state remains.
  - Application-window maximize is unchanged.
  - Reload All preserves the current selection; a user click within the short suppression window may not update selection, but the window is brief.
  - The test suite no longer needs pane maximize coverage.

- **Evidence / verification:**
  - Source search confirms no pane maximize state, command, menu item, shortcut, helper, or test remains.
  - E2e selects the second pane, invokes Reload All, waits for both panes to finish loading, and verifies the second pane is still selected.
  - Typecheck, lint, unit tests, build, and the full Playwright suite pass.

## ADR-050 — Bottom canvas bar owns Find and Reload All

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The top toolbar had accumulated Find device, Reload all, Fit all, and Add at its right edge. The Fit all corner icon looked like a maximize control, and the user wanted the top right to contain only Add while the other actions live near the zoom controls at the bottom.

- **Decision:**
  1. Remove Find device, Reload all, and Fit all from the top toolbar.
  2. Keep only the active-device controls and Add in the top toolbar.
  3. Move Find device and Reload all into the bottom canvas bar.
  4. Keep Fit all in the overview header and the zoom percentage menu; do not add a redundant bottom-bar Fit all button.
  5. Extend the validated `CanvasZoomAction` contract with `find-device` and `reload-all`, and widen the bottom bar from 280 to 352 DIP.

- **Alternatives considered:**
  - **Keep Fit all in the top toolbar.** Rejected; its corner icon looked like maximize and the user asked for only Add at the top right.
  - **Move Find and Reload into the native menu bar.** Rejected; they are frequent workspace actions and belong near the other canvas controls.
  - **Add Fit all to the bottom bar too.** Rejected; the overview and zoom menu already provide it without making the bar wider.

- **Consequences:**
  - The top toolbar is quieter; the bottom bar is wider and has six visible controls plus the percentage menu.
  - The bottom bar's trusted zoom view now owns two more validated actions.
  - Find and Reload remain keyboard-accessible through `Cmd/Ctrl+K` and `Cmd/Ctrl+Alt+Shift+R`.

- **Evidence / verification:**
  - E2e opens the device palette from the bottom bar, invokes Reload All from the bottom bar, and verifies the bottom-bar accessible names and bounds.
  - Accessibility checks cover the new bottom-bar controls; top-toolbar checks confirm only Add remains on the right.
  - Typecheck, lint, unit tests, build, and the full Playwright suite pass.

## ADR-051 — Compact centered top-bar address and explicit macOS app name

- **Status:** Accepted (the viewport-trigger/menu details are superseded by ADR-053)
- **Date:** 2026-11-20
- **Context:** The top toolbar repeated navigation already present in every pane header, the address field and viewport select were small and visually indistinct, and clicks inside the titlebar control row could start a window drag. In development the macOS application menu also said “Electron” while the toolbar repeated the PaneFlow name.

- **Decision:**
  1. Remove back, forward, and reload from the top bar; each device header remains the only navigation home.
  2. Mark the whole top navigation row as a no-drag region, and use larger controls with visible inset surfaces and pointer cursors.
  3. Center a shorter address field (max 400 px) with the viewport select in the available toolbar space. Center the URL text while idle and left-align it while editing. Keep the viewport select attached to the address field and give it a fixed default width of 184 px so changing presets never reflows the bar; step the width down at narrow toolbar sizes. Keep full preset names and CSS dimensions in the closed label, with a tooltip for any truncated text.
  4. Keep the active-device context anchored at the far left rather than attaching it to the address field. The bar reads as three stable zones: device context, address plus viewport, and Add.
  5. Remove the visible PaneFlow brand from the toolbar and keep a visually hidden level-one heading for accessibility.
  6. Replace the default macOS `appMenu` role with an explicit PaneFlow application menu and set the About panel name to PaneFlow.

- **Alternatives considered:**
  - **Keep navigation in both the header and top bar.** Rejected; it was redundant and consumed the space needed for a usable address field.
  - **Keep only the input/button elements as no-drag.** Rejected; gaps and form padding still initiated window drags.
  - **Use a very wide Safari-style field.** Rejected; the user asked for a shorter, minimal field.
  - **Let the viewport select size to its current label.** Rejected; the bar shifted whenever the preset changed, and long labels pushed the select toward Add.
  - **Move the viewport select next to Add.** Rejected; the viewport is a property of the active device/page, so it belongs with the address. Add remains a separate global action.
  - **Attach the device context to the address field.** Rejected; pane titles vary in length, which would shift the address field, and it would leave an empty titlebar region on the left.
  - **Rely on `app.setName` for the menu title.** Rejected; in development the native app-menu role still used the Electron bundle name.

- **Consequences:**
  - Window dragging remains available from the toolbar background, active-device context, and titlebar inset.
  - The address field is easier to target and visually reads as editable.
  - The viewport select stays put as presets change and remains next to the address it affects.
  - Navigation is available only where the device is, not duplicated globally.
  - The macOS application menu identifies PaneFlow in both development and packaged runs.

- **Evidence / verification:**
  - E2e verifies the hidden shell heading, address focus order, bottom-bar Find/Reload actions, and absence of top-bar navigation controls.
  - E2e verifies the viewport select keeps a fixed compact width, shows the full preset label and CSS dimensions, and exposes the dimensions in its tooltip.
  - Visual checks confirm the centered short URL field, the full-width preset label at 1280 px, the responsive selector at 720 px, and no visible PaneFlow brand in the toolbar.
  - The running app reports the macOS application menu label as `PaneFlow`.

## ADR-052 — Restore the last Canvas camera and selection per workspace

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Every workspace opened with a fit-all camera and selected its first device. That is useful for a new workspace, but it discards the pan, zoom, and device a user was working with. For a spatial tool, reopening the app or switching back to a workspace should resume the same view. Window bounds, pane positions, URLs, and viewports already persisted.

- **Decision:**
  1. Store an optional `view` on each workspace layout with the Canvas `pan`, `zoom`, and `activePaneId`. A null active pane means the user cleared the selection.
  2. Save discrete camera changes (zoom actions, Fit all, Reset), pan/wheel gesture ends, and selection changes immediately. Continuous gestures also use a short debounce, and a best-effort save runs while the shell unloads.
  3. Restore the saved view synchronously when the workspace loads or becomes active. Run the fit-all path only when the workspace has no saved view.
  4. Apply a pane's first native bounds even while the pane is hidden, so a restored camera that leaves it partially offscreen does not block its initial page load.
  5. Suppress incidental native focus events for a short window after restoring a workspace so the saved active device is not replaced while recreated views settle.
  6. Add native View-menu Canvas zoom commands: `Cmd/Ctrl+=` (in), `Cmd/Ctrl+-` (out), and `Cmd/Ctrl+0` (reset 100%).

- **Alternatives considered:**
  - **Keep fitting on every open.** Rejected; it loses the user's place and makes launch feel like a reset.
  - **Persist only pan and zoom globally.** Rejected; each workspace has its own spatial arrangement and should resume independently.
  - **Persist the world point at the viewport center.** Rejected; pixel pan is exact for the restored window bounds and avoids changing the camera when the window size changes.
  - **Rely on `beforeunload` for the final state.** Rejected as the only mechanism; quitting may destroy the renderer without running page unload handlers. Proactive saves at interaction boundaries are required.
  - **Auto-fit when the saved camera shows no panes.** Rejected for now; it contradicts the user's request to restore exactly what they saw. Fit all remains one click away.
  - **Load hidden panes only when they become fully visible.** Rejected; a restored offscreen pane would stay blank indefinitely. First bounds are now enough to start the load.

- **Consequences:**
  - Reopening the app and switching workspaces preserve the last camera and selected device.
  - Workspaces created before this schema have no saved view and fit once; after the first camera/selection change they remember the view.
  - Duplicated and imported workspaces start fitted because their transfer/materialization paths do not copy the camera.
  - A stale saved camera can point at empty world space or leave panes offscreen. Fit all in the overview and zoom menu is the recovery action.
  - The active device is restored after launch without focusing its address input.

- **Evidence / verification:**
  - Unit tests cover valid camera views, zoom clamping, unknown active-pane IDs, invalid coordinates, and workspace parse round-trips.
  - E2e sets 50% zoom and a pan, then 75% immediately before quitting, relaunches, and verifies the final zoom, pan-derived pane position, and selected device. It also confirms a partially offscreen restored pane finishes loading.
  - E2e asserts the native View-menu accelerators and routes Zoom In, Zoom Out, and Reset through the same Canvas zoom path.

## ADR-053 — Share the custom preset menu between Add and the viewport selector

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The active-pane viewport control used a native `<select>`. Its OS-rendered popup indented optgroup labels, placed the checkmark in a separate left column, and constrained/truncated long preset labels. The Add menu used the custom `AppMenu`, but exposed only a curated subset of the preset catalog, so the two lists disagreed about which devices existed.

- **Decision:**
  1. Replace the native viewport select with a button trigger that opens the existing custom `AppMenu`.
  2. Keep the trigger compact (short preset name, fixed width, tooltip with the full name and dimensions). The menu carries the full labels and CSS dimensions.
  3. Share one preset catalog between the Add menu and the viewport menu. Add exposes all 15 fixed presets plus Responsive; the viewport menu additionally exposes Custom….
  4. Use the same section headings, icons, left-aligned names, right-aligned dimensions, and menu-item styling in both menus.
  5. Selecting Custom… closes the menu, asks the pane navigation component to open its inline custom viewport editor, and focuses the width field.
  6. Keep the menu-button accessibility contract: `aria-haspopup="menu"`, `aria-expanded`, a menu label, menuitemradio selection, Escape close, and focus return to the trigger.

- **Alternatives considered:**
  - **Widen the native select.** Rejected; it would avoid some truncation but retain the OS popup's indentation, checkmark placement, and visual mismatch with Add.
  - **Keep the Add menu curated.** Rejected; the user expects the two lists to agree about available devices.
  - **Use one menu instance with the same item IDs for both contexts.** Rejected; Add and viewport selection have different actions and Custom only applies to an existing pane.
  - **Put Custom in the Add menu.** Rejected; creating a second pane from custom dimensions would need a separate add-time dimension form.

- **Consequences:**
  - Both menus share the app menu's 660 px maximum height; the complete catalog is visible at a typical window size and scrolls only on shorter windows.
  - The viewport trigger shows the device name only; the full name and CSS dimensions remain in the tooltip and menu.
  - The Add menu grows from 10 to 16 items, and the viewport menu has 17 (including Custom).
  - Tests select presets through menu items instead of `selectOption`, and the viewport trigger is a button rather than a combobox.

- **Evidence / verification:**
  - E2e verifies the viewport menu has 17 radio items, the same three category groups, and the same missing presets as Add; the Add menu has 16 items.
  - E2e selects fixed presets and Custom through the menu, and verifies the trigger's `data-preset`, short label, tooltip, and `aria-expanded` state.
  - Accessibility e2e verifies the button/menu semantics, focus, and the updated AX tree entry.
  - Visual check at 1280 × 860 confirmed 304 px wide menus with left-aligned names, right-aligned dimensions, no horizontal clipping, and the complete catalog visible without scrolling.

## ADR-054 — Anchor duplicates to their source and add explicit Canvas arrangements

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** `Cmd+D` created a duplicate at the end of the default row, often far from the pane the user was comparing. Users also asked for `Cmd+N` as the conventional add-device shortcut and for Responsively-style arrangements that can tidy a Canvas full of frames without dragging each one.

- **Decision:**
  1. Compute duplicate placement in the renderer before invoking `paneflow:duplicate-pane`. Use the source frame's right slot when it has a clean gap; otherwise place the duplicate at the source's left edge below it and scan down past occupied frames.
  2. Keep the computed placement pending until the new pane appears in the state snapshot, then apply it before `ensureCanvasPositions` runs so the camera reveal and the saved layout both use the final position.
  3. Use `Cmd/Ctrl+N` for Add Device in the native Device menu, replacing `Cmd/Ctrl+T`. ADR-058 later changes this shortcut to open the device picker instead of creating a responsive pane immediately.
  4. Add an Arrange menu to the bottom canvas bar with Showcase layout, Horizontal row, 2 × 2 grid, and Vertical stack. Arrange rebuilds every pane position from pane order, persists the result, and fits the camera.
  5. Put the pure `duplicateCanvasPosition` and `arrangeCanvasFrames` helpers in `src/shared/canvas.ts`. Showcase packs rows with a 24 px gap, wraps at the existing 2400 px row width, and centers shorter rows against the widest row.
  6. Keep existing native-view hiding and menu behavior; Arrange is a normal in-shell menu rendered above the bottom bar and keeps the bar and minimap visible.

- **Alternatives considered:**
  - **Insert the duplicate directly beside the source and shift existing panes right.** Rejected; silently moving unrelated panes makes an existing layout harder to trust.
  - **Always place duplicates at the far-right end of the row.** Rejected; that was the reported problem.
  - **Always place duplicates below the source.** Rejected; the right slot is the clearest first choice when it is free.
  - **Keep both `Cmd+N` and `Cmd+T`.** Rejected; one visible accelerator per action avoids duplicate menu entries and documentation drift.
  - **Add a persistent arrangement mode.** Rejected; these are one-shot layout commands, not another workspace mode.
  - **Reuse the default row-flow for Showcase.** Rejected; the default uses the wider 60 px gap and does not center rows.

- **Consequences:**
  - A duplicate stays visually attached to the pane it came from, even when the neighboring row slot is occupied.
  - Repeated duplicates below the same source form a clean vertical stack at the source's left edge.
  - Arrange discards manual position tweaks for every pane in exchange for a predictable tidy layout; Fit all remains the recovery path.
  - Showcase may wrap earlier than the default row because its 24 px gap is tighter and its rows are centered rather than left-aligned.

- **Evidence / verification:**
  - Unit tests cover right-slot placement, below-source fallback, vertical scanning, non-overlapping targets, row, stack, grid, Showcase wrapping/centering, and empty input.
  - E2e verifies `CmdOrCtrl+N` accelerator metadata, duplicate placement beside/below the source in persisted Canvas coordinates, the four Arrange menu items, and the resulting horizontal-row positions.

## ADR-055 — Each device header owns its viewport and browser handoff

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Responsively's device header exposes the device preset, dimensions, reload, fullscreen, external open, screenshot, and close. PaneFlow's Canvas header had a title, a static size badge, and navigation/actions, while the active-pane viewport selector lived in the main top toolbar. Users asked for a clearer per-pane header, a visible drag affordance, an open-in-browser action, and a cleaner main toolbar.

- **Decision:**
  1. Add a six-dot drag grip at the left of every Canvas pane header. The grip is decorative; the existing header drag surface remains unchanged.
  2. Replace the static viewport badge with a per-device trigger that shows the short preset name and CSS dimensions, opens the existing viewport menu for that pane, and exposes `data-preset`, `aria-haspopup`, and `aria-expanded`. Open the menu below the trigger from its left edge and let the shared window-edge clamp shift it only when it would overflow.
  3. Hide the dimensions below a 470 px header width so narrow device frames keep the preset name and all actions usable.
  4. Remove the full viewport selector from the top toolbar. Selecting Custom… from a header selects that device and opens the existing inline width/height/DPR editor in the top toolbar; a compact edit button remains while the active device has a custom viewport.
  5. Add an Open in Browser button to the header and an Open in Browser item to the device actions menu. Route it through a validated `paneflow:open-pane-external` channel that only accepts the pane's current HTTP(S) URL, rejects `about:blank`, and calls `shell.openExternal` in main.
  6. Keep the header on one row. Do not add synced/mirroring status because PaneFlow has no synchronized interaction feature, and do not duplicate global zoom controls or screenshot actions in the header.

- **Alternatives considered:**
  - **Two-row header.** Kept as a fallback, but not needed after moving the preset selector into the header and hiding dimensions at narrow widths.
  - **Keep the top-toolbar preset selector as well.** Rejected; two selectors for the same state make the main toolbar heavier and create two sources of truth.
  - **Keep Custom only in the toolbar.** Rejected as the primary control; the header menu lists the same complete catalog, and the toolbar editor remains only as the compact form.
  - **Open external from the renderer or preload.** Rejected; external process launching stays in main with sender and URL validation.
  - **Add a Synced badge or toggle.** Rejected; it would claim a feature that does not exist.
  - **Add fullscreen/maximize back to the header.** Deferred; it reverses the earlier ADR-043 decision and deserves a separate product decision.

- **Consequences:**
  - Every pane can change its own viewport without first making it active in a separate toolbar control.
  - The top toolbar contains only the active device address, Add, and an optional custom-viewport edit button.
  - Header chrome is denser but remains one row; dimensions and the profile drop out first on narrow frames.
  - Open in Browser is disabled for blank devices and for any non-HTTP(S) state.
  - Header controls remain above native bounds, so this does not change the native-view composition model.

- **Evidence / verification:**
  - E2e verifies the per-device viewport trigger, complete preset menu, `aria-expanded`, custom-editor handoff, mobile-width header containment, open-in-browser URL handoff through a stubbed `shell.openExternal`, and the 11-item device actions menu.
  - Accessibility e2e verifies the updated tab order: address, Add, viewport trigger, reload, open in browser, device actions, close, then the next device.
  - `make check` passes typecheck, lint, 163 unit tests, and all light/dark contrast pairs.

## ADR-056 — Marquee Select tool for bulk pane cleanup

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Workspaces with many panes require repeated close actions. Users asked for a marquee-selection tool in the bottom Canvas bar so they can drag around several panes and delete them together. Canvas panes are native views, so the shell cannot draw a selection rectangle over live page content, and normal Canvas dragging already owns empty-canvas panning and pane-header moves.

- **Decision:**
  1. Add a persistent Select toggle to the bottom canvas bar, mutually exclusive with Hand. Activating either tool turns the other off; Space-held Hand still temporarily overrides Select.
  2. While Select is active, a primary drag from empty canvas or pane chrome starts a marquee instead of panning or moving a pane. Interactive controls keep normal behavior.
  3. Hide native pane views for the duration of the marquee and draw the rectangle as shell DOM. Capture snapshots when none are available so covered panes do not flash.
  4. Convert pane frames to screen space and use the pure `canvasPaneIdsInRect` helper to select every intersecting frame. Selection replaces the previous set on each drag.
  5. Ring selected pane slots outside native bounds and show a toolbar count chip with a close action. A click without movement selects only the pane under the cursor, or clears the selection on empty canvas.
  6. Delete/Backspace closes the selected set when focus is in shell chrome; Escape clears the selection, then exits the tool. Update the bar through a validated `paneflow:set-canvas-select-mode` channel so `aria-pressed` reflects the real state.
  7. Keep selection ephemeral. It is not persisted, does not change the active pane, and clears on workspace switch or when the last selected pane closes.

- **Alternatives considered:**
  - **Shift-click to build a selection.** Deferred; marquee is the requested path, and click/Shift semantics can be added later without changing the model.
  - **Keep native views live during marquee.** Rejected; the native views would cover the rectangle and make the selection area invisible.
  - **Start the marquee only from empty canvas.** Rejected; draggable pane headers are useful starting points, and Select mode already suspends header dragging.
  - **Close panes from main in one bulk IPC.** Deferred; sequential validated close calls are simple and keep the existing destroy/state path.
  - **Add a persistent selection mode.** Rejected; this is a temporary tool, not another layout mode.

- **Consequences:**
  - Bulk deletion is fast but has no undo; the selected count and ring make the target set visible before Delete.
  - Native views are briefly replaced by snapshots or empty states during the drag, then restored by the normal bounds path.
  - About-blank panes, whose native views are intentionally hidden, can still be selected and closed.
  - The bottom bar grows to 422 DIP and now carries an additional pressed-state control.

- **Evidence / verification:**
  - Unit tests cover marquee overlap, zero-size input, and edge-touching behavior.
  - E2e creates four stress panes, fits the camera, drags around two panes, verifies two selected rings and the count chip, presses Delete, and confirms only those two panes close. Accessibility e2e verifies the Select button name, tooltip, and `aria-pressed` state.

## ADR-057 — Fixed presets send category-appropriate user agents

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Viewport emulation changed only CSS dimensions and DPR. On a 1× Dell display, Google at iPhone SE size reported `innerWidth: 375` but `scrollWidth: 400`, producing a horizontal scrollbar and clipped content. A Retina MacBook hid the bar with overlay scrollbars, so the overflow was less visible. Testing with an iPhone UA reduced the same page to `scrollWidth: 360` and removed the horizontal overflow. The overflow is caused by sites serving desktop markup to the Electron UA, not by display scaling or native bounds.

- **Decision:**
  1. Add `src/shared/user-agent.ts` with a pure mapping from fixed preset category to UA: iPhone Safari for Apple and generic phones, Android Chrome for Galaxy/Pixel phones, iPad Safari for iPad and generic tablets, Android Chrome for the Galaxy Tab, and desktop Chrome for laptop/desktop presets.
  2. Keep the pane's original Electron UA for responsive and custom viewports.
  3. Set the mapped UA before the first load. When a viewport change alters the UA category, update the UA and reload the pane's current URL so the site can serve the matching document.
  4. Use the running Chromium version in desktop and Android UA strings, with a safe fallback when the version is malformed.
  5. Keep the emulated CSS viewport and DPR exactly as configured. The UA is for layout fidelity only and must not be presented as a way to bypass paywalls, bot protection, or identity checks.
  6. Expose the preset UA in `docs/ARCHITECTURE.md`, `SPEC.md`, and known limitations; arbitrary per-pane UA overrides remain unsupported.

- **Alternatives considered:**
  - **Leave viewport-only emulation.** Rejected; common mobile sites then serve desktop markup and overflow fixed viewports.
  - **Add an optional per-pane UA toggle first.** Rejected for this slice; preset-derived UAs fix the default path without another control. An explicit override can still be added later.
  - **Set the UA without reloading.** Rejected; `setUserAgent` affects future navigations, so the current desktop document would remain until a manual reload.
  - **Use exact model UAs for every preset.** Rejected; category-level strings are sufficient for layout selection and avoid implying hardware-accurate emulation.
  - **Spoof Client Hints and touch APIs as well.** Rejected; that expands the accuracy claim and bypass surface beyond layout fidelity.

- **Consequences:**
  - Fixed phone/tablet panes generally receive mobile markup and fit their preset width; desktop presets receive a clean desktop Chrome UA instead of Electron's UA.
  - Changing between categories reloads the page, which can discard unsaved page state. Changing between presets in the same category does not reload.
  - Sites that rely on User-Agent Client Hints rather than the UA string may still choose a different layout.
  - Responsive and custom panes keep the previous behavior and may still see Electron-specific handling.

- **Evidence / verification:**
  - Unit tests cover responsive/custom fallback, iPhone, Android phone, iPad, Android tablet, desktop, and malformed Chrome-version fallback.
  - E2e verifies the UA inside live panes after switching to generic phone (`iPhone`), tablet (`iPad`), Pixel 8 (`Android 14`), and back to responsive (no longer iPhone).
  - Manual Google check on the Dell 1× display: at iPhone SE the page changed from `scrollWidth: 400` with a horizontal scrollbar to `scrollWidth: 360` without horizontal overflow, while the emulated viewport remained `375 × 667 @ DPR 2`.

## ADR-058 — Cmd+N opens the Add Device picker

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** `Cmd/Ctrl+N` created a responsive pane immediately, while the toolbar + button opened the viewport picker. Users expect the shortcut and the button to offer the same choice, especially when they want a preset other than Responsive.

- **Decision:**
  1. Route the native **Add Device** command to the existing in-shell Add Device menu instead of calling `paneflow:add-pane`.
  2. Anchor the menu to the toolbar + button, using its normal above/below placement and focus-return behavior.
  3. Do not create a pane until the user selects Responsive or a fixed preset.
  4. Keep the direct `paneflow:add-pane` IPC and `window.paneflow.addPane()` API for tests and internal creation paths; only the user-facing command changes.
  5. Keep `Cmd/Ctrl+N` as the menu accelerator.

- **Alternatives considered:**
  - **Create Responsive immediately and offer a separate “Add preset…” command.** Rejected; two add paths with different defaults are harder to explain.
  - **Open the menu at the pointer.** Rejected; the custom menu is anchored to trusted shell chrome, and the toolbar + is the stable entry point.
  - **Remove the direct add API.** Rejected; tests and internal stress checks use it, and it remains the simplest programmatic path.

- **Consequences:**
  - `Cmd/Ctrl+N` now requires a second choice before a pane exists.
  - The shortcut, toolbar +, and native Device menu share one Add path and one preset catalog.
  - The command closes any open Add menu? Opening it again replaces the current menu through the existing `AppMenu` mode.
  - Focus returns to the Add button after Escape or selection.

- **Evidence / verification:**
  - E2e invokes the native `pane-add` menu command, verifies the Add Device menu appears without changing pane count, selects Responsive, and then verifies a fresh pane is created.
  - The existing accelerator metadata check still asserts `CmdOrCtrl+N`.

## ADR-059 — Two-stage snapping with a near gap and proximity preview

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Alignment guides appeared only after the dragged pane entered the eight-pixel flush-snap window, and users asked for a first soft stop with visible space before the pane locks flush. They also wanted to keep the existing next-to-neighbor snap.

- **Decision:**
  1. Keep the existing 8-screen-pixel flush snap.
  2. Add a first magnetic stop at a 16-screen-pixel gap when the nearest opposite edges are within 24 screen pixels. This is the “close” snap.
  3. Show a lighter dashed preview at 24–64 screen pixels, where the pane is near but not yet snapped.
  4. Only opposite edges participate in gap snapping, so panes never gap-snap into an overlap. Centers still flush-snap.
  5. Prefer a flush snap when both stages are available. When an axis is snapped at either stage, suppress its dashed preview and show one solid guide.
  6. Clear solid and dashed guides on drag start, release, cancel, workspace switch, and mode change.
  7. The bottom-bar Hand and Select controls use palm and pointer-cursor icons; names, tooltips, pressed state, and behavior are unchanged.

- **Alternatives considered:**
  - **Only proximity guides, no gap snap.** Rejected; users asked for an actual first snap.
  - **Snap to a fixed world gap at every zoom.** Rejected; the stops should feel consistent in screen pixels like the flush snap.
  - **Replace the flush snap with a gap snap.** Rejected; the existing next-to-neighbor behavior must remain.
  - **Show all nearby edge guides.** Rejected; one nearest guide per axis is calmer and matches the snap model.
  - **Use a literal grid overlay.** Rejected for this slice; a per-axis guide reuses the established alignment model.

- **Consequences:**
  - Dragging toward a neighbor first lands at a 16px gap, then jumps flush when the pointer continues into the 8px window.
  - Dragging away from flush returns to the gap stop before releasing completely.
  - At 25% zoom, the 24/64px screen thresholds cover larger world distances by design.
  - Solid and dashed guides can appear together on different axes.

- **Evidence / verification:**
  - Unit tests cover dashed preview, the 16px gap stop, the flush stop, and suppression of the preview when snapped.
  - E2e drags to a 50px gap for the dashed preview, then to a 30px pointer gap and verifies the resulting 16px snap, then into flush range; all guides clear on release.

## ADR-060 — Closing the last pane releases its exclusive profile

- **Status:** Accepted; sharing and the manager were later removed by ADR-062
- **Date:** 2026-11-20
- **Context:** Profiles were intentionally persistent after close, which left unused profiles and session data behind. Users asked for the profile to live with its pane and be cleared on close.

- **Decision:**
  1. When a pane is removed through an explicit close or an unexpected webContents destruction, check whether its profile still has a live pane.
  2. If no pane uses the profile, clear storage/cache/auth data, remove the profile metadata, and delete its partition directory. No extra confirmation is shown.
  3. If the profile is shared, keep it until the last pane using it closes.
  4. Do not release profiles during workspace switches, app shutdown, or the profile manager’s close-and-delete flow, because those paths either retain the workspace or already own profile cleanup.
  5. Keep unused profiles that come from other sources, such as duplicated workspaces or imports, available in the profile manager for explicit clear/delete.

- **Alternatives considered:**
  - **Keep profiles after close.** Rejected; it caused stale profiles and sessions to accumulate.
  - **Clear data but keep metadata.** Rejected; the profile record would remain without a pane to own it.
  - **Prompt before deleting.** Rejected; closing already has a one-step model, and multi-select Delete should stay fast.
  - **Delete profiles on workspace switch.** Rejected; workspace panes must be able to restore their authenticated sessions.

- **Consequences:**
  - Reopening a closed device starts with a fresh profile and signed out.
  - Shared profiles survive until their final pane closes.
  - Closing a pane can trigger asynchronous session cleanup; the pane disappears immediately while profile deletion completes.
  - Profiles from duplicated/imported workspaces can still appear unused and be cleaned from the manager.

- **Evidence / verification:**
  - E2e verifies Bob’s exclusive profile disappears after close, self-closed panes release their profiles, and shared Alice-profile panes keep the profile until only Alice remains.
  - An unused profile created by a duplicated workspace still supports rename, clear, and delete in the profile manager.

## ADR-061 — Keep Canvas overlays visible unless a menu covers them

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Opening any custom menu hid both the bottom canvas bar and the minimap until the menu closed. Most menus do not cover those overlays, so the hiding was unnecessarily disruptive.

- **Decision:**
  1. Keep the bottom bar and minimap visible while a menu is open unless the menu rectangle intersects that specific overlay.
  2. Keep both visible for the zoom, Arrange, and appearance menus, which are anchored to the bottom bar.
  3. Keep the current overlay visibility until the menu reports its final bounds. The menu is hidden during positioning, so hiding the overlays first only caused a visible flicker.
  4. Hide both while profile/workspace dialogs or the device palette are open, and while a marquee drag is active, matching the existing modal behavior.
  5. Use a separate validated overlay-visibility IPC so the minimap and bar can hide independently.

- **Alternatives considered:**
  - **Hide both for every menu.** Rejected; it removes useful context when the menu is nowhere near the overlays.
  - **Never hide them.** Rejected; native overlays sit above shell DOM and would cover a menu that reaches the bottom edge.
  - **Reposition menus away from overlays.** Rejected for this slice; it would complicate menu placement and make anchors less predictable.
  - **One shared visibility flag.** Rejected; a menu that covers only the minimap should not also remove the bottom bar.

- **Consequences:**
  - Most toolbar, pane, and upper-canvas menus leave both overlays visible.
  - Menus near the bottom edge hide only the overlay they actually cover.
  - Overlay placement is estimated in the shell from the same shared size constants used by main, using the uncollapsed minimap height as a conservative bound.

- **Evidence / verification:**
  - E2e opens the canvas menu at the upper-left and verifies both the minimap and bottom bar remain visible; Escape restores native panes normally.
  - The overlay-visibility channel validates trusted sender and both boolean fields in main.

## ADR-062 — Remove the Profiles manager and sharing; clear data per pane

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Profiles now live and die with their pane. The separate Profiles manager mostly managed leftover sessions, while explicit sharing conflicted with the goal that every pane behaves as an independent browser. Clearing data is still useful for a live pane that needs to sign out or reset.

- **Decision:**
  1. Remove the native **Profiles** menu, the Profiles dialog, profile labels/counts in the chrome, sharing, and the profile picker IPC.
  2. Every pane owns one independent session. New and duplicated panes receive fresh profiles; sharing is not supported.
  3. Add **Clear Site Data…** to the device actions menu. It opens a confirmation menu, clears cookies/storage/cache/auth for that pane's profile, and reloads the pane.
  4. Keep `profiles.json` as an internal registry for restoring partitions across restarts. It is not a user-facing feature.
  5. When an inactive workspace is deleted, release profiles referenced only by that workspace and not by another workspace or live pane.
  6. Closing a pane continues to release its session immediately with no extra confirmation.

- **Alternatives considered:**
  - **Keep the manager for clearing live data.** Rejected; a per-pane action is closer to the thing being cleared and removes a large dialog.
  - **Keep explicit sharing.** Rejected by the product decision that each pane is an independent browser; sharing created hidden cross-pane effects.
  - **Use a native confirmation dialog for Clear Site Data.** Rejected; the existing custom menu can present a second confirmation step with consistent styling and keyboard behavior.
  - **Delete inactive-workspace profiles eagerly on app start.** Deferred; workspace deletion is the clear lifecycle boundary.

- **Consequences:**
  - There is no way to reuse a signed-in session after closing its pane.
  - Clearing data never affects another pane.
  - `profiles.json` can still contain profiles for inactive workspaces until those workspaces are deleted or opened.
  - Deleting an inactive workspace also releases its unreferenced sessions.

- **Evidence / verification:**
  - E2e asserts the native `profiles-manage` item is absent, cancels and confirms Clear Site Data on a temporary pane, verifies localStorage is cleared and the pane reloads, and confirms Alice's session is untouched.
  - Existing e2e coverage verifies exclusive-profile release after close and self-close.

## ADR-063 — Move the address bar into a two-row pane header

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The main top toolbar carried the active pane's address and viewport controls, which made the toolbar busy and separated the URL from the page it belonged to. The product direction is a minimal main toolbar and each pane behaving as a separate browser.

- **Decision:**
  1. Move the address bar into a second row of each pane header. The first row keeps the grip, title, viewport trigger, navigation, actions, and close.
  2. Reduce the main toolbar to Add and draggable space.
  3. Increase the Canvas header allowance from 32 to 64 CSS pixels so both rows have room at every zoom.
  4. Keep custom viewport editing in the pane's address row, replacing the address temporarily.
  5. Update focus behavior so `Cmd/Ctrl+L`, dialog close, and palette selection target the active pane's own address input.
  6. Keep the address row keyboard reachable; tab order runs through the pane actions and then its address input.

- **Alternatives considered:**
  - **Keep the address in the top toolbar.** Rejected; it separates the URL from its pane and keeps the main toolbar heavy.
  - **Put both address and navigation in the second row.** Rejected for this slice; the existing navigation controls remain in the first row.
  - **Use an overlay address bar above native content.** Rejected; native `WebContentsView` stacking makes the header row the safe place.
  - **Keep the 32px header and squeeze the address inline.** Rejected; it would crowd the title and actions at mobile widths.

- **Consequences:**
  - Each pane is visually and functionally self-contained: URL, viewport, navigation, session, and actions.
  - Canvas frames are 32px taller, and the header chrome scales with Canvas zoom like before.
  - The top toolbar is mostly empty draggable space with Add on the right.
  - Narrow frames keep the address full-width on its own row.

- **Evidence / verification:**
  - E2e and accessibility tests verify per-pane address inputs, the Add-only toolbar, two-row containment at 390 × 844, focus order, and `Cmd/Ctrl+L` target.
  - The full workspace/session restart test still restores URLs and viewport state.

## ADR-064 — Phone and tablet presets use mobile metrics and touch input

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** A pane set to a phone preset still showed desktop behavior: a classic 15 px scrollbar, `hover: hover`, `pointer: fine`, and `maxTouchPoints: 0`. The viewport dimensions were correct, but sites and media queries could tell the pane was a desktop browser. Electron's `enableDeviceEmulation` uses a desktop screen position by default and did not expose touch behavior.

- **Decision:**
  1. Classify phone and tablet presets in `src/shared/viewports.ts` as mobile-behavior viewports; desktop, responsive, and custom viewports stay desktop.
  2. Apply fixed viewports with Chromium's `Emulation.setDeviceMetricsOverride` over the attached debugger, using `mobile: true` for phone/tablet and `mobile: false` for desktop presets.
  3. Enable `Emulation.setTouchEmulationEnabled` with five touch points for phone/tablet presets and disable it otherwise.
  4. Use the same CDP path for fixed and Canvas-zoomed responsive emulation, and `Emulation.clearDeviceMetricsOverride` when a responsive pane returns to 100% Canvas zoom. Mixing Electron's `enableDeviceEmulation` with CDP metrics left stale overrides when switching presets.
  5. Keep the exact CSS viewport and fit scale. Mobile metrics must not reintroduce Chromium's 980 px fallback layout.

- **Alternatives considered:**
  - **`screenPosition: 'mobile'` through Electron's API.** Rejected; it reported a 981 px layout for the fixture despite a 375 px preset.
  - **Keep desktop behavior and only swap the user agent.** Rejected; the scrollbar and media-query signal still identify a desktop browser.
  - **Apply touch emulation to every preset.** Rejected; desktop and responsive panes should keep normal pointer behavior.

- **Consequences:**
  - Phone/tablet panes render mobile scrollbars, honor viewport meta tags, and report `hover: none` and `pointer: coarse`.
  - Desktop/responsive panes keep classic scrollbars and fine-pointer behavior.
  - Pane teardown must detach or release the debugger session with the owned `webContents`; the existing close lifecycle already destroys the view.
  - Debugger attach failures are logged once per pane and do not block navigation.

- **Evidence / verification:**
  - A running-app probe at iPhone SE reports 375 × 667, `scrollbarWidth: 0`, `maxTouchPoints: 5`, `hover: false`, `pointerFine: false`, and `pointerCoarse: true`.
  - The same probe confirms switching back to Responsive restores 0 touch points and fine-pointer media.
  - Unit tests cover the mobile-behavior classification; the full e2e suite covers preset switching, responsive clearing, and pane teardown.

## ADR-065 — Show viewport class and resolution in the pane header

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The viewport trigger carried the preset name and dimensions, which crowded the first header row at narrow widths. The active preset did not state whether it was a phone, tablet, or desktop surface, and the dimensions disappeared below 470 px.

- **Decision:**
  1. Keep the preset name in the first row's viewport trigger.
  2. Use the second row for a compact viewport class label on the left (`Phone`, `Tablet`, `Desktop`, `Responsive`, or `Custom`) and the CSS resolution on the right (`390 × 844`).
  3. Center the address input between those labels at rest.
  4. Hide both side labels while the inline custom viewport editor is open so the editor keeps the full row.
  5. Hide both side labels below a 360 px pane width so the address stays centered; the full preset and resolution remain in the viewport trigger's tooltip and menu.

- **Alternatives considered:**
  - **Put both labels in the first row.** Rejected; title, viewport, navigation, and actions already compete for that row.
  - **Append the class to the preset name.** Rejected; it lengthens the trigger and still leaves the dimensions cramped.
  - **Use icons for the device class.** Rejected; icons add ambiguity without saving meaningful space.

- **Consequences:**
  - The pane communicates both what kind of device it imitates and its exact CSS size.
  - The second row has a stable left/right structure around the centered address.
  - The words describe emulation, not physical hardware; they do not claim sensors, GPS, or device APIs.

- **Evidence / verification:**
  - E2e asserts `Phone` and `390 × 844` in a mobile pane's second row.
  - The WebContentsView probe confirms the displayed resolution matches the page's `window.innerWidth`/`innerHeight`.

## ADR-066 — Workspaces panel follows the compact menu language

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** The Workspaces dialog used a wide document-style layout with a large header, descriptive paragraph, and footer Close button. It felt heavier than the app's custom context menus and duplicated the header X.

- **Decision:**
  1. Narrow the panel to 460 px and constrain its height to 70 vh.
  2. Use a compact header with the title and close control only; move the description to an `sr-only` element so the accessible name and description remain.
  3. Use menu-like row spacing, rounded hover surfaces, and 10–12 px type. Each row selects its workspace directly and exposes a per-row actions trigger for Rename, Duplicate, and Delete in the shared custom menu component.
  4. Remove the footer Close button; the header X, Escape, and backdrop click close the panel.
  5. Keep the focus trap, initial dialog focus, focus return, and full keyboard operation. Escape closes an open row menu before the panel.

- **Alternatives considered:**
  - **Keep the footer Close button.** Rejected; it duplicates the header X and adds visual weight.
  - **Keep four inline text actions per row.** Rejected; they crowded the row, forced metadata to wrap, and felt like a settings form rather than a menu.
  - **Convert the panel into a popover anchored to the toolbar.** Rejected; the panel manages persistent workspaces and is not a transient action list.
  - **Remove the description entirely.** Rejected; `aria-describedby` still explains the panel to assistive technology.

- **Consequences:**
  - Workspaces feels like the rest of PaneFlow's menus and takes less visual attention.
  - The dialog remains modal and keyboard accessible.
  - Focus order now ends at **Export active** instead of a footer Close button.
  - Switching is one click; less frequent rename, duplicate, and delete actions take one more click through the row menu.

- **Evidence / verification:**
  - The accessibility e2e test verifies dialog name, description, initial focus, Tab/Shift+Tab trap, row-menu disabled states, Escape ordering, and focus return after removing the footer button.
  - Workspace creation, rename, delete, switch, duplicate, and export e2e coverage passes through the row actions menu.
  - A running-app screenshot confirms the 460 px panel, single-line row metadata, visible header close control, and menu-styled actions popover.

## ADR-067 — The Canvas backdrop extends behind the top toolbar

- **Status:** Superseded by ADR-070; the transparent look implied panes could live behind the bar, which the native view stack cannot support.
- **Date:** 2026-11-20
- **Context:** The top toolbar now contains only Add, occasional marquee-selection feedback, and draggable macOS titlebar space. Its opaque surface and bottom border created a separate chrome strip above the Canvas dotted backdrop, making an almost empty row look heavier than its contents.

- **Decision:**
  1. Keep the 42 px toolbar geometry, macOS traffic-light padding, drag region, and Add control.
  2. Move the Canvas dot field from the workspace element to the app shell so one continuous backdrop runs from the top edge through the workspace.
  3. Make the toolbar transparent and remove its bottom divider in Canvas mode. Add and selection feedback float above the backdrop.
  4. Keep pan-driven background positioning through shell-owned CSS variables, offset by the toolbar height so the dot grid remains aligned with the workspace world.
  5. Keep the opaque surface treatment for non-Canvas layout modes.

- **Alternatives considered:**
  - **Remove the toolbar from the layout.** Rejected; the window still needs a macOS drag region, traffic-light clearance, and the Add control without letting native pane views cover them.
  - **Let pane content extend under the toolbar.** Rejected; native `WebContentsView`s stack above shell DOM and would cover the Add control.
  - **Keep the surface but remove only the border.** Rejected; the empty strip would still read as a separate band.

- **Consequences:**
  - The Canvas looks like it starts at the top edge of the window.
  - Add remains discoverable as a quiet floating control.
  - The toolbar remains stable at 42 px, so Canvas geometry and native bounds do not move.
  - Dialogs, the error banner, and menus keep their own opaque surfaces above the backdrop.

- **Evidence / verification:**
  - E2e asserts the Canvas toolbar has a transparent background and transparent bottom border, and that the app shell owns the radial-gradient backdrop.
  - Running-app screenshots in light and dark appearance confirm a continuous dot field behind the toolbar and aligned with the workspace.

## ADR-068 — Fit all keeps panes clear of the bottom Canvas bar

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Fit all centered panes inside the whole workspace rectangle. The native bottom Canvas bar overlays the bottom 52 DIP of that rectangle, so tall or newly added panes could be centered partly behind the bar's buttons.

- **Decision:**
  1. Define one safe Canvas viewport: 24 px top and side padding, and a bottom inset of 12 px bar margin + 40 px bar height + 12 px clearance.
  2. Use that safe viewport for Fit all, single-pane focus, partially visible pane centering, and reveal clamping.
  3. Scale panes down when the safe height is smaller than their world frame instead of letting their bottoms slide under the bar.
  4. Leave minimap recentering as a direct world-point action; the minimap's own corner overlap behavior is unchanged.

- **Alternatives considered:**
  - **Reserve bottom space only under the centered 422 px bar.** Rejected for this slice; per-frame horizontal checks add complexity and produce uneven bottom edges.
  - **Hide the bottom bar during Fit all.** Rejected; the command usually originates from that bar, and hiding it would make the result harder to inspect.
  - **Allow a small overlap to preserve 100% zoom.** Rejected; the user explicitly asked that devices not sit behind the bottom controls.

- **Consequences:**
  - Initial and explicit Fit all may choose a zoom below 100% when tall panes would otherwise reach the bar.
  - Fitted panes keep at least 12 px between their bottom edge and the bar.
  - Pane focus and recovery centering use the same safe area, so selecting a pane does not tuck it under the bar.
  - The minimap can still cover a pane corner by design.

- **Evidence / verification:**
  - E2e applies Fit all and asserts every pane card bottom stays above the native zoom bar top with clearance.
  - Running-app measurements show the bar at `y = 808` in an 860 px content area and fitted pane bottoms at `y = 796`.

## ADR-069 — Pane dragging keeps the header below the top workspace edge

- **Status:** Accepted
- **Date:** 2026-11-20
- **Context:** Canvas panes can be positioned freely. Dragging a pane upward could put its entire header above the workspace top, leaving only the page body visible under the top toolbar and making the device look clipped or lost.

- **Decision:**
  1. Clamp dragged pane positions so the pane's top edge remains at least 24 px below the workspace top.
  2. Apply the clamp in world coordinates using the current Canvas pan and zoom, preserving the same inset at every zoom.
  3. Suppress horizontal snap guides when the top clamp overrides a vertical snap.
  4. Leave canvas panning unrestricted so users can still navigate the infinite world; Fit all, pane selection, and reveal centering remain the recovery paths for intentionally off-screen panes.

- **Alternatives considered:**
  - **Clamp canvas panning as well.** Rejected; it would prevent panning to panes below the visible area.
  - **Let headers go above the toolbar.** Rejected; the device becomes easy to lose and the top bar makes the clipping look like hidden chrome.
  - **Keep the old opaque toolbar as a cover.** Rejected; it would hide content without restoring access to the header.

- **Consequences:**
  - Dragging a pane upward stops once its header has 24 px of clearance below the top edge.
  - Users can still pan the Canvas so panes move off-screen deliberately; selecting such a pane or using Fit all restores it.
  - The pure `clampCanvasPaneTop` helper keeps the math testable outside Vue.

- **Evidence / verification:**
  - Unit tests cover clamping with canvas pan/zoom, an already-visible pane, and the top inset.
  - A running-app drag 220 px upward stops at the 24 px inset with the pane header fully visible.

## ADR-070 — Restore the opaque top toolbar

- **Status:** Accepted; supersedes ADR-067
- **Date:** 2026-11-20
- **Context:** Making the toolbar transparent and extending the Canvas dot field to the top edge implied that pane content could live behind the bar. In practice, pane `WebContentsView`s stack above the shell, so a pane cannot extend into that band without covering the Add control and drag region. The transparent look made the reserved 42 px feel like hidden or clipped content.

- **Decision:**
  1. Restore the opaque `--surface` toolbar background and its 1 px bottom divider.
  2. Move the Canvas dot field back to the workspace, below the toolbar, and restore pan-driven `background-position` on that element.
  3. Keep the 42 px toolbar height, traffic-light clearance, drag region, and Add-only content.
  4. Keep the bottom-bar-aware Fit all and the 24 px top clamp for pane dragging.

- **Alternatives considered:**
  - **Keep the transparent bar with a scrim.** Rejected; it would still imply overlap without making pane headers live in that space.
  - **Build a native top-bar overlay.** Deferred; it is a larger composition change, not a visual revert.
  - **Let pane snapshots show behind the bar.** Rejected; the strip would look live but would not be interactive.

- **Consequences:**
  - The toolbar reads as reserved application chrome rather than empty canvas.
  - The dotted workspace starts below the toolbar, matching the actual native-view boundary.
  - Fit all and pane dragging still keep devices clear of the top and bottom chrome.

- **Evidence / verification:**
  - E2e and running-app screenshots verify the opaque toolbar, workspace-owned dot backdrop, and pan-driven background position.
  - Fit all and pane drag-clamp coverage remain unchanged.

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
