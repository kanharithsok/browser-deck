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
- CI passed on PR #1 and PR #2. Phase 2 changes are in stacked PRs #10 and #11; both passed CI.

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

- **Status:** Complete; PR #11 open (stacked on PR #10), CI passed. Phase 3 is in progress.
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
- At Phase 2 completion, freeform geometry, grid order, column count, and layout mode were not persisted; Phase 3 now restores them. Maximize remains intentionally temporary.
- Freeform drag/resize and mode switching are pointer-only; menu accelerators are configured but raw keystrokes are not e2e-tested.
- A fully covered pane can be unreachable until the covering pane moves.
- The engine's default minimum pane card is 160 × 140 CSS px, while main enforces a minimum native view of 80 × 60. Tested sizes produce valid bounds; the two contracts should still be unified and checked at the minimum window size.
- Snapping is unit-tested and wired into moves/resizes, but guide visibility is not asserted by e2e.
- The 8-pane run uses four blank added panes; the four loaded fixture panes exercise native visibility.
- Native scroll behavior is verified at one small-window configuration; more stress/performance measurement remains.

### Next smallest slice

Phase 3: implement per-pane viewport presets and custom dimensions with Electron device emulation, verify `window.innerWidth`, `window.innerHeight`, and `devicePixelRatio` from the local fixture, and add fit/actual display scale handling without changing native bounds validation.

## Phase 3 — Viewport emulation and persistence

- **Status:** Complete for the Phase 3 exit criteria. Per-pane viewport emulation, workspace persistence/restore, and the profile manager are implemented and verified. Workspace management and window bounds continued in Phase 4.
- **Environment:** macOS 27.2.1 (Mac16,12, Apple M4, Retina `devicePixelRatio` 2), Node.js 24.22.3, npm 11.19.1, Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, Vue 3.5.45, TypeScript 6.0.3.

### Delivered so far

- Added `src/shared/viewports.ts`, a pure TypeScript viewport module with no Vue or Electron imports:
  - responsive plus mobile, tablet, laptop, and desktop viewport classes;
  - custom width, height, and device scale factor validation (200–7680 px, DPR 0.5–4);
  - fit-scale calculation with safe handling of empty or invalid pane space.
- Added per-pane viewport state to `PaneState` and a validated `set-pane-viewport` IPC path.
- Pane header controls provide a preset selector, a fit/actual selector, and a custom row with width, height, DPR, Apply, and Cancel.
- Invalid custom values stay in the shell with a visible alert and do not reach the native emulation layer.
- Emulation uses Electron `webContents.enableDeviceEmulation` with matching CSS viewport, device scale factor, and display scale:
  - `screenPosition: 'desktop'` keeps the requested CSS viewport exact;
  - fit mode scales the emulated view to the available pane content;
  - actual mode renders at 1:1 CSS-pixel scale;
  - responsive mode disables emulation.
- Different panes can hold different presets at the same time.
- Pane headers wrap their address and viewport controls at narrow grid widths; five-column panes keep a usable address field with no horizontal overflow.
- 8 new unit tests cover preset lookup, custom parsing/rejection, and fit-scale calculation.
- E2e verifies mobile/tablet/custom metrics (`window.innerWidth`, `window.innerHeight`, `devicePixelRatio`) from inside the fixture pages, concurrent per-pane presets, invalid custom recovery, fit/actual emulation scale, return to responsive sizing, and five-column header wrapping.
- Added versioned workspace persistence:
  - `app-state.json` stores the active workspace ID;
  - `workspaces/default.json` stores stable pane IDs, profile references, URLs, viewport settings, layout mode, columns, grid order, freeform geometry, and freeform z-order;
  - all reads/writes are validated; writes use temporary files, fsync, and rename;
  - invalid files are preserved with `.corrupt-<timestamp>` and the app starts safely.
- Restore behavior:
  - pane definitions are created before the shell reads state, so the renderer sees the restored workspace on its first read;
  - existing profile IDs and partitions are reused; missing profile metadata is reconstructed against the same partition ID;
  - grid/freeform arrangements and selected columns restore independently;
  - maximized/focused state was intentionally not persisted at Phase 3; post-MVP ADR-027 added application-window maximize/full-screen restore, while pane maximize remains temporary.
- Renderer layout persistence:
  - the shell sends normalized layout state through a typed `save-workspace-layout` IPC after committed changes, but not during active drags;
  - freeform rectangles are copied into plain objects before IPC (Vue reactive proxies cannot be structured-cloned);
  - the main process normalizes unknown/missing pane references before writing.
- Fixed a restore-only Electron crash:
  - device emulation is deferred until a page has loaded; enabling it on an empty `WebContentsView` before its first navigation segfaulted Electron;
  - shutdown flushes queued workspace writes through `will-quit`.
- Added 14 tests: workspace schema validation/normalization (7), workspace store persistence/corruption/validation (5), profile ID restoration (1), and profile rename/remove validation (1).
- Extended the restart e2e to verify restored pane ID, profile, authenticated URL, mobile viewport, grid columns, freeform geometry, layout mode, native alignment, retained closed-profile cookies, and continued operation after restore.
- Added the profile manager:
  - toolbar **Profiles** action opens a shell dialog while native panes are temporarily hidden;
  - lists every profile with creation date and in-use pane titles;
  - rename updates metadata and live pane labels, rejecting empty/duplicate names;
  - clear removes cookies, storage, cache, and auth cache only after an inline confirmation;
  - delete clears data, removes metadata, and removes the partition directory only after confirmation;
  - at Phase 3 completion, clear/delete were blocked while any pane used the profile; Phase 4 added the close-and-delete flow;
  - e2e verifies in-use protection, rename persistence, cookie clearing, and metadata deletion.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/viewports.test.ts tests/unit/workspace.test.ts tests/unit/workspace-store.test.ts` | Passed: 8 viewport, 7 workspace schema, and 5 workspace-store tests. |
| `npm run test:unit` | Passed: 8 files, 94 tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run test:e2e` | Passed: 1 Playwright test, 8.0 s. Existing Phase 2 coverage plus viewport emulation, concurrent pane presets, validation, fit/actual state, five-column header wrapping, workspace restore after restart, and profile-manager lifecycle. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (68.76 kB), preload (3.71 kB), and the renderer bundle (244.72 kB). |
| Manual viewport check | Passed. The fixture reported 390 × 844 at DPR 3 in fit and actual modes. Fit rendered the page scaled down inside the pane; actual rendered at 1:1 and clipped the 844 px viewport at the pane's 696 px content height while the reported CSS viewport stayed 390 × 844. |
| Restore smoke check | Passed with a hand-authored workspace: one pane, mobile viewport, freeform geometry, and a fixture URL restored; the app stayed running. The failure path that enabled emulation before load was isolated to an Electron SIGSEGV and fixed by deferring emulation until `did-stop-loading`. |

### Exit criteria

Met in the automated macOS run. Different panes used independent viewport configurations; pane IDs, profile references, authenticated URLs, viewport settings, grid columns, freeform geometry, layout mode, and active workspace ID restored after restart; the profile manager listed usage, renamed profiles, rejected unsafe actions on in-use profiles, cleared unused profile data, and deleted unused profile metadata. Browser sessions for retained profiles remained isolated.

### Known issues / risks

