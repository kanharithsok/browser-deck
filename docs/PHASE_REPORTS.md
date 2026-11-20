# Phase Reports

The agent updates this file at the end of each phase. Record actual outcomes, not intended outcomes.

## Phase 0 — Repository bootstrap and native-view spike

- **Status:** Complete; merged in PR #1. CI passed for that PR.
- **Environment:** macOS 27.2.1 (Mac16,12, Apple M4, Retina `devicePixelRatio` 2), Node.js 24.22.3, npm 11.19.1, Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, Vue 3.5.45, TypeScript 6.0.3.

### Delivered

- npm project with a `package-lock.json`, `.nvmrc` for Node 24, strict TypeScript configs, ESLint, Vitest, and Playwright.
- `BaseWindow` application with a trusted Vue shell `WebContentsView`.
- Two independently navigable `WebContentsView` panes using separate persistent `persist:browserdeck-profile-<uuid>` partitions.
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

- Two live fixture panes displayed independent cookies (`browserdeck_user=alice` and `browserdeck_user=bob`) with profile labels “Profile 1” and “Profile 2”.
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
- No production authentication code was added: BrowserDeck does not own credentials or authorization; it preserves each website's cookies and storage inside the selected profile partition.

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
  - added `electron-builder` 26.18.0 with `electron-builder.yml`: app ID `com.kanharithsok.browser-deck`, product name BrowserDeck, version 0.1.0, developer-tools category, arm64 DMG/ZIP targets, asar, and signing disabled (`identity: null`);
  - added a locally generated minimalist BrowserDeck icon (`build/icon.svg` source, `build/icon.icns` bundle asset) with transparent rounded-square geometry;
  - added an MIT license and matching package metadata;
  - added `npm run package:mac` and `npm run package:dir` scripts; `dist/` remains ignored;
  - documented that arm64-only unsigned builds are for local verification, not notarized distribution.
- Repeated-switch leak stress:
  - added a read-only `webContentsCount` test hook for non-destroyed webContents;
  - creates a stress workspace, adds four panes, loads two of them with real fixture pages, switches back to the authenticated original workspace, then performs three more round-trip workspace switches;
  - after every return to the original workspace, asserts the non-destroyed webContents count equals the baseline and native view states equal the active pane count;
  - verifies four stress-workspace native views during each stress activation, then deletes the stress workspace;
  - this covers BrowserManager teardown/recreation, profile reuse, renderer reset, and workspace-file persistence under repeated switching;
  - `BROWSERDECK_STRESS_CYCLES` overrides the default 3 cycles for local soak runs;
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
  - added a versioned `browserdeck-workspace` transfer format containing only name, pane URLs, viewport settings, custom titles, and index-based layout;
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
  - replaced the packaged `file://` shell load with a privileged, standard, secure `browserdeck://shell/index.html` custom protocol; the handler serves only the built renderer root, rejects traversal/backslash/null/ambiguous paths and malformed encodings, sets explicit MIME types, `nosniff`, no-referrer, no-store, and CSP headers;
  - moved CSP construction into pure `src/shared/shell.ts`; production is `connect-src 'self'` with no localhost/WebSocket allowance, while development adds only the exact loopback `ELECTRON_RENDERER_URL` origin and matching `ws:`/`wss:` source; inline script/eval stay blocked and inline styles remain for Vue geometry;
  - removed the static CSP meta tag so headers are authoritative in both modes;
  - IPC sender validation now checks the shell `WebContents`, shell main frame, and trusted document URL (`browserdeck://shell/index.html` or the validated dev origin); unauthorized state reads return an empty default state instead of workspace metadata;
  - remote and shell sessions deny permission requests/checks, display capture, HID/serial/USB device access, Bluetooth pairing, and downloads; shell navigation still denies redirects outside the dev origin;
  - remote and shell views declare `webviewTag: false`, no subframe/worker Node integration, and no drag-drop navigation; a global `web-contents-created` handler denies popups and webview attachment;
  - URLs with embedded credentials or more than 2,048 characters are rejected before they can enter workspace state or exports;
  - partition directory removal uses the validated UUID-only `browserdeck-profile-<uuid>` helper; profile clearing uses the hardened session accessor;
  - workspace import verifies the selected path is a regular file and read failures return a safe error; transfer validation rejects credential-bearing and oversized URLs and prototype-pollution-style freeform keys;
  - added Electron fuses to `electron-builder.yml`: RunAsNode and Node options/inspector arguments disabled, file-protocol extra privileges disabled, embedded ASAR integrity and only-load-from-ASAR enabled, ad-hoc Darwin signature reset;
  - added 10 unit tests for CSP, trusted shell documents, shell asset path/MIME handling, partition directory validation, credential/length URL rejection, and import hardening;
  - extended e2e to verify the `browserdeck://shell/index.html` shell URL, inline-script and cross-origin-fetch CSP blocking, invalid-sender rejection from a separate node-enabled `BrowserWindow`, and blocked remote `file:`/`data:` navigation;
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
  - `BROWSERDECK_STRESS_CYCLES=50 npx playwright test tests/e2e/browser-panes.spec.ts` exercised 50 round trips between the authenticated original workspace and a four-pane stress workspace with two loaded fixture pages;
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
| `npm run test:e2e` | Passed: 2 Playwright tests, 14.0 s on final `main`. Integration coverage includes native/session/lifecycle/workspace/rename/shortcut behavior, `browserdeck://shell/index.html`, shell CSP inline-script and cross-origin-fetch blocking, invalid-sender IPC rejection, and blocked remote `file:`/`data:` navigation; the accessibility test covers roles, names, focus, dialogs, the CDP tree, and axe audits. |
| `BROWSERDECK_STRESS_CYCLES=8 npm run test:e2e` | Passed earlier in Phase 4: 1 Playwright test, 11.3 s. Eight switch cycles ended with 2 webContents and working set 575 MB → 515 MB. |
| `BROWSERDECK_STRESS_CYCLES=25 npm run test:e2e` | Passed earlier in Phase 4: 1 Playwright test, 14.5 s. Twenty-five cycles ended with 2 webContents and working set 573 MB → 643 MB. |
| `BROWSERDECK_STRESS_CYCLES=50 npx playwright test tests/e2e/browser-panes.spec.ts` | Passed: 1 Playwright test, 20.1 s on `main` after the final merge. Fifty cycles ended with 2 webContents and working set 589 MB → 684 MB. Earlier 50-cycle runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (114.38 kB), preload (5.75 kB), renderer bundle (271.17 kB), and CSS (22.81 kB). |
| `npm run package:dir` | Passed on final `main`. electron-builder packaged BrowserDeck 0.1.0 arm64, applied `@electron/fuses`, and skipped macOS signing because `identity: null`. |
| `npx electron-fuses read --app dist/mac-arm64/BrowserDeck.app` | Passed. RunAsNode disabled; Node options and inspector arguments disabled; embedded ASAR integrity and only-load-from-ASAR enabled; file-protocol extra privileges disabled. |
| `npm run package:mac` | Passed earlier in Phase 4: produced `BrowserDeck-0.1.0-arm64.dmg` (118 MB), `BrowserDeck-0.1.0-arm64.zip` (115 MB), and `BrowserDeck.app` (273 MB) under `dist/`. DMG/ZIP were not rebuilt after the security merge; `package:dir` exercised the merged fuse configuration. |
| Packaged bundle inspection | Passed earlier: binary arm64; `CFBundleIdentifier=com.kanharithsok.browser-deck`, version `0.1.0`, icon `icon.icns`, category `public.app-category.developer-tools`; unsigned/ad-hoc. |
| Packaged launch | Passed earlier. The unsigned app launched, rendered the shell and panes, and quit cleanly. |
| Packaged shell smoke (final merged branch) | Passed. Fresh `dist/mac-arm64/BrowserDeck.app` launched with an isolated `HOME` and `--remote-debugging-port=9333`; `/json/list` reported `title: "BrowserDeck"` and `url: "browserdeck://shell/index.html"`. The process was terminated after inspection, so clean quit was not re-verified in this smoke check. |

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
| `npx electron-fuses read --app dist/mac-arm64/BrowserDeck.app` | Passed. `RunAsNode` disabled; `EnableNodeOptionsEnvironmentVariable` disabled; `EnableNodeCliArguments` disabled; `EnableEmbeddedAsarIntegrityValidation` enabled; `OnlyLoadAppFromAsar` enabled; `GrantFileProtocolExtraPrivileges` disabled. The bundled `@electron/fuses` 1.8.0 CLI labels Electron 45's unconfigured `WasmTrapHandlers` fuse as `undefined`; all configured security fuses read correctly. |
| Packaged shell smoke | Passed. Fresh `dist/mac-arm64/BrowserDeck.app` launched with an isolated `HOME` and `--remote-debugging-port=9333`; `/json/list` reported `title: "BrowserDeck"`, `url: "browserdeck://shell/index.html"`. The process was terminated after inspection, so clean quit was not re-verified in this smoke check. |
| Packaged app log | No startup or protocol errors were emitted; only Chromium's DevTools listening line appeared. |
| Development shell smoke | Passed. `npx electron-vite dev --remoteDebuggingPort 9335` served the shell at `http://localhost:5173/`; CDP evaluation reported `title: "BrowserDeck"`, `.toolbar` present, one `#app` child, and no static CSP meta tag. The development process was terminated after inspection. |
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
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.2 s. Includes a five-column frame narrowing that changes the fit scale and a return to two columns that restores it. |
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
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.0 s. The device test rejects an unknown preset, creates a mobile 390 × 844 DPR 3 pane, verifies its viewport, preset control, and fit emulation, and closes it cleanly. |
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

