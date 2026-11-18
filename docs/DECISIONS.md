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

- **Status:** Accepted
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
  6. Maximized/focused state is intentionally not persisted. Only the default workspace and active workspace pointer exist in this slice; workspace creation/switching UI is deferred.
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

## ADR template

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
