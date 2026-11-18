# Phase Reports

The agent updates this file at the end of each phase. Record actual outcomes, not intended outcomes.

## Phase 0 — Repository bootstrap and native-view spike

- **Status:** Complete; merged in PR #1. CI passed for that PR.
- **Environment:** macOS 27.2.1 (Mac16,12, Apple M4, Retina `devicePixelRatio` 2), Node.js 24.22.3, npm 11.19.1, Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, Vue 3.5.45, TypeScript 6.0.3.

### Delivered

- npm project with a `package-lock.json`, `.nvmrc` for Node 24, strict TypeScript configs, ESLint, Vitest, and Playwright.
- `BaseWindow` application with a trusted Vue shell `WebContentsView`.
- Two independently navigable `WebContentsView` panes using separate persistent `persist:paneflow-profile-<uuid>` partitions.
- Pane chrome outside native bounds: title, profile label, back/forward/reload, editable address bar, loading/error status, native actions menu, and close.
- Add-pane, close-pane, reload-all, address navigation, back, forward, and reload operations through a typed preload bridge.
- Validated bounds synchronization from shell content placeholders to native views, including window resize handling. The first navigation is deferred until valid bounds exist, so pages do not start with a 0 × 0 viewport.
- Native view visibility rules for initial bounds, `about:blank`, and load-failure states.
- Unexpected `webContents` destruction removes the stale pane cleanly instead of leaving controls that throw.
- Dev-shell loading accepts only a loopback `http(s)` `ELECTRON_RENDERER_URL` in unpackaged runs, rejects cross-origin shell redirects, and verifies the loaded shell origin.
- Internal profile registry with atomic JSON writes, serialized saves, unique temporary names, corruption preservation, and stable partition reuse across restarts.
- Session policy: permissions denied, notifications denied, popups denied, downloads prevented, and `http`/`https`/`about:blank` navigation enforcement.
- Remote views with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and no application preload.
- Playwright-driven teardown verification: closed pane removes its view, destroys its `webContents`, and leaves the remaining pane untouched. Focus moves to the new pane after add and recovers to an address control after close.
- System light/dark tokens exercised in the renderer; explicit theme selection remains Phase 4.
- Deterministic local fixture server; e2e launches the built app, not a mock.
- Restored the documented `.opencode/commands` and `.opencode/skills` assets that were missing from the checkout.
- Added CI configuration for typecheck, lint, unit tests, and build. CI passed on PR #1 and PR #2.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npm install` | Passed. Installed 217 packages and created/updated the lockfile. |
| `npm audit` / `npm audit --omit=dev` | Dev toolchain: 13 high-severity advisories via `picomatch` (ReDoS). Runtime dependency audit: 0 vulnerabilities. The latest installed `picomatch` 4.0.7 was still covered by the advisory and no fixed release was available. |
| `npm run typecheck` | Passed (`tsc` for main/preload/shared/tests and `vue-tsc` for the renderer). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 4 files, 34 tests. Covers bounds validation, URL normalization/scheme rejection, loopback hostname checks, profile IDs/partitions/labels, store seeding, corrupt-file recovery, concurrent write safety, and persistence. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (35.44 kB), `out/preload/index.js` (1.93 kB), and the renderer bundle/CSS. |
| `npm run test:e2e` | Passed at Phase 0 completion: 1 Playwright test, 1.2 s. It launched the built app against a random local fixture server, verified two isolated profiles, cookies, `localStorage`, bridge/Node absence, popup and notification denial, light/dark design tokens, page viewport matching the pane content rectangle, DOM/native bounds alignment before and after resize, address/back controls, address-error recovery, focus handoff after add/close, malformed IPC rejection, closed-pane `webContents` destruction, self-closed pane removal, fresh profile for a new pane, and cookie/profile-ID persistence after restart. The same test was expanded with Phase 1 authentication coverage. |
| `npm run dev` | Passed manually. Fixture server and electron-vite started; the app window loaded the Vue shell and both fixture panes. |
| Native menu check | Passed manually. The pane actions `Menu.popup` rendered above native browser content. Automated menu interaction is not yet in the e2e suite. |
| Retina/composition check | Passed manually. Both panes reported `623 × 696` CSS pixels and `devicePixelRatio: 2`; chrome and native content remained aligned. |
| `npm run start` | Passed launch check: electron-vite rebuilt and started the built app. No interactive walkthrough beyond the e2e run was performed. |
| `npm run package:mac` | Unavailable. macOS packaging is Phase 4 work and no script exists yet. |

### Architecture decision

ADR-001 in `docs/DECISIONS.md`: trusted shell `WebContentsView` plus inset `WebContentsView` rectangles, chrome outside native bounds, native menus for overlays, renderer measurement with main-process validation, CSS pixels/DIP without `devicePixelRatio` multiplication, and explicit teardown.