**Change:** Removed the Grid/Freeform/Canvas switcher, grid-column selector, Tidy action, and native grid/freeform toggle. Startup, workspace restore, saves, and exports normalize to Canvas; legacy Grid/Freeform layout fields remain readable for migration. Canvas pane headers now drag with live edge/center snapping guides calculated in world space, using an 8-screen-pixel threshold divided by zoom. The quiet toolbar **+** opens a Herdr-inspired in-shell menu with Responsive plus curated iPhone, Samsung Galaxy, Google Pixel, iPad, Galaxy Tab, MacBook Air, and desktop presets; a Dimensions column replaces the old native menu. Right-clicking empty Canvas opens a matching menu with Add pane, Fit all panes, Reset zoom, Hand tool, Profiles, Workspaces, and Appearance. The menus use sections, monochrome icons, checked/radio states, keyboard navigation, Escape dismissal, click-outside dismissal, and focus return. Because native pane views sit above the shell, only pane views intersecting the open menu are hidden and replaced by snapshots; uncovered panes stay live. The native overview hides while a menu or dialog is open. Appearance items call a new validated `browserdeck:set-theme` path. New panes are centered and focused after creation.

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

## Post-MVP — Top toolbar consolidation, bottom canvas bar, and uniform pane zoom

**Date:** 2026-11-19

**Status:** Implemented.

**Change:** Consolidated the top toolbar into one stable 42 px row: BrowserDeck brand, active-pane context, back/forward/reload, address, viewport selector, Fit all, Reload all, and Add pane. Removed the separate active-pane row and the Workspace, Profiles, Hand, and appearance toolbar buttons. Workspace management now lives in the native **Workspace → Workspaces…** item; profile management lives in a native **Profiles → Manage Profiles…** menu. Both open the existing dialogs and return focus to the active address input. Hand and appearance moved into the bottom canvas bar, which is now 280 × 40 DIP and holds Hand, zoom-out, percentage, zoom-in, and appearance; appearance opens the in-shell System/Light/Dark menu above the bar, while the native View → Theme menu remains. The custom viewport editor now replaces the address row inline, so the toolbar height stays 42 px while editing.

Canvas zoom now scales the whole pane as a unit. The pane slot is sized to the declared frame times the zoom, the header wrapper is `32 px × zoom`, and the header itself is laid out at its world width and CSS-scaled by the zoom. The page keeps its declared CSS viewport while main applies the matching device-emulation scale, so a 100 × 100 frame remains a 100 × 100 viewport at 50% and is rendered at half size without reflowing. Fit and centering math now uses the full scaled frame height.

**Files changed:** `src/renderer/src/App.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/PaneNavigation.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/zoom.html`, `src/renderer/src/zoom.ts`, `src/renderer/src/zoom.css`, `src/shared/zoom.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `tests/unit/zoom.test.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/e2e/accessibility.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-038/039 updates, ADR-041/042), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 15 unit files / 150 tests, all 13 light + 13 dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 14.8 s. Coverage includes the single-row toolbar, absence of Workspace/Profiles/Hand/Appearance toolbar buttons, native Workspace/Profiles menu commands, inline custom viewport editing at a stable toolbar height, bottom-bar Hand and appearance actions, zoom-menu overlay retention, whole-pane uniform zoom with fixed page metrics, and dialog focus return to the address input. |
| `npm run build` | Passed: main 141.52 kB, preload 8.52 kB, renderer JS 325.00 kB, shell CSS 27.32 kB, minimap CSS 3.10 kB, canvas-bar CSS 1.69 kB, shared tokens 2.98 kB. |
| Top-bar visual check | Rendered 1280 × 860 and 720 × 560 windows. One 42 px row holds the brand, active-pane URL/navigation/viewport controls, Fit all, Reload, and Add; the context collapses at narrow widths and the empty state reads "No pane selected" / "Click a pane to edit its address". |
| Bottom-bar visual check | Rendered Hand, zoom-out, 100%, zoom-in, and appearance at bottom center. The zoom menu and appearance menu stay above the bar; the minimap remains visible at the bottom-right. |
| Uniform zoom probe | Measured a 560 × 700 viewport at 100%, 50%, and 200%: card 560 × 732 / 280 × 366 / 1120 × 1464; header 32 / 16 / 64 px; page `window.innerWidth/Height` stayed 560 × 700 at every level. |

**Automated coverage:** Unit tests cover the expanded zoom/hand/theme state and action validation. E2e verifies the top toolbar composition, native menu commands, focus fallback, inline custom editor, bottom-bar controls, overlay retention, and fixed page metrics under Canvas zoom. Accessibility e2e verifies the embedded active-pane controls, toolbar tab order including Reload/Add, native-menu dialog focus return, bottom-bar Hand/Appearance labels, appearance menu semantics, and axe audits of the toolbar and canvas bar.

**Manual GUI verification still outstanding:** VoiceOver reading order across the native Workspace/Profiles menus and the separate bottom-bar webContents, long third-party URLs at the 720 px minimum width, and the custom viewport editor's invalid-error visual treatment remain manual. Native menu item clicks are exercised through `MenuItem.click()` in e2e rather than the OS menu.

**Known behavior / limitations:** The top toolbar is dense; pane context hides below a 640 px active-bar width, and the custom viewport editor replaces the address row while editing. Workspace/profile access now takes an extra native-menu step and shows the current workspace name only in the Workspaces dialog. Canvas zoom scales pane chrome down with the page, so controls are small at 25–50% but remain present. The bottom canvas bar occupies a 280 × 40 DIP rectangle at the bottom center.

## Post-MVP — Device-first chrome, rotation, capture, and Delete shortcut

**Date:** 2026-11-19

**Status:** Implemented.

