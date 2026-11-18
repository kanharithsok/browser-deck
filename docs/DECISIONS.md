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
  - The 160 × 120 CSS-pixel card minimum is a layout-engine default, distinct from the existing 80 × 60 native-view minimum. The wiring slice must reconcile them.
  - Snap distances are CSS-pixel/DIP values; shell zoom remains disabled to avoid coordinate drift.

- **Evidence / verification:**
  - `tests/unit/layout.test.ts` covers 33 cases for grid placement/reflow, columns 1–5, overflow flags, add/remove/reorder, clamping, move/resize, normalized conversion, snapping, ordering, and maximize/restore.
  - `npm run test:unit` passes with 67 tests across 5 files.
  - The engine is not wired into the renderer yet; the existing CSS auto-fit grid and native bounds behavior are unchanged.

## ADR template

### ADR-NNN — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Evidence / verification:**
