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

- **Status:** Accepted; the fit/actual mode choice is superseded by ADR-028
- **Date:** 2026-11-18
- **Context:** `SPEC.md` §10 requires per-pane viewport presets, custom dimensions, a device scale factor, and fit/actual display scale modes. The emulated CSS viewport must match the configured values even when visual fit changes the rendered size. Electron 45 exposes `webContents.enableDeviceEmulation` with `screenPosition`, `screenSize`, `viewPosition`, `deviceScaleFactor`, `viewSize`, and `scale`.

- **Decision:**
  1. Keep preset definitions, validation, custom parsing, and fit-scale math in the pure TypeScript `src/shared/viewports.ts` module.
  2. Apply emulation with `screenPosition: 'desktop'` and `viewSize` equal to the requested CSS width and height. Desktop positioning keeps `window.innerWidth`, `window.innerHeight`, and media queries at the configured dimensions. Mobile positioning produced Chromium's 980 px fallback layout for fixture pages without a viewport meta tag.
  3. Set `deviceScaleFactor` to the preset or custom value. Set `scale` to the fit ratio in fit mode and `1` in actual mode. Disable emulation for responsive panes.
  4. Keep the native view inside its validated pane bounds. Only the CSS layout and render scale are emulated; no user agent, touch, GPS, or device API behavior is spoofed.
  5. Store viewport state in the main-process pane record and expose it in `PaneState`; the renderer owns the controls and sends validated settings through typed IPC.
  6. Reject invalid custom values in both the renderer and main process. Do not silently clamp input.

- **Alternatives considered:**
  - **`screenPosition: 'mobile'`.** Rejected for this slice because pages without a viewport meta tag fall back to a 980 px layout, so the fixture cannot prove that presets set the intended CSS viewport.
  - **Resize the native view to the emulated dimensions.** Rejected because native views cannot extend or clip within the pane safely, and changing the view size changes the CSS viewport.
  - **Renderer CSS transforms or iframes.** Rejected; native `WebContentsView` is the required pane renderer and cannot be transformed or clipped by DOM.
  - **User-agent strings named after devices.** Rejected as dishonest and outside the viewport-only scope; optional UA overrides remain deferred.
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

- **Status:** Accepted
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

- **Status:** Accepted
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

- **Status:** Accepted
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

- **Status:** Accepted
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
  7. Use the existing global active-pane bar and compact per-pane labels in Canvas mode.
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

- **Status:** Accepted
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

## ADR-034 — Canvas overview is a modal minimap with one-click Fit all

- **Status:** Accepted
- **Date:** 2026-11-19
- **Context:** Users can pan or zoom far enough to lose every pane. A persistent DOM minimap cannot float over native `WebContentsView` pages, and a permanent side panel would reduce the already-limited canvas area and force layout shifts.

- **Decision:**
  1. Add a Canvas overview dialog containing a projected minimap of every pane and the current viewport.
  2. Include both pane bounds and viewport bounds in the projection, so distant panes remain visible even after panning far away.
  3. Selecting a pane centers it, fits a zoom that can show the whole frame, and closes the overview. Selecting empty map space centers that world point.
  4. Add a one-click **Fit all panes** action to the Canvas global bar, plus a Fit all action in the overview.
  5. Hide native views while the overview is open through the existing measured-visibility path; no DOM overlay is attempted over native content.
  6. Keep the overview as a modal preview rather than a permanent sidebar.

- **Alternatives considered:**
  - **Persistent minimap overlay.** Rejected; native views cover the shell.
  - **Persistent side dock.** Rejected for the minimal layout; it shrinks the canvas and shifts every pane.
  - **Native menu listing panes.** Rejected; it provides no spatial preview.
  - **Fit-only control with no map.** Rejected; users still need to understand where panes went.

- **Consequences:**
  - Recovery takes two actions (overview → pane/Fit), while the global bar Fit action is one click.
  - Opening the overview temporarily hides live native views and shows snapshot/placeholder content behind the modal.
  - Fit all may change pan and zoom; it does not modify world positions.
  - No new persistence format is required. Viewport pan/zoom remain transient.

- **Evidence / verification:**
  - Unit tests cover frame projection, viewport inclusion, far-away viewport bounds, and empty/invalid inputs.
  - E2e opens the Canvas overview, verifies two frame buttons and the viewport rectangle, hides native views, clicks Fit all, verifies the dialog closes, and asserts both cards fit fully inside the workspace with native bounds aligned.
  - Existing Canvas pan/zoom/drag/content tests continue to pass.

## ADR template

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