**Change:** Replaced the per-device maximize button with back, forward, and reload. Maximize remains in the native **Device → Toggle Maximize** menu (`Cmd/Ctrl+Shift+M`). Rotate viewport and capture screenshot were added to the native device actions menu; rotation is disabled for responsive viewports, and capture writes a PNG through a native save dialog. Fixed viewports now persist an optional `rotated` flag that swaps their effective width/height for emulation, fit scaling, canvas frames, and labels. User-facing copy and accessible names now say **device**; internal code, IPC, storage, and architecture notes retain **pane**. `Delete`/`Backspace` closes the selected device when shell chrome has focus, no modifiers are pressed, no dialog/custom menu is open, and focus is not in a text-entry control. Cmd+D remains the native Device-menu accelerator for duplicating the selected device.

**Files changed:** `src/main/browser-manager.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/canvas.ts`, `src/shared/ipc.ts`, `src/shared/screenshot.ts`, `src/shared/viewports.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/PaneNavigation.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/minimap.ts`, `src/renderer/minimap.html`, unit tests, e2e tests, `README.md`, `docs/DECISIONS.md` (ADR-043), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc` for main/preload/shared/tests and `vue-tsc` for the renderer). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 16 files / 157 tests. Added rotation parsing/toggling/sizing/fit/canvas coverage and screenshot filename safety. |
| `npm run build` | Passed: main 147.92 kB, preload 8.85 kB, renderer JS 327.46 kB, shell CSS 27.38 kB, minimap CSS 3.10 kB, zoom CSS 1.69 kB, shared tokens 2.98 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.2 s. Coverage includes per-device header back/forward/reload, rotated emulation and frame geometry, PNG screenshot output, the Cmd+D accelerator configuration, Delete closing the selected device, and the address-field guard. |
| Visual check | Rendered a three-device Canvas at 1280 × 860: each header showed back, forward, reload, actions, and close; the iPhone frame stayed readable and the menu trigger remained visible. |

**Known behavior / limitations:** Maximize is no longer visible in the header; it lives in the native Device menu. Rotation applies only to fixed viewports. Screenshot capture always opens a native save dialog, so it is not part of the raw OS-dialog-free workflow. Delete closes from shell focus only; a focused website keeps normal keyboard input. OS-level Cmd+D delivery is not automated, but the native accelerator and command routing are verified.

## Post-MVP — Toolbar clarity, visible errors, and shortcut semantics

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Address validation messages now appear inline in the toolbar instead of only as a red border and screen-reader status. The generic Electron View reload/force-reload roles were removed; `Cmd/Ctrl+R` now reloads the selected device and `Cmd/Ctrl+L` focuses its address through the native Device menu. The active toolbar shows `Profile N · M devices` and a shared-profile tooltip when a profile is shared. The add menu now says **Start with viewport** and groups presets as phone, tablet, and desktop viewports; the profile action is **New device** and explains fresh-profile defaults. The native device actions menu gained **Copy URL** and **Maximize Device/Restore Device**, with maximize routed back to the shell by pane ID.

**Files changed:** `src/main/browser-manager.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/shared/viewports.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/PaneNavigation.vue`, tests, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-044), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 16 files / 157 tests. |
| `npm run build` | Passed: main 148.65 kB, preload 9.20 kB, renderer JS 329.05 kB, shell CSS 27.61 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.0 s. Added coverage for visible/announced address errors, `Cmd/Ctrl+L` focus, `Cmd/Ctrl+R`/`Cmd/Ctrl+L` accelerator metadata, shared-profile toolbar copy, and the viewport-language add menu. |
| Visual check | Invalid `javascript:` input displays a readable inline danger message at 1280 × 860 and 720 × 560 without toolbar overflow; Escape restores the current URL. |

**Known behavior / limitations:** Long address errors truncate with a full-text tooltip. Inline errors temporarily consume toolbar width and squeeze the address input at the minimum window width. Native pane-menu clicks for Copy URL and Maximize/Restore are not automated by Playwright and need a manual GUI pass.

## Post-MVP — Visible feedback for blocked popups, downloads, and permissions

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Added a `browserdeck:pane-notice` main → shell event and a transient header status for blocked remote actions. Popups are reported by the pane `setWindowOpenHandler`; permission requests are mapped by `webContents` ID; downloads are mapped by profile and initiator origin. Notices are short, non-interactive messages, coalesce identical text per device, and auto-dismiss after six seconds. The deny-by-default policy is unchanged: there are no Allow/Prompt controls, no download handling, and no permission persistence in this slice.

**Files changed:** `src/main/session-policy.ts`, `src/main/browser-manager.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-045), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 157 tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.47 kB, preload 9.49 kB, renderer JS 330.90 kB, shell CSS 27.61 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.5 s. Added coverage for `Popup blocked`, `Notifications blocked`, and `Download blocked` notices on the originating device. |
| Visual check | Triggered a fixture notification request and confirmed `Notifications blocked` appears in the device header without shifting the workspace. |

**Known behavior / limitations:** Notices are informational only. Events that cannot be attributed to a live pane are denied without a message. Repeated identical notices keep the six-second timer refreshed rather than stacking. Native permission prompts and download management remain intentionally out of scope.

## Post-MVP — Searchable device palette

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Added `Cmd/Ctrl+K` / **Device → Find Device…**, which opens a trusted shell quick switcher for the current workspace. The palette filters by device title, hostname, profile label, and effective viewport; keeps the active device first and sorts the rest by title; supports arrow navigation, Enter to center/select the device and focus its address, Escape to close, and click-outside dismissal. All native pane views, the minimap, and the bottom canvas bar hide while the palette is open and restore through the existing validated visibility path on close. The overlay uses dialog, combobox, and listbox semantics and does not show full URLs or query strings.