- Actual mode clips an emulated viewport that is taller or wider than the pane; there is no pane-level pan/scroll for the oversized emulated surface yet.
- Fit mode scales the emulated page inside the native view but does not center it; the unused area is page background.
- Optional user-agent overrides from `SPEC.md` §10.2 are not implemented; no UA spoofing is performed.
- At Phase 3 completion only the default workspace existed; Phase 4 added create/rename/duplicate/switch/delete management on top of the active-ID pointer.
- Theme preference and multiple workspace files are not part of restored state yet; normal window bounds are now handled in Phase 4.
- Maximized/focused state was intentionally not persisted at Phase 3; post-MVP ADR-027 added application-window maximize/full-screen restore, while pane maximize remains temporary.
- At Phase 3 completion, profile clear/delete required all panes using the profile to be closed first; Phase 4 added close-and-delete.
- At Phase 3 completion, profile sharing UI was not implemented; Phase 4 added the profile-manager Open pane flow.
- Partition-directory removal after delete is best-effort; session data is cleared first, and leftover Chromium cache files are inaccessible through the profile manager.
- The display scale selector is hidden only by wrapping, not collapsed into the pane menu; very narrow freeform panes produce a taller three-row chrome block.
- Overlapping freeform panes can cover each other's headers and far resize handles; the 8-pane stress test dispatches z-order/maximize actions directly when another pane's header would intercept pointer events.
- The fixture verifies layout/dpr values, not touch, GPS, or device-specific APIs.

### Next smallest slice

Phase 4: accessibility and visual polish, performance stress, import/export, and unsigned arm64 packaging. Workspace management, safe window bounds, explicit profile sharing, theme persistence, and unsigned arm64 packaging are complete.

## Phase 4 — Polish and macOS packaging

- **Status:** Complete. The Phase 4 exit condition is met: the SPEC Definition of Done is satisfied, required checks pass, known limitations are documented, and the macOS app packages locally as an unsigned arm64 app. Signed/notarized distribution, manual VoiceOver review, and long-duration profiling are post-MVP follow-ups.

### Delivered so far

- Extended `app-state.json` with optional normal window bounds (`x`, `y`, `width`, `height`).
- Bounds are validated (minimum 720 × 520, maximum 10,000 px dimensions, finite positions) and ignored when invalid.
- On startup, saved bounds restore only when at least 120 × 80 px intersects a connected display's work area; otherwise the default window is used.
- Normal bounds and `maximized`/`fullScreen` flags are persisted after debounced move/resize/maximize/fullscreen changes and flushed on close. Post-MVP ADR-027 restores presentation only when the saved normal bounds remain visible; pane maximize remains temporary.
- App-state writes capture the workspace path at enqueue time, preventing a queued save from writing into a different active workspace.
- 2 new unit tests cover window-bounds validation and store persistence; the restart e2e sets a distinctive 1120 × 760 window, verifies the bounds in `app-state.json`, and checks restoration after relaunch.
- Workspace shortcuts:
  - added a native **Workspace** menu with stable IDs `workspace-next` and `workspace-previous` and accelerators `Cmd/Ctrl+Shift+]` and `Cmd/Ctrl+Shift+[`;
  - both items call the existing trusted `switchWorkspaceTo` main-process path directly; no new IPC surface or renderer keyboard handler was added;
  - workspace cycling uses deterministic name order with wraparound from a pure shared helper;
  - switches are serialized so a second menu action cannot overlap an in-flight switch; menu items disable during switching and while the window is unavailable;
  - menu enabled state refreshes after startup, workspace create/import/duplicate/delete/switch, and becomes disabled when only one workspace remains;
  - e2e invokes both real menu items, verifies `Cmd/Ctrl+Shift+]`/`[` metadata, cycles through three workspaces in both directions including wraparound, confirms each target's pane IDs, profiles, URLs, and native view alignment, and checks enabled state before creation and after deletion.
- Workspace management:
  - `WorkspaceStore` now lists, creates, renames, duplicates, switches, and deletes validated workspace files with unique case-insensitive names.
  - The active workspace ID is persisted in `app-state.json`; deleting the active or last workspace is blocked.
  - Switching persists the current pane definitions and layout, destroys the current native manager/views, creates the target panes and profiles, restores its persisted layout, and sends a full state refresh.
  - Duplicating a workspace copies pane URLs/viewports/custom titles and maps layout order/freeform geometry to new pane IDs while generating fresh profiles for every pane.
  - A toolbar workspace switcher opens a trusted dialog with active-state badges, pane counts, create, rename, duplicate, switch, and confirmed delete actions. Native views hide while the dialog is open.
  - The renderer resets pane/order/layout state when the workspace ID changes and applies the target workspace's saved layout.
  - Main-process test hooks now read the current manager/store rather than a captured initial manager, so switching works under e2e inspection.
  - Unit coverage verifies workspace store lifecycle and name validation; e2e creates a second workspace, switches to it, adds a pane, renames it, duplicates it with fresh profiles, switches back to the authenticated original workspace, verifies app-state, and deletes the extra workspaces.
- Explicit profile sharing:
  - the profile manager exposes **Open pane** for any existing profile; new panes still receive fresh profiles by default;
  - a validated `add-pane-with-profile` IPC creates a pane with the selected profile and default viewport;
  - pane headers show `· N panes` when a profile is referenced by multiple panes, and the profile manager usage reads `N panes: titles`;
  - shared-profile panes use the same persistent partition, so cookies and site storage are intentionally shared;
  - clear/delete support confirmed close-all-panes flows for shared profiles;
  - e2e opens two panes with one unused profile, verifies distinct pane IDs and shared localStorage, checks the shared count, verifies clear/delete protection, closes both panes, and confirms the remaining workspace is unchanged.
- Theme preference:
  - `app-state.json` stores `system`, `light`, or `dark`; invalid values are ignored.
  - A native **View → Theme** radio menu applies the preference and persists it.
  - The shell applies an explicit `data-theme` token override so light/dark selection is independent of the Playwright/Chromium `prefers-color-scheme` propagation limitation; `system` removes the override and follows system appearance.
  - Native window/shell background colors update with the theme, and menu checkmarks stay synchronized.
  - E2e selects Dark, verifies the persisted value and dark tokens before restart, confirms Dark restores after relaunch, then resets to System.
- Unsigned macOS packaging:
  - added `electron-builder` 26.18.0 with `electron-builder.yml`: app ID `com.kanharithsok.paneflow`, product name PaneFlow, version 0.1.0, developer-tools category, arm64 DMG/ZIP targets, asar, and signing disabled (`identity: null`);
  - added a locally generated minimalist PaneFlow icon (`build/icon.svg` source, `build/icon.icns` bundle asset) with transparent rounded-square geometry;
  - added an MIT license and matching package metadata;
  - added `npm run package:mac` and `npm run package:dir` scripts; `dist/` remains ignored;
  - documented that arm64-only unsigned builds are for local verification, not notarized distribution.
