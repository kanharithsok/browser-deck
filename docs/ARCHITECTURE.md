# Architecture

> Status: Phase 4 in progress. Native composition, profile sessions, grid/freeform workspace behavior, native-aware scrolling and z-order, maximize/restore, keyboard/menu actions, per-pane viewport emulation, workspace persistence/management, profile management, explicit profile sharing, safe window bounds, theme persistence, unsigned arm64 packaging, repeated-switch leak stress, duplicate pane, and close-and-delete profile lifecycle are implemented and verified. Remaining Phase 4 work covers polish, import/export, and signed/notarized distribution.

## Technology baseline

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 24.22.3 (`.nvmrc` declares 24) |
| Desktop shell | Electron 45.3.4 |
| Window composition | `BaseWindow` |
| Browser panes | `WebContentsView` |
| Renderer | Vue 3.5.45 |
| Language | TypeScript 6.0.3, strict |
| Build tooling | electron-vite 6.0.0, Vite 8.3.8 |
| Packaging | electron-builder 26.18.0, unsigned arm64 DMG/ZIP |
| License | MIT |
| Tests | Vitest 5.1.1, Playwright 1.65.1 (Electron integration) |
| Package manager | npm 11.19.1 with committed `package-lock.json` |

TypeScript 6 is pinned rather than TypeScript 7 because the current `typescript-eslint` release supports `<6.1.0`. Revisit when the lint toolchain supports TypeScript 7.

The Electron main and preload bundles are CommonJS output from electron-vite. The renderer is a normal Vite ESM application. Dependencies are pinned in `package.json`; the lockfile records the resolved tree.

## Source layout

```text
src/
  main/
    index.ts            app lifecycle, BaseWindow, shell view, CSP, menu
    browser-manager.ts  native pane views, navigation, bounds, teardown
    ipc.ts              typed IPC handlers and sender validation
    profile-store.ts    provisional persistent profile registry
    session-policy.ts   partition sessions, permission/download policy
    test-hook.ts        test-only inspection hook (gated)
  preload/
    index.ts            minimal typed bridge for the trusted shell
    index.d.ts          `window.paneflow` declaration
  renderer/
    index.html          shell entry and CSP meta
    src/App.vue         toolbar, workspace grid, bounds measurement
    src/components/PaneCard.vue
    src/assets/app.css  design tokens and base styles
  shared/
    ipc.ts              channel names and IPC payload types
    geometry.ts         bounds validation and clamping
    layout.ts           pure grid/freeform layout engine
    profiles.ts         profile IDs, labels, partition names, validation
    url.ts              address normalization and scheme policy
tests/
  unit/                 Vitest tests for pure modules and profile storage
  e2e/                  Playwright integration test against the built app
  fixtures/             deterministic local HTTP + authentication fixture server
scripts/
  dev.mjs               starts fixtures + electron-vite dev
```

`src/shared` has no Vue or Electron imports. Layout/bounds validation, URL handling, and profile validation remain usable from main, renderer, and unit tests.

## Native view composition