**Files changed:** `src/main/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/App.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-046), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 157 tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.81 kB, preload 9.49 kB, renderer JS 338.61 kB, shell CSS 29.66 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.4 s. Added palette accelerator, visibility, filtering, Enter/center/focus, Escape, and no-match coverage. |
| Visual check | Rendered the palette over a two-device Canvas; the search field, active-first list, selected row, detail metadata, and keyboard hints fit cleanly at 1280 × 860. |

**Known behavior / limitations:** Opening the palette freezes live pages behind snapshots while native views are hidden, matching existing dialogs and menus. While it is open, native menu commands other than Find Device are ignored. Full URLs and query strings are not shown in search results. Action commands and fuzzy scoring are deferred. Native accelerator delivery and shell focus when Cmd/Ctrl+K is pressed while a website has focus remain manual checks.

## Post-MVP — Device palette discovery and match highlighting

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Added a magnifier button to the top toolbar so the device palette is discoverable without the native menu, while keeping `Cmd/Ctrl+K` and **Device → Find Device…** as-is. The palette now highlights matching substrings in device titles, host/profile details, and viewport badges. Results moved to a clearer title + metadata + viewport-badge hierarchy.

**Files changed:** `src/renderer/src/App.vue`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-047), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 157 tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.81 kB, preload 9.49 kB, renderer JS 342.09 kB, shell CSS 30.33 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.9 s. Added toolbar-button, viewport-badge, match-highlighting, and no-match coverage. |
| Visual check | Rendered a search for `pane`: both titles and the `Responsive` badges highlighted, metadata stayed on one line, and the new toolbar magnifier was visible. |

**Known behavior / limitations:** The toolbar entry is disabled when there are no devices. Search still excludes full URLs and query strings. Fuzzy scoring and action commands remain deferred.

## Post-MVP — Reapply Canvas zoom after reload

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Reloading a pane at non-100% Canvas zoom could leave the web content at the pre-reload scale while the pane frame stayed scaled. Chromium can reset device emulation during navigation, but `BrowserManager` skipped reapplying it because the cached emulation signature still matched. `did-start-loading` now invalidates that signature, so `did-stop-loading` reapplies the current viewport and Canvas scale. App-initiated reloads also hold emulated native views hidden until that reapplication finishes, avoiding the old scale flash and showing the existing snapshot/loading state instead. The declared page viewport remains unchanged: at 80% zoom, `innerWidth/Height` stays 560 × 700 and emulation scale returns to 0.8.

**Files changed:** `src/main/browser-manager.ts`, `tests/e2e/browser-panes.spec.ts`, `docs/ARCHITECTURE.md`, and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 157 tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.93 kB, preload 9.49 kB, renderer JS 342.09 kB, shell CSS 30.33 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.7 s. Added an 80% zoom reload check for emulation scale and fixed page viewport. One earlier full run hit the existing stress-load timeout; the suite passed on rerun. |
| Visual check | At 50% Canvas zoom, reloading the fixture pane restored content that matched the 50% frame instead of rendering at the previous 100% scale. |

**Known behavior / limitations:** This fixes normal Canvas zoom and reload. Pane maximize was subsequently removed from the product.

## Post-MVP — Unified device actions menu and whole-pane selection ring

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Replaced the native pane-actions popup with the custom shell `AppMenu` used by the `+` menu. The device menu now has Navigate, Viewport, and Manage sections, matching icons, 11 actions, keyboard navigation, Escape dismissal, focus return, and intersecting-native-view hiding with snapshots. Added narrow validated IPC for Copy URL and detached DevTools; removed the obsolete native pane-menu request and maximize event surface. Moved the selected-device accent ring from an inset card shadow to the pane slot so it surrounds the whole frame outside native bounds.

**Files changed:** `src/main/browser-manager.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/App.vue`, `src/renderer/src/menu.ts`, `src/renderer/src/components/MenuIcon.vue`, `src/renderer/src/components/PaneCard.vue`, tests, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-048), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 157 tests, and all contrast pairs. |
| `npm run build` | Passed: main 149.93 kB, preload 9.28 kB, renderer JS 348.25 kB, shell CSS 30.34 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.6 s. Added custom pane-menu structure, item, native-view hiding, focus-return, and Copy URL coverage. |
| Visual check | Confirmed the pane actions menu matches the `+` menu and the accent ring surrounds the entire selected pane in Canvas. |

**Known behavior / limitations:** The macOS application menu bar remains native OS chrome. Custom menus hide only native views that intersect them. The selection ring may be visually covered by another overlapping pane's native content, but never by the selected pane's own website.

## Post-MVP — Remove pane maximize and keep Reload All selection

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Removed pane maximize completely: renderer state, slot geometry, native Device-menu item, `Cmd/Ctrl+Shift+M`, command routing, the custom device-menu action, the pure layout helper, and its tests. Canvas zoom, Fit all, the overview, and the device palette remain the ways to locate and focus panes. Application-window maximize/full-screen behavior is unchanged. Reload All now captures the selected pane, suppresses incidental native focus selection during the settle window, and restores the captured selection.

**Files changed:** `src/main/index.ts`, `src/shared/ipc.ts`, `src/shared/layout.ts`, `src/renderer/src/App.vue`, `src/renderer/src/menu.ts`, `src/renderer/src/components/MenuIcon.vue`, tests, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-049), and `docs/MANUAL_CHECKS.md`.

**Build:** main 149.74 kB, preload 9.28 kB, renderer JS 346.09 kB, shell CSS 30.34 kB.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 16 unit files / 155 tests, and all contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.4 s. Added Reload All selection preservation coverage and removed pane-maximize test paths. |
| Automated check | The custom device menu has 10 items with no maximize action; the native Device menu item is removed; Reload All leaves the selected device unchanged. |

**Known behavior / limitations:** Application-window maximize remains available through macOS window controls. Reload All may ignore an incidental focus change for the short suppression window, but explicit user selection remains available immediately afterward.

## Post-MVP — Move top-right actions into the bottom canvas bar

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Removed the Find device, Reload all, and Fit all icons from the top toolbar. The top right now keeps only Add alongside the active-device controls. Find device and Reload all moved into the bottom canvas bar beside the zoom controls; the bar widened from 280 to 352 DIP and its validated action contract gained `find-device` and `reload-all`. Fit all remains available from the overview header and the zoom percentage menu.

**Files changed:** `src/shared/zoom.ts`, `src/renderer/zoom.html`, `src/renderer/src/zoom.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, tests, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-050), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 155 unit tests, and all contrast pairs. |
| `npm run build` | Passed: main 149.88 kB, preload 9.28 kB, renderer JS 343.94 kB, shell CSS 29.53 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.9 s. Updated palette, Reload All, Fit all, bottom-bar, and accessibility coverage. |
| Visual check | Confirmed the top right has only Add; the bottom bar shows Hand, zoom controls, Find, Reload all, and Appearance at 1280 × 860. |

**Known behavior / limitations:** The bottom bar is wider and more control-dense. Fit all is available from the overview and zoom menu but no longer has a dedicated top-toolbar button.

## Post-MVP — Compact centered top bar, reliable hit targets, and BrowserDeck app menu

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Removed back, forward, and reload from the top bar so navigation exists only in each device header. Marked the top navigation row as a no-drag region, increased nav-control and field hit areas, gave the address and viewport controls visible inset surfaces, and added pointer cursors. Centered a 400 px address field with the viewport select; URL text is centered while idle and left-aligned while editing. The viewport select stays next to the address with a fixed default width of 184 px, keeps full preset names and CSS dimensions, steps down at narrow toolbar widths, and falls back to a tooltip when space truncates the label. The active-device context remains anchored at the far left so the bar reads as three stable zones: context, address plus viewport, and Add. Removed the visible BrowserDeck brand from the toolbar while retaining a visually hidden level-one heading. Replaced the default macOS app-menu role with an explicit **BrowserDeck** application menu and set the About panel name to BrowserDeck.

**Files changed:** `src/main/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/PaneNavigation.vue`, tests, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-051), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 155 unit tests, and all contrast pairs. |
| `npm run build` | Passed: main 150.24 kB, preload 9.28 kB, renderer JS 344.05 kB, shell CSS 30.53 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 15.7 s. Added fixed-width viewport selector, full-label, and tooltip coverage. |
| Visual check | Confirmed the centered short address field, the fixed-width viewport selector with the full preset label at 1280 px, its responsive width at 720 px, no visible BrowserDeck brand, Add-only right side, and new bottom-bar Find/Reload controls. |
| App menu check | The running macOS menu reports `BrowserDeck` as its application-menu label. |

**Known behavior / limitations:** Window dragging remains available from the toolbar background, active-device context, and titlebar inset. The Dock name in an unpackaged development launch still comes from Electron; packaged builds use BrowserDeck.

## Post-MVP — Restore the last Canvas camera and add zoom shortcuts

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Each workspace now stores an optional `view` containing the Canvas pan, zoom, and active device in its layout. Reopening the app or switching back to a workspace restores that camera and selection synchronously; only workspaces without a saved view run the fit-on-open path. Discrete camera changes, gesture ends, and selection changes save immediately, continuous gestures use a short debounce, and a best-effort save runs while the shell unloads. A restored camera that leaves a pane partially offscreen no longer blocks its first page load: main applies the pane's first bounds even while hidden. Incidental native focus events are briefly ignored while recreated views settle so the saved selection sticks. The native View menu now adds Canvas **Zoom In** (`Cmd/Ctrl+=`), **Zoom Out** (`Cmd/Ctrl+-`), and **Reset Zoom** (`Cmd/Ctrl+0`), routed through the same zoom core as the bottom bar.