- Repeated-switch leak stress:
  - added a read-only `webContentsCount` test hook for non-destroyed webContents;
  - creates a stress workspace, adds four panes, loads two of them with real fixture pages, switches back to the authenticated original workspace, then performs three more round-trip workspace switches;
  - after every return to the original workspace, asserts the non-destroyed webContents count equals the baseline and native view states equal the active pane count;
  - verifies four stress-workspace native views during each stress activation, then deletes the stress workspace;
  - this covers BrowserManager teardown/recreation, profile reuse, renderer reset, and workspace-file persistence under repeated switching;
  - `PANEFLOW_STRESS_CYCLES` overrides the default 3 cycles for local soak runs;
  - an 8-cycle run reported 2 webContents and working set 575 MB → 515 MB after returning to the original workspace;
  - a 25-cycle run reported 2 webContents and working set 573 MB → 643 MB; no webContents/native-view leak was observed, but the +70 MB working-set change is recorded as cache/runtime variance rather than proof of long-term stability.
- Close-and-delete profile lifecycle:
  - Clear/Delete remain available for in-use profiles instead of being disabled.
  - The confirmation text names how many panes will be closed; the confirm button reads **Close panes & clear** or **Close panes & delete**.
  - Main validates the explicit `closePanes` flag, destroys all panes using that profile, verifies usage is empty, then clears the session and optionally removes profile metadata/partition.
  - The profile manager reports that panes were closed and refreshes usage.
  - E2e deletes the two-pane shared profile through this flow, verifies both panes close, the profile row disappears, Alice remains, and native alignment restores.
- Duplicate pane:
  - native **Pane → Duplicate Pane** (`CmdOrCtrl+D`) and pane context-menu action duplicate the active/source pane;
  - the duplicate always receives a fresh profile and copies the source URL, viewport settings, and custom title;
  - added a validated `duplicate-pane` IPC path and renderer command handler;
  - e2e duplicates Alice, verifies the new pane has a fresh profile and matching URL/viewport, then closes it.
- Custom pane names:
  - double-clicking a pane title starts inline editing; the native pane context menu also exposes **Rename Pane…**;
  - main validates the pane ID and title text (`rename-pane` IPC), trims whitespace, limits names to 80 characters, and rejects control characters;
  - `BrowserManager` keeps the live page title separate from the optional `customTitle`, so clearing the field restores the current page title immediately;
  - custom titles persist in workspace JSON, restart with the workspace, are copied by duplicate pane/workspace, and round-trip through workspace import/export while profile IDs and session data stay excluded;
  - e2e rejects unsafe/unknown-pane renames, renames Alice inline, verifies the workspace file and restart restore, then clears the name and verifies the page title returns and the stored title is removed.
- Workspace import/export:
  - added a versioned `paneflow-workspace` transfer format containing only name, pane URLs, viewport settings, custom titles, and index-based layout;
  - profile IDs, cookies, storage, session data, executable content, and filesystem paths are never exported;
  - export uses a native Save dialog and atomic JSON write; import uses a native Open dialog, a 1 MB size limit, strict schema/URL/viewport/layout validation, and fresh profiles;
  - imported workspaces receive new IDs, pane IDs, profiles, a unique `(imported)` name, and mapped grid/freeform order/geometry;
  - workspace dialog adds **Import…** and **Export active** actions with canceled/error/no-op handling;
  - 5 unit tests cover serialization, profile stripping, JSON round-trip, fresh-ID materialization, unsafe URLs/viewports, invalid pane order/freeform geometry, and mapping errors;
  - native file-dialog interaction itself is not automated in e2e; the pure transfer and materialization paths are unit-tested.
- Active-pane accessibility:
  - the active pane card receives a restrained accent border and `aria-current="true"`;
  - shell focus/pointer and native pane focus continue to drive the active pane;
  - e2e verifies exactly one active card, moves focus to another pane, and confirms the border/`aria-current` follow;
  - the existing reduced-motion media rule disables animations/transitions/smooth scrolling when requested.
- Minimum-window and dialog semantics:
  - at 760 px width the toolbar hides the grid label visually and moves the pane count to a screen-reader-only state, avoiding horizontal overflow;
  - workspace and profile dialog triggers expose `aria-haspopup="dialog"` and `aria-expanded`;
  - the workspace trigger includes the current workspace name in its accessible label;
  - e2e verifies no toolbar overflow, dialog-trigger semantics, and expanded state.
- Contrast audit:
  - added `scripts/check-contrast.mjs` to compute WCAG ratios for text/muted/faint/accent/focus/danger token pairs in explicit light and dark themes;
  - darkened light-theme `--text-faint` from `#73726c` to `#6f6e68` so its weakest background ratio rises from 4.42 to 4.69;
  - all checked pairs now meet 4.5:1 for text or 3:1 for UI/focus;
  - `npm run check:contrast` runs in CI.
- Security hardening:
  - replaced the packaged `file://` shell load with a privileged, standard, secure `paneflow://shell/index.html` custom protocol; the handler serves only the built renderer root, rejects traversal/backslash/null/ambiguous paths and malformed encodings, sets explicit MIME types, `nosniff`, no-referrer, no-store, and CSP headers;
  - moved CSP construction into pure `src/shared/shell.ts`; production is `connect-src 'self'` with no localhost/WebSocket allowance, while development adds only the exact loopback `ELECTRON_RENDERER_URL` origin and matching `ws:`/`wss:` source; inline script/eval stay blocked and inline styles remain for Vue geometry;
  - removed the static CSP meta tag so headers are authoritative in both modes;
  - IPC sender validation now checks the shell `WebContents`, shell main frame, and trusted document URL (`paneflow://shell/index.html` or the validated dev origin); unauthorized state reads return an empty default state instead of workspace metadata;
  - remote and shell sessions deny permission requests/checks, display capture, HID/serial/USB device access, Bluetooth pairing, and downloads; shell navigation still denies redirects outside the dev origin;
  - remote and shell views declare `webviewTag: false`, no subframe/worker Node integration, and no drag-drop navigation; a global `web-contents-created` handler denies popups and webview attachment;
  - URLs with embedded credentials or more than 2,048 characters are rejected before they can enter workspace state or exports;
  - partition directory removal uses the validated UUID-only `paneflow-profile-<uuid>` helper; profile clearing uses the hardened session accessor;
  - workspace import verifies the selected path is a regular file and read failures return a safe error; transfer validation rejects credential-bearing and oversized URLs and prototype-pollution-style freeform keys;
  - added Electron fuses to `electron-builder.yml`: RunAsNode and Node options/inspector arguments disabled, file-protocol extra privileges disabled, embedded ASAR integrity and only-load-from-ASAR enabled, ad-hoc Darwin signature reset;
  - added 10 unit tests for CSP, trusted shell documents, shell asset path/MIME handling, partition directory validation, credential/length URL rejection, and import hardening;
  - extended e2e to verify the `paneflow://shell/index.html` shell URL, inline-script and cross-origin-fetch CSP blocking, invalid-sender rejection from a separate node-enabled `BrowserWindow`, and blocked remote `file:`/`data:` navigation;
  - added `SECURITY.md` covering threat boundaries, secret handling, unsigned/local distribution, and the packaging checklist, and updated README, architecture, decisions, and manual checks.