### Independent reviews

- **Security review:** no critical or high findings. Confirmed IPC sender/payload validation, partition isolation, sandboxing, and popup/permission/download policy. Fixed confirmed issues: cross-origin/unpackaged dev-shell loading is now loopback-only and origin-checked; unexpected `webContents` destruction removes stale panes; profile saves are serialized with unique temp files; window-teardown races no longer leak a new view. Remote HTTP ambiguity remains a documented security-UI gap.
- **UI/accessibility review:** addressed narrow-width address-error visibility and persistence, focus ring/contrast, neutral/error status indication, 24 px targets, focus handoff after add/close, async error handling, and redundant bounds IPC. Native-pane keyboard focus remains deferred to Phase 2.

### Manual evidence

- Two live fixture panes displayed independent cookies (`paneflow_user=alice` and `paneflow_user=bob`) with profile labels “Profile 1” and “Profile 2”.
- The pane actions native menu overlapped both a pane header and native browser content, confirming the menu overlay strategy.
- Browser viewport metrics reported `623 × 696` at DPR 2, matching the shell card content measurement after the deferred initial load fix.
- Node and the app bridge were absent in both remote pages; popups and notification requests were denied.
- Screenshots and user-data directories were kept outside the repository and were not committed.

### Known issues / risks

- Phase 0 startup always creates two panes and seeds two profiles; workspace persistence and restoration are not implemented.
- The workspace grid shrinks panes instead of scrolling. Native views are not clipped by DOM overflow; scroll-aware layout is deferred to Phase 2. Below the 80 × 60 minimum content size, bounds are rejected and the shell shows an alignment error banner.
- During live window resizing, alignment converges after a layout frame rather than synchronously.
- Pane drag/resize, freeform layout, snapping, maximize/restore, viewport presets, and profile management are not implemented.
- Only profile metadata and cookie/storage partition data persist. URLs, titles, layout, and active workspace do not.
- Remote `http:` addresses are not visually distinguished from HTTPS yet. The URL helper computes `insecureRemote`, but the state/UI does not surface it; this is a later security-UI gap.
- If a page closes its own `webContents`, the pane is removed cleanly but without a user-facing explanation. This needs a later shell notice.
- The shell CSP allows inline styles and localhost WebSocket connections for development; production hardening is deferred to Phase 4.
- The app is not packaged, signed, or notarized. The macOS menu shows “Electron” while running unpackaged.
- Native menu behavior is verified manually; the test driver must close a native popup before shutdown, and the automated suite does not cover popup interaction.
- Keyboard focus can move through shell chrome, but there is no command or focus indicator for entering native pane content yet. This is Phase 2 keyboard work.
- Zoom is not implemented. The application menu deliberately omits zoom roles so shell zoom cannot desynchronize CSS-pixel measurements from native DIP bounds.
- `npm audit` has 13 high-severity dev-toolchain advisories with no fixed `picomatch` release at verification time.
- TypeScript is pinned to 6.0.3 because current `typescript-eslint` does not support TypeScript 7.
- CI passed on PR #1 and PR #2. Phase 2 changes are uncommitted and have not run in GitHub CI.

### Next smallest slice

Phase 1 (completed below): independent authentication with a deterministic local fixture and restart persistence. Do not begin the Phase 2 layout engine until the Phase 1 exit criteria and report are reviewed.

## Phase 1 — Browser isolation foundation

- **Status:** Complete; merged in PR #2. CI passed for that PR.
- **Environment:** macOS 27.2.1 (Mac16,12, Apple M4, Retina `devicePixelRatio` 2), Node.js 24.22.3, npm 11.19.1, Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, Vue 3.5.45, TypeScript 6.0.3.

### Delivered

- Phase 0's secure shell, BrowserManager, per-pane persistent partitions, navigation controls, loading/error states, popup/permission policies, and teardown remain the foundation.
- Deterministic fixture authentication:
  - `/login` signs into a synthetic Alice or Bob account with a form POST and no passwords or real credentials.
  - `/account` is server-rendered from an HttpOnly, persistent session cookie scoped to the browser profile.
  - `/logout` clears only the current profile's server session.
  - Sessions are held only in the fixture server process and each profile's Electron cookie jar.
- Integration coverage now proves:
  - Alice and Bob authenticate independently on the same fixture origin in separate panes.
  - The session cookie is HttpOnly and invisible to `document.cookie`.
  - Signing out of Bob does not sign Alice out.
  - Persistent cookies, localStorage, and the authenticated session survive an app restart.
  - IndexedDB and localStorage stay isolated between profiles.
  - Pane-specific back navigation does not affect the other pane.