**Files changed:** `src/shared/workspace.ts`, `src/main/workspace-store.ts`, `src/main/browser-manager.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/App.vue`, `tests/unit/workspace.test.ts`, `tests/unit/workspace-store.test.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-052), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 158 unit tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.62 kB, preload 9.28 kB, renderer JS 347.19 kB, shell CSS 30.53 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.4 s. Sets 50%/75% camera state and a selection, closes immediately, relaunches, and verifies the final zoom, pan-derived pane position, selected device, and offscreen pane loading. Also asserts the native zoom accelerators and command routing. |
| Visual/automated check | The restarted app restores the 75% camera and active device; a partially visible pane finishes loading instead of remaining blank. |

**Known behavior / limitations:** A stale saved camera may point at empty world space or leave panes offscreen; Fit all remains available in the overview and zoom menu. New, duplicated, and imported workspaces start fitted because they have no camera view. This supersedes earlier notes in this report that pan, zoom, and cleared selection were transient.

## Post-MVP — Unified viewport and Add preset menus

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Replaced the native active-pane viewport `<select>` with a compact button that opens the same custom `AppMenu` used by Add. The trigger shows the short preset name and keeps the full name plus CSS dimensions in its tooltip; the menu shows full names left-aligned and dimensions right-aligned, with a checkmark for the active preset and a Custom… item that opens the inline editor and focuses its width field. The Add menu now uses the complete fixed preset catalog instead of a curated subset, so both menus list Generic phone, iPhone 15 Pro Max, Samsung Galaxy S24 Ultra, Google Pixel 8 Pro, Generic tablet, Laptop, and every other fixed preset. Both menus share the same headings, icons, item styling, and dimensions.

**Files changed:** `src/renderer/src/App.vue`, `src/renderer/src/components/AppMenu.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/PaneNavigation.vue`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-053), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 158 unit tests, and all contrast pairs. |
| `npm run build` | Passed: main 151.62 kB, preload 9.28 kB, renderer JS 349.70 kB, shell CSS 30.97 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 17.0 s. Verifies 17 viewport items, 16 Add items, matching category groups and missing presets, menu selection, trigger label/tooltip/`data-preset`, Custom editor focus, and updated menu-button accessibility semantics. |
| Visual check | Confirmed 304 px menus at 1280 × 860 with left-aligned names, right-aligned dimensions, a right-side checkmark, no horizontal clipping, and the complete catalog visible without scrolling. Shorter windows scroll within the shared 660 px maximum height. |

**Known behavior / limitations:** The viewport trigger deliberately shows the short device name to avoid clipping; the full name and dimensions are available on hover and in the menu. Custom… exists only in the viewport menu because adding a device from custom dimensions would need an add-time dimension form. The complete catalog is visible at typical window sizes; both menus scroll on shorter windows. This supersedes the native-selector wording and the earlier curated Add-menu subset noted above.

## Post-MVP — Duplicate anchoring, Cmd+N, and Canvas Arrange

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** `Cmd/Ctrl+D` now anchors the duplicate to the selected device. The renderer computes the right-hand slot and, when it is occupied, places the duplicate at the source's left edge directly below it, scanning down past existing frames. The pending position is applied before default placement, camera reveal, and persistence, so the duplicate never jumps away from its source. `Cmd/Ctrl+N` replaces `Cmd/Ctrl+T` as the native Add Device accelerator. A new Arrange menu in the bottom canvas bar offers Showcase layout, Horizontal row, 2 × 2 grid, and Vertical stack. Showcase packs panes into 24 px rows that wrap at 2400 px and centers shorter rows; the other modes use the standard canvas gap. Every arrangement preserves pane order, writes new world positions, and fits the camera to the result. The placement and arrangement math lives in pure `src/shared/canvas.ts` helpers.

**Files changed:** `src/shared/canvas.ts`, `src/shared/zoom.ts`, `src/main/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/zoom.ts`, `src/renderer/zoom.html`, `src/renderer/src/menu.ts`, `src/renderer/src/components/MenuIcon.vue`, `tests/unit/canvas.test.ts`, `tests/unit/zoom.test.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-054), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 163 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.9 s. Verifies `CmdOrCtrl+N` metadata, duplicate coordinates beside/below the source, and the four Arrange actions plus horizontal-row positions. |
| Build | Passed as part of e2e: main 151.68 kB, preload 9.28 kB, renderer JS 359.58 kB, shell CSS 30.97 kB. |

**Known behavior / limitations:** Arrange is a one-shot command and replaces manual positions for every device in the workspace. Showcase wrapping and centering are covered by unit tests but only Horizontal row is exercised end-to-end. Duplicate placement falls back below the source rather than pushing existing panes aside.

## Post-MVP — Per-device viewport control and a quieter main toolbar

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Canvas device headers now have a six-dot drag grip and a per-device viewport trigger that shows the short preset name plus CSS dimensions and opens the 17-item preset menu for that specific pane from the trigger's left edge. Dimensions drop out below a 470 px header width, keeping every action inside a 390 px mobile frame. The full viewport selector was removed from the main top toolbar; selecting Custom… from a header still opens the existing inline width/height/DPR editor in the toolbar, and a compact edit button remains while the active device uses a custom viewport. A new Open in Browser action is available from the header and the device actions menu, backed by a validated `browserdeck:open-pane-external` channel that accepts only the pane's current HTTP(S) URL, rejects blank and non-web addresses, and calls `shell.openExternal` in main. The header stays on one row; synced/mirroring UI and global zoom controls were intentionally not added.

**Files changed:** `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/PaneNavigation.vue`, `src/renderer/src/components/GlobalPaneBar.vue`, `src/renderer/src/components/MenuIcon.vue`, `src/renderer/src/App.vue`, `src/renderer/src/menu.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/browser-manager.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/e2e/accessibility.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-055), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 163 unit tests, and all light/dark contrast pairs. |
| `npm run build` | Passed: main 152.60 kB, preload 9.43 kB, renderer JS 364.11 kB, shell CSS 32.14 kB. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 16.9 s. Verifies per-device preset selection, toolbar Custom handoff, mobile-header containment, 11 device actions, external URL handoff through a stubbed `shell.openExternal`, and the updated tab order. |
| Accessibility | Axe/role/AX checks pass with the viewport trigger in the device header. Focus order is address → Add → viewport → reload → open in browser → actions → close, then the next device. |

**Known behavior / limitations:** The header remains one row, so the profile and viewport dimensions are hidden first on narrow frames. Custom viewport dimensions are still edited in the top toolbar rather than inline in the header. Open in Browser launches the system default browser and is intentionally disabled for blank devices. There is no synchronized/mirroring feature, so no Synced badge or toggle is shown.

## Post-MVP — Marquee multi-select

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Added a Select toggle to the bottom canvas bar. While active, dragging from empty canvas or pane chrome draws a marquee instead of panning or moving a pane; native views are hidden for the gesture so the rectangle and selected rings remain visible. The pure `canvasPaneIdsInRect` helper selects every intersecting frame. Selected pane slots get a two-pixel accent ring, and the toolbar shows a live `N selected` chip with a close action. `Delete`/`Backspace` closes the selected set, `Escape` clears it and then exits the tool, and clicking a pane without dragging selects only that pane. Select and Hand are mutually exclusive and their states are synchronized to the native bottom bar through a validated `browserdeck:set-canvas-select-mode` channel.

**Files changed:** `src/shared/canvas.ts`, `src/shared/zoom.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/renderer/src/App.vue`, `src/renderer/src/zoom.ts`, `src/renderer/zoom.html`, `tests/unit/canvas.test.ts`, `tests/unit/zoom.test.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/e2e/accessibility.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-056), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 164 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 17.0 s. Creates four stress panes, fits them, marquee-selects two, verifies selected rings and the count chip, deletes them, and confirms the remaining panes and leak cycles still pass. |
| `npm run build` | Passed: main 153.34 kB, preload 9.59 kB, renderer JS 373.05 kB, shell CSS 33.29 kB. |
| Accessibility | Select has an accessible name, tooltip, and `aria-pressed` state; axe/role checks continue to pass for the bottom bar. |