- Accessibility automation and audit:
  - added `tests/e2e/accessibility.spec.ts`, a second Playwright Electron test that launches the built app independently and inspects the shell toolbar, pane cards, profile dialog, and workspace dialog;
  - role/accessible-name assertions cover the level-1 heading, banner, browser-workspace main landmark, layout group and pressed states, column selector, pane count status, dialog triggers, pane articles, address/viewport/scale controls, and icon-only actions;
  - keyboard checks verify toolbar → pane control tab order, disabled Back/Forward skipping, visible 2 px focus outlines, active-pane `aria-current` updates, dialog focus trapping with Tab/Shift+Tab, Escape closing, and focus return to the trigger;
  - Chromium's native accessibility tree is inspected through CDP `Accessibility.getFullAXTree` for the shell and both open dialogs;
  - axe-core 4.11.0 runs against the rendered document with WCAG 2.0/2.1/2.2 A/AA and best-practice tags; it is evaluated through CDP `Runtime.evaluate` because the shell CSP correctly blocks inline script injection (`page.addScriptTag` fails under `script-src 'self'`);
  - the audit is clean for the shell with two loaded panes and for both dialogs after creating a second workspace;
  - fixed confirmed defects: the shell had no level-1 heading; dialog `<header>` elements created duplicate banner landmarks; repeated profile/workspace row actions had context-free names (`Clear`, `Delete`, `Switch`, etc.); pane articles were named `Pane one pane`; the keyboard-focused dialog container had no visible focus ring;
  - profile/workspace row actions now include the profile or workspace label in their accessible names while retaining the visible labels;
  - VoiceOver/screen-reader order and announcements remain a manual check; axe and the CDP tree cannot verify the spoken experience.
- 50-cycle loaded-page soak:
  - `PANEFLOW_STRESS_CYCLES=50 npx playwright test tests/e2e/browser-panes.spec.ts` exercised 50 round trips between the authenticated original workspace and a four-pane stress workspace with two loaded fixture pages;
  - non-destroyed webContents returned to the baseline of 2 after every cycle, and the active native view count returned to 1 after every return;
  - whole-app working set was 589 MB before and 684 MB after the 50 cycles on `main` after the final merge; earlier runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB. This is a before/after sample, not a peak or per-process measurement;
  - the final `main` run took ≈20.1 s. It is still a short switch soak, not multi-hour profiling, heavy third-party pages, or CPU/frame measurement.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npm run test:unit` | Passed: 11 files, 123 tests. Includes workspace cycling, custom-title validation, window presentation parsing/persistence, CSP/trusted-shell-url/asset-path tests, partition-directory validation, credential/oversized URL rejection, and import validation. |
| `npm run typecheck` | Passed (`tsc` for main/preload/shared/tests and `vue-tsc` for the renderer). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run check:contrast` | Passed: 13 light and 13 dark token pairs meet WCAG thresholds. |
| `npm run test:e2e` | Passed: 2 Playwright tests, 14.0 s on final `main`. Integration coverage includes native/session/lifecycle/workspace/rename/shortcut behavior, `paneflow://shell/index.html`, shell CSP inline-script and cross-origin-fetch blocking, invalid-sender IPC rejection, and blocked remote `file:`/`data:` navigation; the accessibility test covers roles, names, focus, dialogs, the CDP tree, and axe audits. |
| `PANEFLOW_STRESS_CYCLES=8 npm run test:e2e` | Passed earlier in Phase 4: 1 Playwright test, 11.3 s. Eight switch cycles ended with 2 webContents and working set 575 MB → 515 MB. |
| `PANEFLOW_STRESS_CYCLES=25 npm run test:e2e` | Passed earlier in Phase 4: 1 Playwright test, 14.5 s. Twenty-five cycles ended with 2 webContents and working set 573 MB → 643 MB. |
| `PANEFLOW_STRESS_CYCLES=50 npx playwright test tests/e2e/browser-panes.spec.ts` | Passed: 1 Playwright test, 20.1 s on `main` after the final merge. Fifty cycles ended with 2 webContents and working set 589 MB → 684 MB. Earlier 50-cycle runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (114.38 kB), preload (5.75 kB), renderer bundle (271.17 kB), and CSS (22.81 kB). |
| `npm run package:dir` | Passed on final `main`. electron-builder packaged PaneFlow 0.1.0 arm64, applied `@electron/fuses`, and skipped macOS signing because `identity: null`. |
| `npx electron-fuses read --app dist/mac-arm64/PaneFlow.app` | Passed. RunAsNode disabled; Node options and inspector arguments disabled; embedded ASAR integrity and only-load-from-ASAR enabled; file-protocol extra privileges disabled. |
| `npm run package:mac` | Passed earlier in Phase 4: produced `PaneFlow-0.1.0-arm64.dmg` (118 MB), `PaneFlow-0.1.0-arm64.zip` (115 MB), and `PaneFlow.app` (273 MB) under `dist/`. DMG/ZIP were not rebuilt after the security merge; `package:dir` exercised the merged fuse configuration. |
| Packaged bundle inspection | Passed earlier: binary arm64; `CFBundleIdentifier=com.kanharithsok.paneflow`, version `0.1.0`, icon `icon.icns`, category `public.app-category.developer-tools`; unsigned/ad-hoc. |
| Packaged launch | Passed earlier. The unsigned app launched, rendered the shell and panes, and quit cleanly. |
| Packaged shell smoke (final merged branch) | Passed. Fresh `dist/mac-arm64/PaneFlow.app` launched with an isolated `HOME` and `--remote-debugging-port=9333`; `/json/list` reported `title: "PaneFlow"` and `url: "paneflow://shell/index.html"`. The process was terminated after inspection, so clean quit was not re-verified in this smoke check. |

### Security hardening verification (security branch, pre-merge)

The security slice was verified before merging the rename and accessibility branches; the final merged table above is authoritative.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run test:unit` | Passed: 11 files, 114 tests. |
| `npm run test:e2e` | Passed: 1 Playwright test, 11.4 s, with the new security assertions. |
| `npm run build` | Passed: main 107.79 kB, preload 5.27 kB, renderer JS 266.69 kB, CSS 22.03 kB. |
| `npm run package:dir` | Passed; fuses applied before signing was skipped (`identity: null`). |
| `npx electron-fuses read --app dist/mac-arm64/PaneFlow.app` | Passed. `RunAsNode` disabled; `EnableNodeOptionsEnvironmentVariable` disabled; `EnableNodeCliArguments` disabled; `EnableEmbeddedAsarIntegrityValidation` enabled; `OnlyLoadAppFromAsar` enabled; `GrantFileProtocolExtraPrivileges` disabled. The bundled `@electron/fuses` 1.8.0 CLI labels Electron 45's unconfigured `WasmTrapHandlers` fuse as `undefined`; all configured security fuses read correctly. |
| Packaged shell smoke | Passed. Fresh `dist/mac-arm64/PaneFlow.app` launched with an isolated `HOME` and `--remote-debugging-port=9333`; `/json/list` reported `title: "PaneFlow"`, `url: "paneflow://shell/index.html"`. The process was terminated after inspection, so clean quit was not re-verified in this smoke check. |
| Packaged app log | No startup or protocol errors were emitted; only Chromium's DevTools listening line appeared. |
| Development shell smoke | Passed. `npx electron-vite dev --remoteDebuggingPort 9335` served the shell at `http://localhost:5173/`; CDP evaluation reported `title: "PaneFlow"`, `.toolbar` present, one `#app` child, and no static CSP meta tag. The development process was terminated after inspection. |
| `npm audit --omit=dev` | Passed: 0 runtime vulnerabilities. Full `npm audit` reports 6 moderate advisories in the development toolchain (`minimatch` via `electron-builder`); the offered fix requires a breaking downgrade and was not applied. |