```text
BaseWindow.contentView
┌──────────────────────────────────────────────────────────┐
│ shell WebContentsView  (trusted, bounds = window content) │
│  ┌ toolbar ────────────────────────────────────────────┐  │
│  ┌ pane card A ──────────┐  ┌ pane card B ──────────┐  │
│  │ title / address chrome│  │ title / address chrome│  │
│  │ ┌───────────────────┐ │  │ ┌───────────────────┐ │  │
│  │ │ pane view A       │ │  │ │ pane view B       │ │  │
│  │ │ WebContentsView   │ │  │ │ WebContentsView   │ │  │
│  │ └───────────────────┘ │  │ └───────────────────┘ │  │
│  └───────────────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

The shell is the first child of `contentView` and fills the window content area. Each pane view is added afterwards and occupies only the rectangle of its `.pane-content` placeholder. Pane chrome therefore remains ordinary DOM and is never covered by a native view. Native menus are the only intentional overlay above browser content in the current composition.

Grid mode positions absolutely placed `.pane-slot` elements from `layoutGrid` results. `App.vue` measures the workspace content box, recomputes placements for the selected 1–5 columns, and re-measures native content rectangles after Vue commits the layout. The old CSS auto-fit grid is no longer used. The workspace scrolls to the engine's full content height.

Native views cannot be clipped by DOM overflow. Pane content is shown only when its content rectangle is fully inside the visible workspace viewport. Partially visible or off-screen panes are hidden in the native layer, show a shell message, and have no bounds applied while hidden. On scroll, visible panes get updated native bounds, and the main process re-validates the visibility flag before showing any view.

Grid order is renderer state, independent of the main-process pane snapshot order; add/close operations reconcile it. Dragging a pane title hides all native views for the duration of the drag so pointer events stay in the shell, highlights the drop target, then reorders the ID list and restores views using fresh bounds. Grid order and column selection are persisted with the workspace.

Freeform mode stores per-pane normalized geometry and a separate z-order list. Switching modes preserves the grid order/columns and the freeform geometry independently. Freeform panes have a 6px shell inset around the native content so eight resize handles remain clickable; move/resize updates normalized geometry, hides native views for the interaction, snaps to canvas and neighboring edges, and renders alignment guides in the shell. Panes also expose explicit front/back actions that update both renderer z-order and native child view order through typed IPC.

Maximize is renderer-only temporary state layered over the current grid/freeform arrangement. The maximized pane takes a fixed workspace-inset slot; every other pane keeps its DOM geometry for measurement but is visually hidden, and its native view reports `visible: false`. Restoring clears the state, so the untouched grid/freeform model returns without a separate geometry snapshot.

## Keyboard and menu commands

A native **Pane** menu defines accelerators and sends typed commands to the trusted shell. The renderer tracks an active pane from shell pointer/focus and native pane focus notifications. Commands cover add, close, reload active/all, toggle maximize, and toggle grid/freeform. The shell remains the only frame that receives these events; remote pages have no bridge.

Menu command routing is tested by invoking menu items from the Electron main process; raw key-chord automation remains a follow-up.

## Viewport emulation

`src/shared/viewports.ts` is the pure viewport contract: responsive plus mobile (390 × 844, DPR 3), tablet (820 × 1180, DPR 2), laptop (1280 × 800, DPR 1), and desktop (1440 × 900, DPR 1) presets, custom dimensions/DPR validation, and fit-scale math. Pane state carries the selected viewport. The main process validates every incoming viewport again before applying it.

`BrowserManager.applyEmulation` uses `webContents.enableDeviceEmulation` with:

- `screenPosition: 'desktop'` so the requested `viewSize` remains the exact CSS layout viewport. Mobile positioning caused Chromium's classic 980 px fallback layout on pages without a viewport meta tag, making fixture metrics disagree with the preset.
- `viewSize` equal to the requested width and height, and the requested `deviceScaleFactor`.
- `scale` equal to `min(availableWidth / width, availableHeight / height)` in fit mode, clamped to a safe range, or `1` in actual mode.
- `disableDeviceEmulation()` for responsive panes.

Emulation is applied only after a page has reached `did-stop-loading`. Enabling device emulation on an empty `WebContentsView` before its first navigation segfaulted Electron 45 on macOS. Viewport changes made while a navigation is in flight are retained in the pane record and applied when loading stops.

The emulated surface remains inside the native pane bounds; only its CSS layout and rendering scale are emulated. Fit scales a fixed viewport down (or up) to fit, and actual renders at 1:1. In actual mode, a viewport larger than the pane is clipped at the pane edge; a pane-level pan/scroll mechanism is not implemented yet. Optional user-agent overrides are intentionally not added in this slice, and no UA spoofing is performed.

The renderer exposes presets, fit/actual, and custom width/height/DPR controls in each pane header. Invalid custom values are rejected in the shell and never reach IPC. At narrow container widths the header wraps instead of clipping the address or viewport controls; the five-column e2e layout asserts no horizontal overflow and a usable address width.

`PaneCard` exposes `.pane-content[data-pane-content="<paneId>"]`. `App.vue` observes the workspace with a `ResizeObserver` and re-measures after state changes and window resize notifications. Measurements are coalesced into one `requestAnimationFrame`. The renderer sends absolute rectangles relative to the shell viewport; the shell view starts at `(0, 0)` in the window content, so these coordinates are directly usable as `View.setBounds` DIP coordinates.

The main process re-validates every rectangle in `parsePaneBounds`:

- known pane ID and no duplicates;
- finite, positive dimensions;
- rounded and clamped to the shell canvas;
- minimum pane view size of 80 × 60.

The canvas comes from the shell view's actual bounds, not from a renderer-supplied size. A view is made visible only after valid bounds exist, when the shell reports it fully visible, and when it is not showing `about:blank` or an error panel. Load failures hide the native view so the shell can render a retry panel in place.

Focus stays in the trusted shell: adding a pane moves focus to its address input, and closing a pane recovers focus to an adjacent address control (or the empty-state action). Native pane focus notifications update the renderer's active pane for menu commands, and shell pointer/focus interactions set it back.

## Layout engine

`src/shared/layout.ts` is the pure layout subsystem. It has no Vue or Electron imports and is unit-tested independently of the running app.

Contract:

- All pixel geometry is expressed in CSS pixels/DIP at the renderer boundary. The main process continues to validate native view rectangles separately.
- Grid layout is row-major with equal-width columns, validated 1–5 column counts, configurable padding/gap, and a minimum pane card size. Row height is at least the minimum, so excessive rows report `needsVerticalScroll` instead of silently shrinking or dropping panes. Narrow columns report `columnTooNarrow` for the caller to handle.
- Grid order is the pane ID order. Reorder, add, and remove operations feed a new ordered ID list into `layoutGrid`.
- Freeform geometry can be stored as normalized rectangles and converted to pixels for the current canvas. Conversion clamps to the canvas and enforces a minimum size; when the canvas is smaller than the minimum, the canvas wins.
- Move and edge-resize helpers clamp to canvas bounds. Snapping produces candidate-aligned rectangles and guide coordinates for canvas edges/centers, neighboring pane edges/centers, and optional grid lines within a configurable threshold.
- Ordering helpers treat the end of the list as the topmost/front pane. Maximize returns both the maximized rectangle and the previous rectangle for restore.

The renderer uses grid placements from the engine and a compact 1–5 column selector. The workspace scrolls to the engine's content height; native views are shown only when fully inside the viewport. Freeform mode uses normalized geometry, title-row dragging, eight resize handles, snapping guides, explicit z-order controls, and a Tidy action. Maximize temporarily fills the workspace while hiding other native views. Native menu/keyboard commands cover add, close, reload, maximize, and layout mode.

## Profile manager

The shell exposes a **Profiles** toolbar dialog. Opening it hides all native pane views through the existing validated visibility path so the trusted DOM dialog is not covered; closing it re-measures and restores visible panes. The dialog traps focus, closes on Escape/backdrop/Close, and returns focus to the toolbar action.

The main process supplies labels, creation dates, and pane IDs for each profile. Rename persists metadata and emits a pane-state refresh so live headers show the new label. Clear and delete confirm how many panes use the profile, accept an explicit `closePanes` flag, destroy those panes, verify usage is empty, then clear the session and optionally remove metadata. Clear calls `clearStorageData`, `clearCache`, and `clearAuthCache` on the profile partition. Delete also removes `profiles.json` metadata and best-effort removes `Partitions/paneflow-profile-<id>`. No cookies, tokens, or raw storage are exposed in the dialog or IPC responses.

The profile manager's **Open pane** action explicitly creates a new pane with the selected profile through validated IPC. Those panes share the same persistent partition, cookies, and site storage. Pane headers show a `· N panes` suffix when the profile is shared, and the manager usage line lists the count and pane titles. The toolbar Add pane action still creates a fresh profile. Clearing/deleting an in-use profile requires confirmation and closes all panes that reference it before session data is cleared.

## Browser pane lifecycle

`BrowserManager` owns a `Map<paneId, PaneRecord>` containing the view, profile, URL, title, loading/error state, and visibility state.

Creation:

1. Resolve or create an internal profile record.
2. Create a `WebContentsView` with a `persist:` partition derived from the profile ID.
3. Harden the session before the first load (permissions denied, downloads denied).
4. Add the view to `contentView`, apply background/radius, and keep it hidden until measured.
5. Register navigation, loading, title, failure, crash, redirect, popup, and webview listeners.
6. Defer the first navigation until valid bounds arrive, then load a validated `http:`, `https:`, or `about:blank` URL. This prevents pages from starting at a 0 × 0 viewport.

Destruction:

1. Remove the child view from `contentView`.
2. Remove all `webContents` listeners owned by the manager.
3. Close DevTools and call `webContents.close()`.
4. Delete the pane record and emit a new shell state.
5. On window close, destroy every remaining pane, then close the shell `webContents`.

If a remote page destroys its own `webContents` (for example via `window.close()`), the manager removes that pane record and its stale view instead of leaving controls whose commands would throw. Commands also reject destroyed pane records defensively.

The profile record and its persistent session data are not deleted when a pane closes.

## IPC boundary

The preload exposes `window.paneflow` only to the trusted shell. Channels are explicit; there is no generic send/invoke bridge.

| Channel | Purpose |
| --- | --- |
| `paneflow:get-state` | Current pane snapshots |
| `paneflow:add-pane` | Create a pane with a fresh profile |
| `paneflow:add-pane-with-profile` | Create a pane with an explicitly selected existing profile |
| `paneflow:duplicate-pane` | Duplicate a pane with a fresh profile, URL, and viewport |
| `paneflow:close-pane` | Destroy a pane and its view |
| `paneflow:navigate` | Normalize and load an address |
| `paneflow:back` / `forward` | Pane-specific navigation history |
| `paneflow:reload` / `reload-all` | Reload one or all panes |
| `paneflow:set-pane-bounds` | Validated native view rectangles and visible/hidden state |
| `paneflow:set-pane-viewport` | Validated per-pane viewport preset, custom size, DPR, and display scale |
| `paneflow:save-workspace-layout` | Validated renderer-owned grid/freeform layout state |
| `paneflow:list-profiles` | Profile metadata, creation dates, and live pane usage |
| `paneflow:rename-profile` | Validated profile label update |
| `paneflow:clear-profile` | Clear cookies, storage, cache, and auth cache for an unused profile |
| `paneflow:delete-profile` | Clear and remove an unused profile and its partition data |
| `paneflow:list-workspaces` | Workspace summaries, pane counts, update dates, and active flag |
| `paneflow:export-workspace` | Write a secret-free workspace transfer through a native Save dialog |
| `paneflow:import-workspace` | Validate a transfer file and create a fresh-profile workspace |
| `paneflow:create-workspace` | Create a validated empty workspace |
| `paneflow:rename-workspace` | Rename a validated workspace with unique-name checks |
| `paneflow:duplicate-workspace` | Clone a workspace with fresh profiles and mapped pane IDs |
| `paneflow:switch-workspace` | Persist current panes, tear down views, and restore another workspace |
| `paneflow:delete-workspace` | Delete an inactive, non-final workspace file |
| `paneflow:bring-pane-to-front` | Reorder a native pane view to the top of the stack |
| `paneflow:send-pane-to-back` | Reorder a native pane view to the bottom above the shell |
| `paneflow:pane-command` | Trusted menu/shortcut command for the active pane |
| `paneflow:pane-focused` | Main → shell notification when a native pane gains focus |
| `paneflow:show-pane-menu` | Native pane actions menu |
| `paneflow:state-changed` | Main → shell state snapshots |
| `paneflow:request-measurement` | Main → shell re-measure request |

Every `ipcMain.handle` validates that the sender is the shell `webContents` and that the sender frame is the shell's main frame. Payload types and lengths are checked again in main. The renderer's validation is only a UX convenience.

## Sessions and profiles

`ProfileStore` currently seeds two profile records on first launch so the Phase 0/1 experiment can reuse stable partitions across restarts. Newly created panes receive a new UUID and a new `persist:paneflow-profile-<uuid>` partition. Labels are presentation metadata and never appear in partition names. Records live in `<userData>/profiles.json`, written with a temp-file + flush + rename sequence. Writes are serialized and use a unique temporary name so concurrent saves cannot overwrite a newer snapshot. Invalid files are renamed with a `.corrupt-<timestamp>` suffix and replaced with safe defaults.

The profile manager provides validated rename, clear, and delete lifecycle actions with live-pane usage checks, explicit sharing, and confirmed close-and-delete flows.

PaneFlow is not an identity provider and stores no credentials. Authentication remains owned by each website: the website sets cookies in its profile's Electron session, and the app preserves that session across pane recreation and app restarts. The local fixture demonstrates this with server-issued HttpOnly session cookies for two synthetic accounts, including logout isolation and restart persistence.

Every remote session applies:

- `setPermissionRequestHandler` → deny;
- `setPermissionCheckHandler` → deny;
- `will-download` → prevent;
- pane `setWindowOpenHandler` → deny;
- `will-attach-webview` → prevent.

Remote views use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, no application preload, and their profile partition. `will-navigate` and `will-redirect` enforce the `http:` / `https:` / `about:blank` policy. TLS errors are not ignored.

## Shell security

- The shell loads the Vite dev server in development and the built `index.html` in production. `ELECTRON_RENDERER_URL` is honored only in unpackaged runs and only for a loopback `http(s)` origin; the loaded origin is verified, and cross-origin shell redirects are blocked.
- A restrictive CSP is sent as a response header for the default session and is also present as a meta tag. The current policy allows Vite's local WebSocket in development; production tightening is a Phase 4 item.
- The shell preload is sandboxed, context-isolated, and exposes only the typed pane API.
- Shell navigation and window creation are denied; webview attachment is prevented.
- The shell has no Node integration.

## Persistence

`ProfileStore` owns `profiles.json`. `WorkspaceStore` owns `app-state.json` and `workspaces/<id>.json`:

- `app-state.json` contains the schema version and active workspace ID.
- `workspaces/default.json` contains stable pane IDs, profile references, URLs, viewport settings, layout mode, selected grid columns, grid order, normalized freeform geometry, and freeform z-order.
- Writes serialize through a queue and use a temporary file, `fsync`, and rename. Invalid files are renamed to `.corrupt-<timestamp>` and the app recovers with safe defaults.
- Pane records are created from the stored workspace before the shell loads, so the renderer's first state read sees the restored panes and layout.
- Profile IDs are reused, preserving persistent sessions. If profile metadata is missing but the workspace references a valid ID, `ProfileStore.ensure` reconstructs the record for the same partition.
- The renderer owns layout state and sends normalized updates through `save-workspace-layout`; the main process validates and normalizes pane references. Saves are skipped during active drags and committed after the interaction.
- Maximized/focused state is intentionally not persisted. No cookies, tokens, page contents, or credentials are written to workspace JSON.

`app-state.json` also carries optional normal window bounds and a `system`/`light`/`dark` theme preference. Bounds are validated, saved after debounced move/resize events, and restored only if they intersect a connected display's work area. Maximized/fullscreen state is not persisted. Save snapshots capture the target workspace path at enqueue time so an active-workspace change cannot redirect a queued write.

The native **View → Theme** radio menu updates `nativeTheme.themeSource`, window/shell backgrounds, persistence, and the shell state. Because renderer `prefers-color-scheme` propagation is unreliable for pre-created windows in the tested Electron/Playwright environment, the shell applies an explicit `data-theme` attribute with duplicated light/dark token sets; `system` removes the attribute and follows the media query. Theme preferences are application-wide, not per workspace.

Multiple workspace files can coexist under `workspaces/`. The active workspace ID is persisted in `app-state.json`; names are unique case-insensitively. Deleting the active or final workspace is blocked. Switching first persists current pane definitions/layout, flushes the save queue, activates the target store file, destroys the current native manager/views, creates the target panes, and reapplies the target layout. Test hooks read the current manager rather than a captured initial instance.

Duplicating a workspace creates new pane IDs and fresh profiles, then remaps grid/freeform order and geometry to the new IDs. Deleting a workspace leaves its profiles and partition data intact for independent profile-manager cleanup. Workspace switching reloads pages rather than keeping background panes warm.

Workspace transfer files use a separate versioned `paneflow-workspace` schema containing only workspace name, pane URLs/viewports, and index-based layout. Profile IDs and browser data are stripped. Import enforces a 1 MB file limit and validates the full schema, URLs, viewports, pane-index order, and freeform geometry before generating fresh profiles, pane IDs, a unique imported name, and a mapped workspace. Imported workspaces are inactive and never carry authentication. Native Save/Open dialogs stay in main; transfer/materialization logic is pure and unit-tested.

Shutdown flushes queued writes through `will-quit`.

## Testing

- **Unit:** pure bounds validation, grid/freeform layout, normalized geometry, snapping, ordering, maximize/restore, viewport preset/custom validation and fit math, workspace schema/order/geometry normalization, workspace-store persistence/corruption/validation plus create/rename/switch/delete lifecycle, workspace export/import serialization/profile stripping/fresh-ID materialization, URL normalization/scheme policy, profile ID/partition/label validation, profile-store seeding/restoration/rename/removal, corruption recovery, and atomic persistence.
- **Integration/e2e:** launches the built Electron app against a local fixture server and verifies two isolated profiles, independent form-based authentication with HttpOnly sessions, logout isolation, cookie/localStorage/IndexedDB isolation, popup and permission denial, no remote bridge/Node access, page viewport matching the pane content rectangle, 2/5/1-column grid reflow with native bounds alignment, five-column header wrapping, drag reordering with views hidden during drag, native-aware scrolling with hidden off-screen views, freeform move/resize and mode-switch preservation, temporary maximize/restore, explicit native z-order changes, menu command routing, duplicate pane with fresh profile/URL/viewport, an eight-pane grid/freeform alignment stress pass, per-pane viewport presets/custom dimensions, concurrent different presets in two panes, fit/actual emulation scale, invalid custom recovery, workspace persistence through restart (pane identity, profile, URL, viewport, grid/freeform geometry, columns, window bounds, theme), retained closed-profile cookies, profile-manager usage/rename/clear/delete and explicit close-panes flows, shared-profile panes with shared localStorage and profile deletion, workspace create/switch/rename/duplicate/delete with active-state persistence, repeated workspace switching with baseline webContents/native-view counts, window resize alignment, address/back controls, focus handoff, pane close destroying a `webContents`, fresh profiles for new panes, and authenticated session/cookie/localStorage/profile-ID persistence after a restart.
- **Manual:** Retina viewport (`devicePixelRatio` 2), native menu stacking, visual fit/actual scaling, workspace/profile dialog review, theme menu/token review, workspace restore smoke check, packaged unsigned app launch, and alignment on macOS.

The Playwright test inspects the main process through a test hook that is only installed when `PANEFLOW_TEST=1` and the app is not packaged. Native page targets are also available to Playwright, so real page clicks are used for fixture interactions.

## Packaging

`electron-builder.yml` packages the built `out/` tree with asar enabled. Product metadata is PaneFlow 0.1.0, app ID `com.kanharithsok.paneflow`, developer-tools category, MIT license, and the `build/icon.icns` icon generated from the checked-in SVG source. `npm run package:mac` builds arm64 DMG and ZIP artifacts into `dist/`; `npm run package:dir` produces the unpacked app for faster checks. `dist/` is ignored by Git.

Code signing is intentionally disabled with `identity: null` for the current unsigned local builds. The local machine has only an Apple Development certificate, not a Developer ID Application certificate or notarization credentials. Signed distribution requires installing the Developer ID certificate, configuring notarytool credentials outside the repository, enabling hardened runtime/signing in builder config, and notarizing/stapling both the app and disk image.

## Known architectural gaps

- DOM content cannot be drawn over native browser views. Future contextual UI must use native menus, hide/shift the view, or introduce a separately proven overlay view.
- Native views are not clipped by the shell's scroll containers. Native-aware scrolling works by hiding partially off-screen views; only fully visible panes are interactive.
- An emulated viewport larger than its pane in actual mode is clipped by the native view; pane-level panning of the emulated surface is not implemented.
- Workspace switching tears down and recreates native pane views; pages reload instead of staying warm in the background.
- Leak stress is count-based (webContents/native views) over a short switch loop, not long-duration memory profiling.
- Duplicated workspaces receive fresh profiles immediately, even if the duplicate is never opened.
- Maximized/fullscreen state is not persisted. Window bounds restore only when visible on a current display.
- Overlapping freeform panes can cover each other's shell chrome, including far resize handles; the covering pane must be moved or a reachable control used.
- Profile clear/delete of in-use profiles closes all panes using them after confirmation.
- Profile sharing is initiated only from the profile manager; there is no profile picker in the main Add pane flow.
- Duplicate pane copies URL/viewport and always creates a fresh profile; custom titles and session copying are not supported.
- Native workspace import/export file dialogs are not automated in Playwright; pure transfer/materialization logic is unit-tested.
- Background-warm workspace switching and long-duration memory/CPU profiling with loaded pages are not implemented.
- Partition-directory deletion is best-effort after session data is cleared.
- Vertical grid scrolling is verified at one window size and pane count; more stress and performance measurement remain.
- Grid drag reordering is pointer-only; keyboard reordering remains.
- Freeform mode is pointer-only; menu accelerators are configured but raw keystrokes are not automated.
- Maximize is temporary and intentionally not persisted.
- A fully covered pane can be unreachable until the covering pane moves.
- Keyboard menu commands act on the active pane inferred from shell/native focus; there is no explicit focused-pane outline yet.
- Freeform snapping guides are wired but not asserted by e2e.
- The layout engine's default 160 × 140 card minimum and main's 80 × 60 native view minimum still need to be unified and verified at the minimum window size.
- Window resize alignment converges after one layout frame; an e2e assertion waits for stable alignment.
- Workspace import/export and long-duration profiling remain.
- Remote `http:` destinations are not visually distinguished from HTTPS yet; the URL helper computes the condition but the pane state does not expose it.
- A page that closes its own `webContents` removes the pane cleanly, but the shell does not yet explain why the pane disappeared.
- Electron integration tests require a local macOS GUI session; CI covers typecheck, lint, unit tests, and build only.
- Packaging is arm64-only and unsigned/ad-hoc; Developer ID signing, notarization, stapling, and release automation remain.
- The shell CSP still permits inline styles and local development connections; revisit in the packaging/hardening phase.