**Known behavior / limitations:** Multi-select is Canvas-only and has no undo. A marquee cannot start over native page content because that input belongs to the remote page; start from empty canvas or pane chrome. Selection is ephemeral and clears on workspace switch. Selection does not change the active pane, so address and viewport controls still target the existing active device.

## Post-MVP — Preset user agents for real mobile layouts

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Fixed device presets now send a category-appropriate browser user agent: iPhone Safari for Apple and generic phones, Android Chrome for Galaxy/Pixel phones, iPad Safari for iPad and generic tablets, Android Chrome for the Galaxy Tab, and desktop Chrome for laptop/desktop presets. Responsive and custom panes keep Electron's default UA. BrowserManager stores the pane's original UA, applies the mapped UA before the first load, and reloads the current URL only when a viewport change moves the pane to a different UA category. Switching between presets in the same category does not reload. This fixes the common mobile-site case where desktop markup has a 400px minimum inside a 375px emulated viewport. The viewport and DPR remain exact; the UA is for layout fidelity, not restriction bypass.

**Files changed:** `src/shared/user-agent.ts`, `src/main/browser-manager.ts`, `tests/unit/user-agent.test.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-057), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 170 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.1 s. Verifies iPhone UA on Generic phone, iPad UA on Generic tablet, Android 14 UA on Pixel 8, and the default UA after returning to Responsive. |
| `npm run build` | Passed: main 156.01 kB, preload 9.59 kB, renderer JS 373.05 kB, shell CSS 33.29 kB. |
| Manual Google check | On the 1× Dell display at iPhone SE, the page changed from `scrollWidth 400` with a horizontal scrollbar to `scrollWidth 360` with no horizontal overflow. Native bounds and emulation stayed `375 × 667 @ DPR 2`. |

**Known behavior / limitations:** UA changes between categories reload the current page and can discard unsaved page state. The UAs are category-level, not exact model identities, and User-Agent Client Hints may still expose Chromium. Touch, GPS, and other device APIs remain unemulated. Responsive and custom panes can still overflow when a site serves desktop markup.

## Post-MVP — Cmd+N opens the Add Device picker

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** The native **Add Device** command and `Cmd/Ctrl+N` now open the same in-shell Add Device menu as the toolbar + button instead of creating a responsive pane immediately. The menu anchors to the + button, keeps the normal focus-return behavior, and creates nothing until the user chooses Responsive or a fixed preset. The direct `browserdeck:add-pane` IPC remains available for tests and internal creation paths.

**Files changed:** `src/renderer/src/App.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/DECISIONS.md` (ADR-058), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 170 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 17.9 s. Invokes `pane-add`, verifies the Add Device menu appears while the pane count stays at two, selects Responsive, and confirms a fresh-profile pane is created. |
| `npm run build` | Passed: main 156.01 kB, preload 9.59 kB, renderer JS 373.20 kB, shell CSS 33.29 kB. |

**Known behavior / limitations:** `Cmd/Ctrl+N` now needs a preset choice before a pane exists. The direct API still creates a responsive pane when called programmatically. The menu opens anchored to the toolbar + rather than at the pointer.

## Post-MVP — Proximity guides and bottom-bar tool icons

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Pane dragging now has two magnetic stops. Within 24 screen pixels of a neighboring opposite edge, the pane snaps to a 16px gap; continuing into the 8-pixel window snaps flush. A wider 64-pixel approach shows a lighter dashed proximity guide before the gap stop. Solid guides appear for both snap stages, dashed guides only while the pane is near but unsnapped, and one nearest guide per axis is used. Both guide sets clear on drag start, release, cancel, workspace switch, and mode change. The bottom-bar Hand and Select controls now use palm and pointer-cursor icons; names, tooltips, pressed state, and behavior are unchanged.

**Files changed:** `src/shared/canvas.ts`, `src/renderer/src/App.vue`, `src/renderer/zoom.html`, `tests/unit/canvas.test.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-059), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 172 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests. Drags to a 50px pointer gap for the dashed preview, to a 30px pointer gap and verifies the resulting 16px snap, then into flush range; all guides clear on release. |
| `npm run build` | Passed: main 157.96 kB, preload 9.79 kB, renderer JS 377.72 kB, shell CSS 33.69 kB. |

**Known behavior / limitations:** Proximity shows only the nearest guide per axis, not every nearby edge. At low zoom the 24/64px screen thresholds cover larger world distances by design. Closing in from flush returns to the 16px stop before releasing completely.

## Post-MVP — Profiles follow their pane lifecycle

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Closing the last pane that uses a profile now releases the profile with it: storage, cache, and auth data are cleared, metadata is removed from `profiles.json`, and the partition directory is deleted. The pane disappears immediately; cleanup completes asynchronously. Shared profiles remain until their final pane closes. Workspace switches, app shutdown, and the profile manager's confirmed close-and-delete path skip the automatic release because they either retain the workspace or already own cleanup. Unused profiles from duplicated or imported workspaces still support explicit clear/delete.

**Files changed:** `src/main/browser-manager.ts`, `src/main/index.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-060), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 172 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.1 s. Verifies Bob's exclusive profile and cookies disappear after close, self-closed panes release their profiles, shared Alice-profile panes keep the profile until only Alice remains, and a duplicated-workspace profile still supports rename/clear/delete. |
| `npm run build` | Passed: main 157.96 kB, preload 9.79 kB, renderer JS 377.72 kB, shell CSS 33.69 kB. |

**Known behavior / limitations:** Reopening a closed device starts signed out. Closing has no extra delete confirmation by design. Cleanup is asynchronous, so a profile may briefly outlive its pane in `profiles.json` while session data is being cleared. A profile referenced only by an inactive workspace is still treated as unused and can be deleted from the manager.

## Post-MVP — Canvas overlays only hide when a menu covers them

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** The bottom canvas bar and minimap no longer disappear for every menu. Each overlay now hides independently only when the open menu rectangle intersects it. Zoom, Arrange, and appearance menus keep both visible. Overlay visibility stays stable until menu bounds arrive, avoiding the hide/show flicker; the menu itself is invisible while positioning. Dialogs, the device palette, and marquee drags still hide both, as before.

**Files changed:** `src/renderer/src/App.vue`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-061), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 172 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.1 s. Opens the upper-left canvas menu and verifies the minimap and bottom bar stay visible; existing dialog/palette hiding remains covered. |
| `npm run build` | Passed: main 157.96 kB, preload 9.79 kB, renderer JS 377.72 kB, shell CSS 33.69 kB. |

**Known behavior / limitations:** Overlay overlap is estimated from the shell using the shared bar/minimap dimensions and the uncollapsed minimap height, so a collapsed minimap may hide slightly earlier than strictly necessary. Menus near the bottom edge can still hide the overlay they cover.

## Post-MVP — Independent pane browsers, Clear Site Data, and two-row headers

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Removed the Profiles menu, Profiles dialog, profile labels/counts, explicit sharing, and profile-picker IPC. Every pane now behaves as an independent browser session: its own address bar, history, viewport, user agent, cookies, storage, cache, and auth. Closing a pane releases its session and partition; deleting an inactive workspace releases sessions referenced only by that workspace. Added a confirmed **Clear Site Data…** action that resets one live pane and reloads it. Moved the address bar into a second pane-header row and reduced the main toolbar to Add plus draggable space. Canvas header allowance increased from 32 to 64 CSS pixels, and custom viewport editing now replaces the pane's address row. The device palette no longer searches profile labels.

**Files changed:** `src/shared/ipc.ts`, `src/shared/canvas.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/main/browser-manager.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/MenuIcon.vue`, `src/renderer/src/menu.ts`, `src/renderer/src/components/GlobalPaneBar.vue` (removed), `tests/e2e/accessibility.spec.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/unit/minimap.test.ts`, `README.md`, `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-062, ADR-063), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 172 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 17.4 s. Verifies the absent Profiles menu, per-pane address rows, Add-only toolbar, exclusive session release, confirmed Clear Site Data without affecting Alice, workspace session cleanup, and updated focus order. |
| `npm run build` | Passed: main 154.18 kB, preload 9.15 kB, renderer JS 357.01 kB, shell CSS 30.73 kB. |