### Exit criteria

- [x] The SPEC §20 Definition of Done is met for the unsigned local macOS MVP.
- [x] Typecheck, lint, contrast, unit, e2e, build, and local packaging checks pass.
- [x] Known limitations and post-MVP items are documented.
- [x] The macOS arm64 application packages locally as an unsigned/ad-hoc app.
- [x] Signed/notarized distribution is explicitly outside the MVP per SPEC §21 and remains credential-gated; unsigned local builds are the supported distribution until an Apple Developer account exists.

### Known issues / risks

- Window bounds and maximized/full-screen state restore only when the saved normal bounds remain visible on a current display; pane maximize is temporary.
- Window restoration checks visibility against current displays but does not clamp oversized windows to the work area.
- Workspace switching tears down and recreates native pane views; pages reload rather than staying warm in the background.
- Duplicated workspaces immediately create fresh profiles even before the duplicate is opened; unused profiles remain in the profile manager.
- Deleting a workspace does not delete profiles that were referenced only by that workspace.
- Profile sharing is initiated from the profile manager; the toolbar Add pane action always creates a fresh profile.
- Shared profiles are intentional but still share one Chromium partition; there is no clone-profile-with-session feature.
- Workspace-specific window bounds remain.
- Native file-dialog flows for import/export are not covered by Playwright; only the transfer/materialization logic is unit-tested.
- Imported workspaces are created inactive and contain fresh profiles; authentication state is intentionally not imported.
- Packaging is arm64-only and unsigned/ad-hoc; Developer ID signing, notarization, stapling, auto-update, and release automation are not implemented.
- Unsigned builds require local Gatekeeper handling on other machines and must not be presented as notarized releases.
- Electron cookie encryption at rest is not enabled for the unsigned build; local profile data relies on OS account permissions. This needs verification before enabling in a signed release.
- The shell CSP deliberately keeps `style-src 'unsafe-inline'` for Vue's inline pane geometry, while inline script and eval are blocked.
- Development CSP adds the exact loopback Vite origin and WebSocket; production has no such allowance. The automated e2e suite runs the production shell path. A dev shell smoke check rendered Vue under the development CSP, but HMR live-reload behavior is not automated.
- Workspace exports include pane URLs verbatim, including query strings. Credential-bearing URL userinfo is rejected, but users must still avoid secret query parameters.
- Fuses and ASAR integrity were verified through `npm run package:dir` and a packaged launch; the DMG/ZIP were not rebuilt in the security slice.
- The packaged launch smoke check fetched the shell URL over Chromium remote debugging, then terminated the process rather than exercising a full interactive packaged session.
- Automated accessibility checks cover roles, names, focus order/traps, landmarks, and axe rules; VoiceOver spoken order, live-region timing, and the practical usability of focus rings still require a manual screen-reader pass.
- axe-core audits the trusted shell only; remote fixture/website content inside native panes is untrusted and not included in the shell accessibility audit.
- Leak stress covers four panes with two loaded fixture pages; the longest soak is 50 cycles (≈20 s), not multi-hour profiling, and does not include heavy third-party pages or CPU/frame metrics.
- Working-set sampling is informational, not a pass/fail memory threshold; the final `main` 50-cycle run grew from 589 MB to 684 MB, so it does not establish long-term memory stability.
- Duplicate pane copies URL/viewport/custom title; sharing requires the profile-manager Open pane flow, and duplication is available through menus/IPC rather than a header button.
- Shortcut e2e coverage invokes the real native menu items and verifies accelerator metadata; it does not synthesize OS-level key chords.
- Workspace cycling order is alphabetical by name; there is no user-defined workspace order.

### Post-MVP follow-ups

The MVP is complete. These items are post-MVP hardening and validation, not Phase 4 blockers:

- Manual VoiceOver/screen-reader pass across the toolbar, pane chrome, status announcements, and both dialogs.
- Multi-hour CPU/memory profiling with loaded third-party pages, plus CPU/frame measurement during drag, resize, and scrolling.
- Developer ID signing, notarization, and stapling when a paid Apple Developer account exists; the supported distribution remains the unsigned local arm64 build until then.
- Windows/Linux packaging and release automation, which SPEC §19 explicitly defers.

## Post-MVP — Always-fit pane scaling

**Date:** 2026-11-19

**Status:** Complete.

**Change:** Removed the per-pane Fit/Actual display-scale selector. Fixed viewport presets and custom dimensions now always scale the emulated page to fit the current pane content. Responsive panes continue to use the pane content size directly. The fit scale is recomputed from the current native view bounds whenever the pane frame, window, grid, freeform layout, or maximize state changes. Legacy workspace and transfer records containing `displayScale` are accepted but ignored, so existing `actual` selections migrate to always-fit. This supersedes the Phase 3/4 fit/actual notes above.

**Files changed:** `src/shared/viewports.ts`, `src/main/browser-manager.ts`, `src/renderer/src/components/PaneCard.vue`, viewport/workspace unit tests, browser-pane and accessibility e2e tests, `SPEC.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-028), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc` and `vue-tsc`). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 11 files, 126 tests in 333 ms. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.7 s. Includes a five-column frame narrowing that changes the fit scale and a return to two columns that restores it. |
| `npm run build` | Passed: main 115.54 kB, preload 5.75 kB, renderer JS 269.94 kB, CSS 23.05 kB. |
| `npm run check:contrast` | Passed: 13 light and 13 dark token pairs meet WCAG thresholds. |

**Automated coverage:** The viewport unit suite covers legacy `displayScale` parsing, always-fit scale math, and recomputation for different available sizes. Workspace validation verifies a persisted legacy `displayScale: 'actual'` viewport migrates to the current preset without retaining the obsolete field. The browser-pane e2e verifies mobile and custom viewport metrics, fit scale below 1, removing the scale selector, refit after frame narrowing, and restoration after returning to the prior width. The accessibility e2e verifies the pane-header focus order after removing the selector.

**Known behavior / limitations:** Fixed viewports letterbox when the emulated aspect ratio differs from the pane; there is no fill/crop mode. The obsolete `displayScale` field is no longer written.

**Manual GUI verification still outstanding:** Visual review of letterboxing at unusual pane aspect ratios. The automated checks cover scale changes and native bounds alignment, but not a human visual pass.

## Post-MVP — Add-pane device size picker

**Date:** 2026-11-19

**Status:** Complete.

**Change:** The toolbar Add pane control is now a split button. The primary button still creates a responsive pane; the chevron opens a native device-size menu with Responsive plus the mobile, tablet, laptop, and desktop presets. Selecting a preset sends it through a new validated `add-pane-with-viewport` IPC path, which creates a fresh browser profile and a pane with that viewport. The empty-state Add pane control uses the same split control. Device labels remain viewport classes with dimensions rather than device-brand claims.