- No production authentication code was added: PaneFlow does not own credentials or authorization; it preserves each website's cookies and storage inside the selected profile partition.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc` for main/preload/shared/tests and `vue-tsc` for the renderer). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 4 files, 34 tests. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (35.44 kB), `out/preload/index.js` (1.93 kB), and the renderer bundle/CSS. |
| `npm run test:e2e` | Passed: 1 Playwright test, 2.0 s. The test signs both panes into different fixture accounts through the real forms, verifies HttpOnly session separation and logout isolation, then restarts the app and confirms both sessions, profile cookies, localStorage, and profile IDs persist. It also retains the Phase 0 native bounds, lifecycle, security, focus, and self-close checks. |

### Exit criteria

At least two panes authenticate independently on the same local fixture origin and retain their intended persistent profile data after restart. Verified by the e2e flow above: Alice and Bob sign in separately, survive a full app relaunch with the same user-data directory, and remain isolated.

### Known issues / risks

- Profile manager operations (rename, clear data, delete, explicit shared-profile selection) remain Phase 3 work; the registry is still the minimal Phase 0/1 implementation.
- The fixture intentionally has no passwords and only two synthetic accounts; it verifies session isolation, not credential validation or identity-provider compatibility.
- Session-only cookies and `sessionStorage` remain outside restart guarantees; persistent cookies, localStorage, IndexedDB, and HttpOnly session cookies are covered.
- Shared-profile behavior is not exercised because explicit profile sharing is not implemented.
- Remote non-local HTTP is not yet visually distinguished; the URL helper computes `insecureRemote`.
- A page that closes its own `webContents` is removed cleanly without an explanatory notice.
- UI e2e depends on a macOS GUI session; CI runs typecheck, lint, unit tests, and build only.

### Next smallest slice

Phase 2: implement the pure TypeScript layout engine first (grid placement/reflow, normalized freeform geometry, minimum-size clamping, and snap calculations with unit tests), then wire grid mode to the existing pane model without regressing native bounds synchronization.

## Phase 2 — Workspace engine

- **Status:** Complete; uncommitted working-tree changes await repository-owner review. Phase 3 not started.
- **Environment:** macOS 27.2.1 (Mac16,12, Apple M4, Retina `devicePixelRatio` 2), Node.js 24.22.3, npm 11.19.1, Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, Vue 3.5.45, TypeScript 6.0.3.

### Delivered

- Added `src/shared/layout.ts`, a pure TypeScript layout engine with no Vue or Electron imports.
- Grid placement/reflow:
  - row-major equal-width columns;
  - 1–5 validated columns;
  - configurable padding, gap, and minimum card size;
  - required rows, content height, vertical-scroll flag, and narrow-column flag;
  - add/remove/reorder reflow through ordered pane ID arrays.
- Freeform geometry:
  - pixel-to-normalized and normalized-to-pixel conversion;
  - canvas-bound and minimum-size clamping;
  - move and eight-direction resize helpers;
  - snap targets for canvas edges/center, neighboring pane edges/center, and optional grid;
  - configurable snap threshold and alignment guides.
- Ordering and z-order helpers: move, bring to front, send to back.
- Maximize geometry with the previous rectangle returned for restore.
- 33 unit tests covering valid layouts, errors, reflow, resizing, normalized adaptation, snapping, ordering, and maximize/restore.
- Renderer grid mode:
  - pane cards are absolutely positioned from `layoutGrid` results rather than CSS auto-fit;
  - compact toolbar control selects 1–5 columns;
  - the workspace is re-measured after column changes, window resizes, and pane add/remove;
  - existing focus handoff, native bounds measurement, sessions, and teardown remain intact;
  - narrow columns surface an honest workspace notice instead of silently changing layout;
  - e2e verifies 2 → 5 → 1 → 2 column reflow, native bounds alignment at each step, and alignment after pane add/close.
- Native-aware grid scrolling:
  - the workspace scrolls to the engine's full content height;
  - native views are shown only when their content rectangle is fully inside the workspace viewport;
  - partially off-screen views are hidden, with a shell message, so they can never cover chrome or escape the workspace;
  - `setPaneBounds` carries a validated visibility flag; hidden off-canvas geometry is not applied to native views;
  - e2e forces an overflowing four-pane single-column grid, scrolls to the bottom, and verifies visible/hidden native view states and workspace-safe bounds.
- Grid drag reordering:
  - dragging a pane title row reorders the grid through the pure engine helper;
  - native views hide during an active drag so pointer movement continues to reach the trusted shell across the whole workspace;
  - the drop target gets a visible shell outline, and views restore with fresh bounds after the drop;
  - grid order is kept separately from the main-process pane snapshot order and reconciled on add/close;
  - e2e drags Bob onto Alice, verifies the order and native alignment, then drags back and verifies restoration.