**Known behavior / limitations:** Closing a pane permanently discards its session. Clear Site Data signs out and loses unsaved page state. The main toolbar is intentionally almost empty. Canvas frames are 32 px taller. Panes are isolated browser sessions inside one Chromium runtime, not separate browser installations.

## Post-MVP — Mobile fidelity, quiet pane header, and menu-style Workspaces panel

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Phone and tablet presets now use Chromium mobile metrics and five-point touch emulation, so fixed viewports honor viewport meta tags, use mobile scrollbars, and report `hover: none`/`pointer: coarse`. Responsive edits use a single CDP emulation path, and returning to Responsive clears the fixed override. The pane address field is transparent and centered at rest, left-aligns on focus, and the decorative status dot was removed. The second header row now shows the viewport class (`Phone`, `Tablet`, `Desktop`, `Responsive`, or `Custom`) on the left and the CSS resolution on the right; both hide while the custom viewport editor is open. Invalid-address text stays in the address row instead of crowding the title. The Workspaces panel is now a compact 460 px menu-style surface with single-click workspace selection, a per-row actions menu for rename/duplicate/delete, and no redundant footer Close button.

**Files changed:** `src/main/browser-manager.ts`, `src/shared/viewports.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/PaneNavigation.vue`, `tests/unit/viewports.test.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/browser-panes.spec.ts`, `tests/fixtures/server.cjs`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-064, ADR-065, ADR-066), `docs/MANUAL_CHECKS.md`, and `docs/PHASE_REPORTS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 174 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.7 s. Covers mobile scrollbars/touch/pointer media and responsive clearing, header class/resolution labels, per-pane sessions, workspace row menus, dialog focus/Escape ordering, and axe accessibility. |
| `npm run build` | Passed: main 156.59 kB, preload 9.15 kB, renderer JS 359.36 kB, shell CSS 31.80 kB. |
| Running-app probes | iPhone SE reports 375 × 667, `scrollbarWidth: 0`, `maxTouchPoints: 5`, `hover: false`, and `pointer: coarse`; switching back to Responsive restores fine-pointer behavior. Header screenshots verify centered/left-aligned address states, hidden side labels during custom editing, and the compact Workspaces panel with its row actions popover. |

**Known behavior / limitations:** Mobile behavior is Chromium emulation, not physical hardware; sensors, GPS, and device-specific APIs are not simulated. Fixed viewports remain fit-scaled inside the pane. Workspace rows switch in one click, while rename, duplicate, and delete take one additional click through the row menu. The row actions menu closes before Escape closes the Workspaces panel.

## Post-MVP — Continuous Canvas backdrop and bottom-bar-safe Fit all

**Date:** 2026-11-20

**Status:** Reverted by the next entry; the Fit all and drag-clamp parts remain.

**Change:** Moved the Canvas dot field to the app shell and made the top toolbar transparent with no divider, so the workspace backdrop now reaches the top window edge while the toolbar keeps its 42 px drag region, traffic-light clearance, and Add control. Pan offsets still drive the grid, now offset by the toolbar height so dots stay aligned with the workspace world. Fit all, single-pane focus, reveal centering, and partially visible pane centering now use one safe Canvas viewport: 24 px top/side padding and a 64 px bottom inset covering the bar's 12 px margin, 40 px height, and 12 px clearance. Pane header icon targets increased from 24 to 26 px so the two-pane startup fit at roughly 95.5% still meets the 24 px accessibility target. Pane dragging now stops 24 px below the workspace top so a header cannot disappear under the transparent toolbar; Canvas panning remains free for intentional off-screen navigation. The e2e drag setup now starts from the title element rather than a fixed offset that could land on the viewport trigger, and the native-view geometry check accounts for Canvas zoom.

**Files changed:** `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/shared/canvas.ts`, `tests/unit/canvas.test.ts`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-067, ADR-068, ADR-069), `docs/MANUAL_CHECKS.md`, and `docs/PHASE_REPORTS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 177 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.6 s. Verifies the transparent toolbar and shell-owned dot backdrop, Fit all with every pane bottom above the native bottom bar, pane drag persistence, zoom-aware native bounds, sessions, workspace actions, and axe accessibility. |
| `npm run build` | Passed: main 156.59 kB, preload 9.15 kB, renderer JS 359.97 kB, shell CSS 32.17 kB. |
| Running-app probes | Light and dark screenshots show a continuous dot field behind the toolbar. At 1280 × 860, the native bar sits at `y = 808`; fitted pane bottoms land at `y = 796`, leaving 12 px clearance. Dragging a header 220 px upward stops at the 24 px top inset with the header still visible. |

**Known behavior / limitations:** Fit all may choose a zoom below 100% when tall panes would otherwise reach the bottom bar. Dragging cannot hide a header under the top edge, but manual Canvas panning can still move panes partly off-screen; selecting one or using Fit all restores it. The minimap can still cover a pane corner by design. The toolbar remains 42 px and draggable even though it is visually transparent.

## Post-MVP — Restore the opaque top toolbar

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Reverted the transparent top-toolbar treatment. The toolbar is again an opaque `--surface` 42 px band with a 1 px bottom divider, and the dotted Canvas backdrop is owned by the workspace below it, with pan-driven `background-position` restored on the workspace. This removes the misleading implication that pane content can live behind the bar; native pane `WebContentsView`s stack above the shell and cannot sit under live toolbar controls. The bottom-bar-aware Fit all, 24 px pane-drag top clamp, zoom-aware geometry checks, and all other recent pane/workspace behavior remain.

**Files changed:** `src/renderer/src/App.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-067 superseded, ADR-070 added), `docs/MANUAL_CHECKS.md`, and `docs/PHASE_REPORTS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 177 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.4 s. Verifies the opaque toolbar, workspace-owned dot backdrop and pan position, Fit all above the bottom bar, pane drag clamping, sessions, workspace actions, and axe accessibility. |
| `npm run build` | Passed: main 156.59 kB, preload 9.15 kB, renderer JS 359.94 kB, shell CSS 31.80 kB. |
| Running-app screenshot | Confirms the toolbar surface and divider above a dotted workspace, with fitted panes clear of the bottom bar. |

**Known behavior / limitations:** Panes cannot be displayed interactively behind the top toolbar with the current single-shell composition. A native top-bar overlay would be required to support that visual overlap. Manual Canvas panning can still move a pane partly off-screen; selecting it or using Fit all restores it.

## BrowserDeck 1.1.0 — Rebrand, browser copy, and empty-state Add fix

**Date:** 2026-11-20

**Status:** Implemented.

**Change:** Renamed the product from PaneFlow to **BrowserDeck**. The GitHub repository is now `kanharithsok/browser-deck`; the package slug is `browser-deck`; the app ID is `com.kanharithsok.browser-deck`; the display name remains BrowserDeck. User-facing copy now uses **browser** consistently (“Add browser”, “No browsers”, “Browser actions”, browser counts, menus, empty states, and accessibility labels). Internal pane terminology and device-emulation terminology remain where technically accurate. Version is now 1.1.0.

**Identity and migration:** `make start` builds, packages, and launches the real `BrowserDeck.app` with the checked-in icon. `make preview` remains the fast Electron preview. Startup best-effort migrates the old `PaneFlow` user-data directory to `BrowserDeck` and renames legacy `paneflow-profile-*` partition folders. Workspace imports accept the former `paneflow-workspace` format while exports use `browserdeck-workspace`.