**Files changed:** `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/browser-manager.ts`, `src/renderer/src/App.vue`, browser-pane and accessibility e2e tests, `SPEC.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-029), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc` and `vue-tsc`). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 11 files, 126 tests in 407 ms. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.9 s. The device test rejects an unknown preset, creates a mobile 390 × 844 DPR 3 pane, verifies its viewport, preset control, and fit emulation, and closes it cleanly. |
| `npm run build` | Passed: main 118.06 kB, preload 6.06 kB, renderer JS 272.39 kB, CSS 23.44 kB. |
| `npm run check:contrast` | Passed: 13 light and 13 dark token pairs meet WCAG thresholds. |

**Automated coverage:** The accessibility test verifies the device-size button's accessible name, menu semantics, and presence. The browser-pane e2e verifies main-process viewport validation, pane creation with the selected preset, fit emulation, fresh state, and cleanup.

**Manual GUI verification still outstanding:** Selecting an item directly from the native popup menu is not automated by Playwright; the toolbar control, menu construction, and post-selection creation path are covered, but the native menu interaction needs a manual GUI check.

## Post-MVP — Minimal pane chrome, appearance menu, and live pane color scheme

**Date:** 2026-11-19

**Status:** Implemented; final pane-chrome choice pending.

**Change:** Replaced the two-row bordered pane header with a frameless, single-row pane bar that wraps only at narrow widths. The bar keeps title, profile, address, viewport, navigation, and actions; inactive panes de-emphasize profile and actions. Added an appearance button that opens a native System/Light/Dark menu, with the native View menu kept in sync. The shell now uses a main-provided resolved theme, and loaded website panes receive the effective scheme as a live `prefers-color-scheme` change through CDP media emulation, without reloading. Added a temporary app-wide pane-chrome preview under the Add pane chevron menu: Quiet bar (default), Canvas label, and Global bar. Slimmed the toolbar by hiding the pane count visually, making Profiles icon-only, removing the Columns text label, and reducing the toolbar/header heights. Reduced global workspace padding/gap and dialog copy/width.

**Files changed:** `src/shared/pane-chrome.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/browser-manager.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/PaneNavigation.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, unit/e2e tests, `SPEC.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-030/031), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 12 unit files / 128 tests, and all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.4 s. Accessibility/axe suite passed; main integration passed through restart, viewport, theme, workspace, profile, and leak checks. |
| `npm run build` | Passed: main 122.13 kB, preload 6.20 kB, renderer JS 281.53 kB, CSS 26.77 kB. |
| Pane scheme probe | `nativeTheme.themeSource` Dark/Light changed `matchMedia('(prefers-color-scheme: dark)')` inside an already-loaded pane without a reload. |
| Visual variants | Rendered Quiet bar, Canvas label, and Global bar against the same two-pane workspace; verified 32 px default headers, active/inactive behavior, narrow header wrapping, and the C global bar. |

**Automated coverage:** E2e verifies the appearance button's accessible name/menu semantics, deterministic shell `data-theme`, persistence, live pane color-scheme changes, restart restoration, single-row header wrapping at five columns, focus order, axe WCAG/best-practice checks, maximize/restore, native bounds alignment, and all existing workspace/profile/session behavior. Unit tests cover the pane-chrome preview type and labels.

**Manual GUI verification still outstanding:** Selecting System/Light/Dark directly from the toolbar appearance menu, and selecting a pane-chrome preview item from the native Add pane menu, are not automatable through Playwright. The controls, validated IPC paths, persistence, and rendered states are covered; the native menu clicks need a manual pass. Final choice of pane chrome is pending.

**Known behavior / limitations:** The pane-chrome preview is intentionally temporary and app-wide; C cannot be mixed per pane. The preview is stored in shell localStorage, not workspace files. CDP media emulation keeps a debugger attached to panes, so opening pane DevTools can detach the emulation until the next navigation or theme change. Websites that force their own color scheme may not visibly change.

## Post-MVP — Infinite Canvas first slice

**Date:** 2026-11-19

**Status:** Historical initial Canvas slice. Grid/Freeform were later removed and the native add/context menus were replaced; see the Canvas-only report below.

**Change:** Added Canvas as a third workspace layout. It uses a dotted infinite backdrop, world-coordinate pane positions persisted in workspace layout, a global active-pane address/navigation bar, compact per-pane labels, background-drag panning, a Hand tool, and Space as a temporary Hand tool. Dragging a pane header moves only that pane; page content remains interactive in its native view. Hand-mode wheel input zooms between 50% and 200% around the cursor, with a percentage reset control. Responsive panes keep a stable CSS viewport while main applies the matching device-emulation scale. Native pane views are hidden during movement and shown as recent JPEG snapshots; after the gesture, fully visible panes restore live native views and partially visible panes remain snapshots. Wheel panning now hides and re-measures native views so their content cannot drift after a pane move.

The Canvas overview is a persistent native `WebContentsView` in the bottom-right rather than a modal DOM dialog. It is visible as soon as Canvas is active, projects every pane and the current viewport (including the viewport outline), adapts between 168 and 208 px wide, and collapses to a compact header. Selecting a frame centers and focuses that pane; selecting empty map space recenters there; Fit all is available in the overview header and the Canvas global bar. Main validates the shell and minimap IPC senders separately, relays projection state to the minimap, relays focus/recenter/fit actions back to the shell, and returns keyboard focus to the shell. Covered native views are not hidden, so pages remain live outside the panel. Device bezels and frame resizing remain deferred.