- Freeform mode:
  - grid/freeform switch preserves grid columns/order and freeform geometry separately;
  - freeform geometry is stored normalized and converted to the current workspace canvas;
  - panes move by dragging the title row and resize from eight shell-visible edge/corner handles (a 6px inset keeps handles outside native content);
  - moves/resizes clamp to canvas and minimum size, snap to canvas edges and neighboring panes, and show alignment guides while native views are hidden;
  - dragged/resized panes are raised through a new typed `bringPaneToFront` IPC that reorders the native child view;
  - **Tidy** arranges freeform panes into the current grid column count;
  - e2e moves and resizes a pane, verifies native alignment and hidden native views during manipulation, switches grid → freeform → grid → freeform, and confirms both arrangements are preserved.
- Temporary maximize/restore:
  - a pane header action fills the workspace without modifying grid/freeform arrangement state;
  - unrelated native views are hidden through the existing validated visibility path while the maximized pane stays aligned;
  - restoring returns to the prior grid geometry with all native views aligned;
  - maximize state is temporary and is cleared on close or mode switch.
- Explicit freeform z-order controls:
  - pane header actions bring a pane to the front or send it to the back;
  - the renderer z-order list updates slot stacking, while typed IPC reorders the native child views;
  - test-only inspection verifies native child order;
  - e2e brings Bob forward, verifies native order and DOM z-index, then sends Bob back and verifies both orders reverse.
- Keyboard and menu actions:
  - a native **Pane** menu exposes add, close, reload active/all, maximize, and grid/freeform toggle commands with accelerators;
  - commands route through preload to the trusted shell and act on the active pane;
  - active-pane tracking follows shell pointer/focus and native pane focus events;
  - e2e invokes the menu commands for add/close/maximize/layout and verifies behavior.
- Eight-pane Phase 2 stress:
  - e2e resets to a two-column grid, adds enough panes for eight total, and verifies all native bounds align across four rows;
  - switches the eight-pane workspace to freeform, drags/overlaps and resizes a pane, exercises explicit z-order and maximize/restore, checks visible native counts, and restores grid alignment.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/layout.test.ts` | Passed: 36 layout tests. |
| `npm run test:unit` | Passed: 5 files, 72 tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run test:e2e` | Passed: 1 Playwright test, 6.7 s. Verifies native/auth/lifecycle/persistence behavior, grid reflow, drag reorder, scrolling, freeform move/resize/mode preserve, maximize/restore, explicit z-order, menu commands, and an eight-pane alignment/freeform stress pass. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (40.01 kB), preload (2.83 kB), and the renderer bundle. |
| Manual grid check | Passed. Two-column grid rendered with the new `Columns` control at 623 × 696 pane viewports and aligned native views. |

### Exit criteria

Met in the automated macOS run: eight panes were arranged in grid and freeform, moved, resized, z-ordered, maximized/restored, and interacted with while DOM content rectangles and native view bounds remained aligned. Pane state/session handling stayed intact. Keyboard accelerators are defined in the native menu and their command path is exercised through menu clicks; raw key-chord automation is still a follow-up.

### Known issues / risks

- Partially visible grid panes hide their native view while scrolling; the page is only interactive when fully in view.
- Freeform geometry, grid order, column count, layout mode, and maximize state are not persisted across restarts (Phase 3; maximize is intentionally temporary).
- Freeform drag/resize and mode switching are pointer-only; menu accelerators are configured but raw keystrokes are not e2e-tested.
- A fully covered pane can be unreachable until the covering pane moves.
- The engine's default minimum pane card is 160 × 140 CSS px, while main enforces a minimum native view of 80 × 60. Tested sizes produce valid bounds; the two contracts should still be unified and checked at the minimum window size.
- Snapping is unit-tested and wired into moves/resizes, but guide visibility is not asserted by e2e.
- The 8-pane run uses four blank added panes; the four loaded fixture panes exercise native visibility.
- Native scroll behavior is verified at one small-window configuration; more stress/performance measurement remains.

### Next smallest slice

Phase 3: implement per-pane viewport presets and custom dimensions with Electron device emulation, verify `window.innerWidth`, `window.innerHeight`, and `devicePixelRatio` from the local fixture, and add fit/actual display scale handling without changing native bounds validation.

## Phase 3 — Viewport emulation and persistence

- **Status:** Not started
- **Delivered:** —
- **Verification commands and results:** —
- **Known issues / risks:** —
- **Next smallest slice:** —

## Phase 4 — Polish and macOS packaging

- **Status:** Not started
- **Delivered:** —
- **Verification commands and results:** —
- **Known issues / risks:** —
- **Next smallest slice:** —