**Bug fix:** The empty-state **Add browser** button no longer starts a Canvas pan before opening its menu. The Canvas pointer handler now ignores interactive non-pane controls, so the Add picker opens and creates a browser normally.

**Cleanup:** Removed the obsolete pane-chrome A/B/C preview type, storage key, prop, classes, and unit test; removed the unused profile rename API and per-pane `profileLabel`; removed dead profile-usage styles; deleted the duplicate per-pane-session phase report; renamed the local agent skills to BrowserDeck; updated the repository map, package version, packaging metadata, run instructions, and manual checks.

**Files changed:** `package.json`, `package-lock.json`, `electron-builder.yml`, `Makefile`, `scripts/dev.mjs`, `scripts/start-packaged.mjs`, `build/icon.png`, `src/main/index.ts`, `src/main/browser-manager.ts`, `src/main/profile-store.ts`, `src/main/test-hook.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/index.html`, `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `src/renderer/src/components/PaneNavigation.vue`, `src/renderer/src/minimap.ts`, `src/renderer/src/zoom.ts`, `src/renderer/src/assets/app.css`, `src/renderer/minimap.html`, `src/renderer/zoom.html`, `src/shared/*`, `tests/**`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `QUICKSTART.md`, `AGENTS.md`, `.opencode/commands/*`, `.opencode/skills/*`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-031 superseded, ADR-071 updated, ADR-072/073), `docs/MANUAL_CHECKS.md`, and `docs/PHASE_REPORTS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 176 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 18.6 s, including the empty-state Add browser flow. |
| `npm run build` | Passed: main 158.13 kB, preload 9.31 kB, renderer JS 358.96 kB, shell CSS 31.58 kB. |
| `npm run package:dir` | Passed: BrowserDeck 1.1.0 arm64 app, fuses applied. |
| `npm audit --omit=dev` | Passed: 0 production vulnerabilities. The full developer-tool audit has six moderate `minimatch` advisories in the `electron-builder` chain; they do not ship in the app runtime. |
| Packaged identity | `CFBundleDisplayName`/`CFBundleName` are BrowserDeck; `CFBundleIdentifier=com.kanharithsok.browser-deck`; version `1.1.0`; copyright present; packaged icon matches `build/icon.icns`. Packaged launch reported `Migrated PaneFlow application data to BrowserDeck.` |
| GitHub repository | Renamed to `kanharithsok/browser-deck`; local `origin` updated to `https://github.com/kanharithsok/browser-deck.git`. |
| GitHub release | Published `v1.1.0` with `BrowserDeck-1.1.0-arm64.zip`, `.dmg`, and `SHA256SUMS.txt`. |
| Homebrew cask | Added `kanharithsok/tap/browser-deck`. `brew fetch` verified SHA-256 `a74b6eeb44f773d1019f898b0c5c22f9df6c46f5fffe96eeba7feb646d46a100`; `brew install --cask` installed version 1.1.0 into `/Applications/BrowserDeck.app` with quarantine removed. |

**Known behavior / limitations:** The development runtime still uses Electron’s bundle, so macOS may label that process “Electron” in the Dock; use `make start` for the real BrowserDeck identity. Packaging on `make start` takes longer than the old preview. The app remains an unsigned, arm64-only local build. A small existing browser-workspace product also uses the BrowserDeck name, so a domain/trademark check is still required before public distribution.

## BrowserDeck 1.2.0 — Bulk URL opening and selected-browser controls

**Date:** 2026-11-20

**Status:** Implemented in source; not yet published to Homebrew.

**Change:** Added **Open multiple browsers…** to the Add browser menu and empty state. The dialog accepts one URL per line, validates the whole batch before creation, caps at 50 browsers, and uses the selected browser's viewport (or the last batch viewport) as the default. Each URL creates an independent profile through the existing validated viewport path. Added common selected-browser actions to the top toolbar: a shared viewport menu and Reload selected. Close the selected set with Delete; no close control is shown in the selection toolbar or menu. Both the persistent Select tool and temporary Cmd/Ctrl Select clear the active browser and selection when empty canvas is clicked. Holding Cmd on macOS or Ctrl on Windows/Linux temporarily activates Select while shell chrome has focus, mirroring hold-Space Hand. Phone/tablet panes now translate mouse drags into touch scrolling. The shell also fits or restores the camera before sending a new pane's first bounds, so the first document loads at its fitted viewport instead of a 0×0 or pre-fit size. Added native text-selection coverage to ensure page pointer drags remain browser-native.

**Files changed:** `src/shared/bulk.ts` (new), `src/shared/ipc.ts`, `src/main/browser-manager.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`, `tests/unit/bulk.test.ts` (new), `tests/e2e/browser-panes.spec.ts`, `tests/fixtures/server.cjs`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-056 updated, ADR-074/075), `docs/MANUAL_CHECKS.md`, and `docs/PHASE_REPORTS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 179 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 19.1 s, including native text selection, bulk creation, persistent and temporary selection, empty-canvas clearing, shared viewport changes, touch-drag scrolling, first-document viewport sizing, resize alignment, and cleanup. |
| `npm run build` | Passed: main 158.33 kB, preload 9.32 kB, renderer JS 381.46 kB, shell CSS 35.66 kB. |
| `npm run package:dir` | Passed: BrowserDeck 1.2.0 arm64 app with the final selection and viewport changes; fuses applied and signing skipped as expected. |

**Known behavior / limitations:** Bulk creation is sequential and can take a moment for large batches. The temporary Cmd/Ctrl Select tool is active only while shell chrome has focus; native page content keeps native browser behavior. Phone/tablet mouse-to-touch scrolling is enabled only for mobile viewport behavior, so desktop panes keep native text selection and click-drag interactions. A hidden `WebContentsView` reports a 0×0 viewport, so panes stay visible while a non-emulated page loads; only emulated reloads hide the old surface until emulation is reapplied. Homebrew still installs the published 1.1.0 until a 1.2.0 release and cask update are published. The selected-browser viewport menu normalizes all selected browsers to one preset; it does not preserve mixed viewports.

## Canvas interaction fix — Selecting partially visible panes keeps the camera in place

**Date:** 2026-11-21

**Status:** Implemented.

**Change:** A primary click on a partially visible Canvas pane now selects it in place instead of centering the camera. The pane keeps its snapshot and hidden-browser message until an explicit camera action brings it fully into view. The message now directs the user to pan the canvas or use Fit all. Selecting a pane, its header, or a minimap frame still restores selection; minimap frame focus, device-palette focus, Fit all, and regular panning remain explicit navigation paths. Camera and selection persistence are unchanged. Native views still cannot be clipped to the visible workspace, so a partially visible pane remains non-interactive until it is fully visible.

**Files changed:** `src/renderer/src/App.vue`, `src/renderer/src/components/PaneCard.vue`, `tests/e2e/browser-panes.spec.ts`, `README.md`, `SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR-032/068 status notes, ADR-076 added), and `docs/MANUAL_CHECKS.md`.

| Check | Result |
| --- | --- |
| `make check` | Passed: typecheck, lint, 179 unit tests, and all light/dark contrast pairs. |
| `npm run test:e2e` | Passed: 2 Playwright tests in 21.8 s. New coverage pans a pane partly off-screen, clicks its visible area, verifies it becomes active with unchanged position and zoom, and restores the camera with Fit all. |
| `npm run build` | Passed as part of `npm run test:e2e`: main 158.33 kB, preload 9.32 kB, renderer JS 380.85 kB, shell CSS 35.66 kB. |

**Known behavior / limitations:** Clicking a partially visible pane does not make its page interactive; the user must bring the pane fully into view with Fit all, the overview, Cmd/Ctrl+K, or canvas panning. Panes that are panned mostly off-screen continue to show a snapshot and a hidden-browser message until then.