**Files changed:** `src/shared/canvas.ts`, `src/shared/minimap.ts`, `src/shared/workspace.ts`, `src/shared/workspace-transfer.ts`, `src/shared/ipc.ts`, `src/shared/shell.ts`, `src/main/browser-manager.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/test-hook.ts`, `src/main/workspace-store.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/minimap.html`, `src/renderer/src/minimap.ts`, `src/renderer/src/minimap.css`, `src/renderer/src/assets/app.css`, `electron.vite.config.ts`, canvas/minimap/workspace unit tests, browser-pane e2e, `SPEC.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-032/033/034), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 14 unit files / 142 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 17.3 s. Persistent minimap visibility, bottom-right positioning, frame focus/centering, viewport outline, empty-map recentering, Fit all, collapse/expand, shell focus return, Canvas pane-header drag, page content interaction, Space hand mode, wheel zoom with stable 560 × 700 page metrics, zoom reset, wheel-pan native realignment, background pan, Hand-tool state, minimap hiding in Grid, accessibility/axe, and the full existing integration path passed. |
| `npm run build` | Passed: main 136.60 kB, preload 7.70 kB, renderer JS 308.18 kB, shell CSS 26.02 kB, minimap CSS 3.10 kB, shared tokens 2.98 kB. |
| Canvas visual check | Rendered the native overview at 1280 × 860 (205 × 131) and 760 × 540 (168 × 108), collapsed to 205 × 28 and 168 × 28. Verified the dashed viewport outline, frame focus, toolbar icons, and dark appearance; shared light/dark tokens are covered by the contrast check. |

**Automated coverage:** Unit tests cover frame sizing, default arrangement, canvas position validation, workspace normalization, position persistence, minimap projection (including a far-away viewport), adaptive minimap sizing, state validation, every minimap action, and trusted minimap document URLs in production and development. E2e verifies the dotted workspace, global bar, dragging a pane header without moving the canvas or other pane, page-content interaction, Space hand mode, wheel zoom with stable page metrics, zoom reset, wheel-pan native realignment, persistent minimap visibility without a reveal action, bottom-right positioning, frame focus/centering, viewport outline, empty-map recentering, Fit all restoring both panes inside the workspace, collapse/expand resizing, shell focus return, native-view hiding during a pan, restoration of visible native bounds, Hand-tool state, minimap hiding in Grid, and return to Grid.

**Manual GUI verification still outstanding:** Panning with the Hand tool directly over a frame, clicking a partially visible frame to center it, visual snapshot quality with real third-party pages, and very high zoom where frames cannot fit. Device bezels and frame resizing are not implemented.

**Known behavior / limitations:** Pages are static snapshots while panning; snapshots may be stale until the next canvas entry, gesture completion, or refresh. Partially visible panes are visual-only until centered. At zoom levels where a frame cannot fit fully inside the workspace, its native view stays hidden and the snapshot remains. The persistent overview occupies a small bottom-right area and intercepts input there; pane content remains live elsewhere. Fit all in the Canvas global bar or overview header is the one-click recovery action. Space works only when shell chrome has focus; focused websites retain normal keyboard behavior. Pan and zoom are not persisted, and minimap collapse state resets with the window.

## Post-MVP — Canvas-only workspace, snapping, device presets, and custom menus

**Date:** 2026-11-19

**Status:** Implemented. Canvas is the only selectable layout. Grid/Freeform controls and the native layout toggle were removed. Device presets, world-space snapping guides, a quiet **+** menu, and a right-click Canvas menu are complete. Frame resizing and device bezels remain deferred.

**Change:** Removed the Grid/Freeform/Canvas switcher, grid-column selector, Tidy action, and native grid/freeform toggle. Startup, workspace restore, saves, and exports normalize to Canvas; legacy Grid/Freeform layout fields remain readable for migration. Canvas pane headers now drag with live edge/center snapping guides calculated in world space, using an 8-screen-pixel threshold divided by zoom. The quiet toolbar **+** opens a Herdr-inspired in-shell menu with Responsive plus curated iPhone, Samsung Galaxy, Google Pixel, iPad, Galaxy Tab, MacBook Air, and desktop presets; a Dimensions column replaces the old native menu. Right-clicking empty Canvas opens a matching menu with Add pane, Fit all panes, Reset zoom, Hand tool, Profiles, Workspaces, and Appearance. The menus use sections, monochrome icons, checked/radio states, keyboard navigation, Escape dismissal, click-outside dismissal, and focus return. Because native pane views sit above the shell, only pane views intersecting the open menu are hidden and replaced by snapshots; uncovered panes stay live. The native overview hides while a menu or dialog is open. Appearance items call a new validated `paneflow:set-theme` path. New panes are centered and focused after creation.

**Files changed:** `src/shared/canvas.ts`, `src/shared/viewports.ts`, `src/shared/ipc.ts`, `src/shared/workspace.ts`, `src/shared/workspace-transfer.ts`, `src/main/browser-manager.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/menu.ts`, `src/renderer/src/components/AppMenu.vue`, `src/renderer/src/components/MenuIcon.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/PaneNavigation.vue`, unit/e2e tests, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-035/036/037), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 14 unit files / 145 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 14.8 s. Canvas-only startup, snapping guides and snapped edges, 10-item **+** device menu, iPhone 15 Pro creation, persistent minimap, right-click Add pane/Hand/Appearance actions, theme IPC, menu keyboard focus/Escape, native-view hiding under menus and restoration after close, viewport presets/custom/Pixel, restart Canvas position, profile/workspace workflows, eight-pane Canvas stress, accessibility/axe, and the existing security/session checks passed. |
| `npm run build` | Passed: main 135.77 kB, preload 7.67 kB, renderer JS 321.50 kB, shell CSS 27.09 kB, minimap CSS 3.10 kB, shared tokens 2.98 kB. |
| Menu visual check | Rendered the quiet square **+** and both custom menus at desktop width in dark and light appearance. Verified sections, monochrome icons, right-aligned dimensions, checked/radio states, rounded panel/shadow, and snapshot display under the menu. Shared light/dark tokens are also covered by the contrast check. |
| Layout visual check | Rendered two live panes plus a third Pixel pane at 77% after Fit all; verified the toolbar no longer exposes Grid/Freeform or grid columns. |

**Automated coverage:** Unit tests cover Canvas frame sizing/default placement, world-space edge/center snapping and guide output, invalid snap inputs, adaptive minimap sizing, device preset catalog and validation, legacy Canvas normalization, and workspace/position persistence. E2e verifies Canvas-only startup and missing Grid/Freeform/grid controls; pane-header drag with hidden native views; guide appearance and cleanup; **+** menu sections and 10 items; selecting iPhone 15 Pro; Escape close; right-click menu Add pane switch; Hand tool toggle; Light/System theme changes; minimap hide/restore; native-view hiding under the menu; selected viewport dimensions; responsive emulation at 100% and reset; custom validation; Canvas position persistence; and the eight-pane add/close stress path. Accessibility e2e verifies menu semantics, ArrowDown focus, Escape dismissal, and focus return.

**Manual GUI verification still outstanding:** Right-clicking a live website (remote content) remains the website's own context menu; only shell/Canvas background and pane chrome are app-controlled. Pane-header right-click still uses the native pane menu. Visual review on very high pane counts, minimum window size, light appearance, and menus over third-party page snapshots remains manual. Device bezels and pane frame resizing are not implemented.

**Known behavior / limitations:** Custom menus hide only intersecting native pane views and show snapshots there; uncovered panes stay live. The minimap hides while menus are open. The **+** menu shows a curated device subset while the per-pane viewport selector retains the full preset catalog. Legacy Grid/Freeform fields and pure helpers remain for migration/compatibility even though the modes are no longer user-reachable. Pane positions are persisted; pan/zoom and menu/minimap collapse state are not. Very large fixed viewport panes can extend beyond the workspace until Fit all is used.

## Post-MVP — Bottom zoom bar, fit-on-open, empty-canvas deselection, and borderless toolbar

**Date:** 2026-11-19

**Status:** Implemented.

**Change:** Moved Canvas zoom controls out of the top-right toolbar into a persistent bottom-center native zoom bar. The bar is a trusted 204 × 40 DIP `WebContentsView` with 12 px bottom margin, zoom-out and zoom-in buttons at a 10% step, and a percentage button between them. The percentage button opens the standard in-shell Herdr-style menu above the bar with 25%, 50%, 75%, 100%, 125%, 150%, 200%, Fit all, and Reset (100%). The Canvas zoom range expanded from 50–200% to 25–200%. Main validates the zoom bar sender separately, forwards state to the bar, and relays validated actions to the shell; the bar and minimap hide for dialogs and non-zoom menus but stay visible while the zoom menu is open. Each workspace now fits all panes on first appearance and after a workspace switch, using a short ready/retry loop until the workspace has non-zero size. A primary click on empty canvas with less than 4 px of movement clears the active pane; the bar stays mounted with an empty state, and selecting a pane, its header, or a minimap frame restores selection. The cleared state is transient. The top-right hand, Profiles, appearance, reload, and **+** buttons are now borderless, and the old percentage/reset toolbar button was removed.

**Files changed:** `src/shared/zoom.ts`, `src/shared/ipc.ts`, `src/shared/shell.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/main/browser-manager.ts`, `src/main/test-hook.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/AppMenu.vue`, `src/renderer/zoom.html`, `src/renderer/src/zoom.ts`, `src/renderer/src/zoom.css`, `electron.vite.config.ts`, `tests/unit/zoom.test.ts`, `tests/unit/shell-security.test.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/e2e/accessibility.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-038), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 15 unit files / 150 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.1 s. The accessibility test audited the zoom bar and exercised its keyboard menu; the integration test covered startup fit, bar bounds, zoom-out step, 7 preset radio items, 50% selection, Reset, empty-canvas deselection/reselection, and 0 px borders on all five top-right toolbar buttons. |
| `npm run build` | Passed: main 141.55 kB, preload 8.50 kB, renderer JS 324.97 kB, shell CSS 26.64 kB, minimap CSS 3.10 kB, zoom CSS 1.44 kB, shared tokens 2.98 kB. |
| Zoom visual check | Rendered the closed bar and the percentage menu at 1280 × 860 in dark and light appearance. Verified the 204 × 40 bar at bottom center, the upward menu with radio check state and Fit all/Reset icons, and borderless top-right toolbar buttons. |
| Three-pane restart fit | Passed: added a third pane, restarted with the persisted workspace, and confirmed startup fit set 68% with all three cards inside the 1280 × 784 workspace. |

**Automated coverage:** Unit tests cover zoom clamping, presets, state/action validation, and trusted zoom document URLs in production and development. E2e verifies the native bar's bottom-center position and size, the zoom-out step, the percentage menu's 7 radio items, exact 50% selection, Reset to 100%, startup fit, empty-canvas deselection and reselection, and borderless toolbar controls. Accessibility e2e verifies named zoom controls, menu keyboard focus, Escape dismissal, and an axe audit of the bar.

**Manual GUI verification still outstanding:** VoiceOver order/announcements for the separate zoom-bar webContents, focus return to the percentage trigger after menu dismissal, and visual review at minimum window widths remain manual. Fit after a workspace switch uses the same ready/retry path as startup but was not separately automated.

**Known behavior / limitations:** The bar overlays a small bottom-center rectangle of pane content and intercepts input there. Opening the percentage menu keeps the bar and minimap visible; the menu is shell DOM and sits above the bar without overlapping it. The menu does not restore focus to the bar's trigger because the trigger lives in a different webContents; focus stays in the shell. Zoom, pan, and cleared selection are transient and are not persisted. The 25% minimum keeps the controls usable but may still require the overview for very large layouts. Device bezels and pane frame resizing remain deferred.

## Post-MVP — Stable active-pane bar and zoom-menu overlay retention

**Date:** 2026-11-19

**Status:** Implemented.

**Change:** Kept the Canvas active-pane bar mounted at a fixed 34 px height instead of removing it when selection clears. With no active pane it shows a quiet empty state ("No pane selected" / "Click a pane to edit its address"); an empty workspace shows "No panes" / "Add a pane to get started". The Canvas Fit all control stays at the right, disabled when there are no panes. Selecting or clearing a pane therefore no longer moves or resizes the workspace. The bottom zoom menu now keeps the zoom bar and minimap visible because it sits above the bar and does not overlap the minimap; using a zoom-bar or minimap action closes the menu first. Other custom menus and dialogs still hide both overlays. The top bar was retained instead of moving the address controls into a left or right inspector because a persistent side panel would permanently narrow the canvas and add more chrome; a sidebar remains a possible future redesign.

**Files changed:** `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/App.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-038 update and ADR-039), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 15 unit files / 150 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.1 s. The integration test verified identical workspace rectangles before deselection, after deselection, and after reselection; the empty "No pane selected" bar; the address input returning on selection; and the zoom bar and minimap remaining visible while the zoom menu is open. |
| `npm run build` | Passed: main 141.55 kB, preload 8.50 kB, renderer JS 326.34 kB, shell CSS 27.06 kB, minimap CSS 3.10 kB, zoom CSS 1.44 kB, shared tokens 2.98 kB. |
| Bar visual check | Rendered the empty bar at 1280 × 860 and the active bar at 720 × 560. The row stayed 34 px, the hint remained readable, and Fit all stayed at the right. |
| Overlay state check | While the zoom menu was open, the native zoom bar remained at 204 × 40 at the bottom center and the minimap remained visible at 205 × 131. Clicking zoom-out closed the menu and changed the zoom to 90%; clicking the percentage button toggled the menu closed. |

**Automated coverage:** E2e captures the workspace rectangle at three selection states and requires them to be identical. It verifies the empty bar text and the populated address input, and it asserts both native overlay states while the zoom menu is open. The existing zoom, startup-fit, deselection, accessibility, and session/workspace suites continue to pass.

**Manual GUI verification still outstanding:** VoiceOver announcement of the empty-state status, focus return to the percentage trigger after menu dismissal, and a visual pass at minimum window width remain manual. A left/right inspector layout was not implemented.

**Known behavior / limitations:** The bar consumes a 34 px row even when nothing is selected; this is the cost of a stable canvas. The zoom menu keeps the overlays visible, but clicking the bar's non-button background does not dismiss the menu; clicking a zoom control or the minimap does. A persistent left/right inspector remains a future option if the top bar becomes too dense.

## Post-MVP — Pane actions stay visible at every Canvas zoom

**Date:** 2026-11-19

**Status:** Implemented.

**Change:** Removed the `@container (max-width: 340px)` rule that hid the entire pane action cluster. Pane frames scale with Canvas zoom, so a 430 × 932 pane at 80% remained 344 px and kept its controls while a 393 × 852 pane fell to about 314 px and silently lost maximize, pane actions, and close. The header now always keeps the action cluster; the title truncates and the profile remains the first metadata to hide at narrow widths. This matches the existing SPEC requirement that controls never become unusable. A visual pass at 80% confirmed both headers show all three controls with no overflow.

**Files changed:** `src/renderer/src/components/PaneCard.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-040), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 15 unit files / 150 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.5 s. The integration test sets a 430 × 932 pane and a 393 × 852 pane, fits them, resets to 100%, zooms out to 80%, confirms the card widths straddle the old 340 px breakpoint (344 px vs ~314 px), and asserts maximize, pane actions, and close are visible on both. |
| `npm run build` | Passed: main 141.55 kB, preload 8.50 kB, renderer JS 326.34 kB, shell CSS 26.97 kB, minimap CSS 3.10 kB, zoom CSS 1.44 kB, shared tokens 2.98 kB. |
| Pane-header visual check | Rendered two iPhone frames at 80%: both headers kept the maximize, ellipsis, and close controls; `scrollWidth === clientWidth` on both headers. |

**Automated coverage:** The new e2e step covers the regression directly by straddling the former breakpoint rather than checking only one pane width. Existing pane chrome, viewport, zoom, workspace, and accessibility coverage continues to pass.

**Manual GUI verification still outstanding:** Very small zoom levels where titles truncate heavily remain a visual review item. The actions are present, but the header is intentionally compact.

**Known behavior / limitations:** At extreme zoom-out, the title may truncate to a few characters and the header can become crowded, but core actions stay reachable. The viewport badge may be hidden on the active pane because the global bar owns that information; inactive panes keep it while the header fits. Collapsing the dedicated controls into the ellipsis menu remains deferred.
