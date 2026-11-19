# Architecture

> Status: Phase 4 complete; the unsigned local macOS MVP is complete. Native composition, profile sessions, Canvas-only workspace behavior with world-space snapping and custom menus, maximize/restore, keyboard/menu actions, per-pane viewport emulation, workspace persistence/management, profile management, explicit profile sharing, safe window bounds, theme persistence, unsigned arm64 packaging, repeated-switch leak stress, duplicate pane, close-and-delete profile lifecycle, workspace import/export, active-pane accessibility, automated accessibility audits, a 50-cycle loaded-page soak, and shell/IPC/session security hardening are implemented and verified. Post-MVP hardening covers the VoiceOver/manual screen-reader pass, longer CPU/memory profiling, Windows/Linux packaging, and signed/notarized distribution once Apple Developer credentials exist.

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
| Tests | Vitest 5.1.1, Playwright 1.65.1 (Electron integration), axe-core 4.11.0 (accessibility audit) |
| Package manager | npm 11.19.1 with committed `package-lock.json` |

TypeScript 6 is pinned rather than TypeScript 7 because the current `typescript-eslint` release supports `<6.1.0`. Revisit when the lint toolchain supports TypeScript 7.

The Electron main and preload bundles are CommonJS output from electron-vite. The renderer is a normal Vite ESM application. Dependencies are pinned in `package.json`; the lockfile records the resolved tree.

## Source layout

```text
src/
  main/
    index.ts            app lifecycle, BaseWindow, shell view, menu
    browser-manager.ts  native pane views, navigation, bounds, teardown
    ipc.ts              typed IPC handlers and sender validation
    profile-store.ts    persistent profile registry
    session-policy.ts   hardened partition sessions, permission/device policy
    shell-assets.ts     custom-protocol path and MIME validation
    shell-protocol.ts   secure `paneflow://shell/` asset handler
    test-hook.ts        test-only inspection hook (gated)
  preload/
    index.ts            minimal typed bridge for the trusted shell
    index.d.ts          `window.paneflow` declaration
  renderer/
    index.html          shell entry
    minimap.html        trusted Canvas overview entry
    src/App.vue         toolbar, workspace, bounds measurement
    src/components/PaneCard.vue
    src/components/PaneNavigation.vue
    src/components/GlobalPaneBar.vue
    src/minimap.ts      Canvas overview rendering and actions
    src/minimap.css     compact overview panel styles
    src/assets/app.css  design tokens and base styles
  shared/
    ipc.ts              channel names and IPC payload types
    geometry.ts         bounds validation and clamping
    canvas.ts           infinite-canvas frame sizing and row arrangement
    layout.ts           legacy grid/freeform helpers and general geometry
    minimap.ts          projects pane frames and the viewport into an overview map
    pane-chrome.ts      temporary pane-chrome preview types and labels
    profiles.ts         profile IDs, labels, partition names, validation
    shell.ts            shell URL constants, CSP builder, trusted document check
    url.ts              address normalization and scheme policy
tests/
  unit/                 Vitest tests for pure modules and profile storage
  e2e/                  Playwright Electron integration and accessibility audits
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
│                          ┌ overview WebContentsView ─┐  │
│                          │ bottom-right, Canvas only │  │
│                          └───────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

The shell is the first child of `contentView` and fills the window content area. Each pane view is added afterwards and occupies only the rectangle of its `.pane-content` placeholder. Pane chrome therefore remains ordinary DOM and is never covered by a native view. In Canvas a small trusted overview `WebContentsView` is raised above the pane stack at the bottom-right; it is the only persistent native overlay above browser content. Canvas **+** and right-click menus are shell DOM, so any native pane whose content intersects the open menu is hidden and its snapshot remains; uncovered panes stay live. Native menus remain for pane actions and app-level commands.

On macOS the window uses `titleBarStyle: 'hiddenInset'` with the traffic lights at `(16, 16)`. The shell fills the full window bounds, the toolbar is the window drag region, and interactive toolbar controls opt out with `-webkit-app-region: no-drag`. The toolbar reserves 84 px at the leading edge for traffic lights. Other platforms keep the default native frame.

Canvas positions absolutely placed `.pane-slot` elements from world coordinates plus the current pan and zoom. `App.vue` measures the workspace content box and re-measures native content rectangles after Vue commits the layout. Empty-canvas drag and Hand mode pan the world; pane header drags update only that pane's persisted world position. While a pane is dragged, other panes' edges and centers produce snap candidates and shell-rendered alignment guides. The snap threshold is eight screen pixels divided by the current zoom. Native views are hidden for the duration of a pane drag so guides and snapshots remain visible.

Native views cannot be clipped by DOM overflow. Pane content is shown only when its content rectangle is fully inside the visible workspace viewport and outside an open Canvas menu. Partially visible or off-screen panes are hidden in the native layer, show a shell message or snapshot, and have no new bounds applied while hidden. The main process re-validates the visibility flag before showing any view.

Canvas pane order is renderer state, independent of the main-process pane snapshot order; add/close operations reconcile it. Dragging empty canvas briefly replaces pages with snapshots and restores fully visible native views afterward.

Maximize is renderer-only temporary state layered over the current Canvas arrangement. The maximized pane takes a fixed workspace-inset slot; every other pane keeps its world geometry for measurement but is visually hidden, and its native view reports `visible: false`. Restoring clears the state, so the untouched Canvas model returns without a separate geometry snapshot. Legacy grid/freeform fields remain in the persistence schema only for migration.

## Keyboard and menu commands

A native **Pane** menu defines accelerators and sends typed commands to the trusted shell. The renderer tracks an active pane from shell pointer/focus and native pane focus notifications; the active card gets a subtle accent outline and `aria-current="true"`. Commands cover add, duplicate, close, reload active/all, and toggle maximize. The shell remains the only frame that receives these events; remote pages have no bridge. Canvas add/context menus are custom shell components, not native menus, so they can match the app's visual language; their actions call the same validated IPC and renderer operations.

Menu command routing is tested by invoking menu items from the Electron main process; raw key-chord automation remains a follow-up.

## Accessibility

The shell exposes one level-1 heading (`PaneFlow`), a banner toolbar, and a named `Browser workspace` main landmark. Pane cards are named articles (`Browser pane: <title>`) with per-pane address, viewport, scale, navigation, maximize, menu, and close controls. Icon-only controls have names and tooltips. Dialog triggers expose `aria-haspopup="dialog"`, `aria-expanded`, and a workspace-aware name.

Profile and workspace dialogs use `role="dialog"`, `aria-modal`, `aria-labelledby`, and `aria-describedby`, focus the dialog container on open, trap Tab/Shift+Tab within the dialog, close on Escape, and return focus to the trigger. Repeated row actions include the profile or workspace label in their accessible names (`Delete profile QA`, `Switch to workspace QA`) so button-list navigation remains distinguishable. Focus-visible styling uses the shared `--focus` token; the dialog container draws the same ring when opened from the keyboard. Dialog header wrappers are plain `div`s so they do not create a second `banner` landmark.

`tests/e2e/accessibility.spec.ts` automates the trusted shell and both dialogs with Playwright roles/names, tab-order and focus-visible assertions, focus-trap/focus-return checks, Chromium's CDP `Accessibility.getFullAXTree`, and axe-core. Axe is evaluated through CDP `Runtime.evaluate` because the shell CSP deliberately blocks inline script injection; the production CSP is unchanged. The axe run covers WCAG 2.0/2.1/2.2 A/AA and best-practice rules. This is regression coverage, not a substitute for a VoiceOver pass: axe and the CDP tree cannot verify spoken order, live-region timing, or whether a focus indicator is practically usable.

## Viewport emulation

`src/shared/viewports.ts` is the pure viewport contract: responsive plus mobile (390 × 844, DPR 3), tablet (820 × 1180, DPR 2), laptop (1280 × 800, DPR 1), and desktop (1440 × 900, DPR 1) presets, custom dimensions/DPR validation, and fit-scale math. Pane state carries the selected viewport. The main process validates every incoming viewport again before applying it.

`BrowserManager.applyEmulation` uses `webContents.enableDeviceEmulation` with:

- `screenPosition: 'desktop'` so the requested `viewSize` remains the exact CSS layout viewport. Mobile positioning caused Chromium's classic 980 px fallback layout on pages without a viewport meta tag, making fixture metrics disagree with the preset.
- `viewSize` equal to the requested width and height, and the requested `deviceScaleFactor`.
- `scale` equal to `min(availableWidth / width, availableHeight / height)`, clamped to a safe range, so fixed viewports always fit the pane content.
- `disableDeviceEmulation()` for responsive panes.

Emulation is applied only after a page has reached `did-stop-loading`. Enabling device emulation on an empty `WebContentsView` before its first navigation segfaulted Electron 45 on macOS. Viewport changes made while a navigation is in flight are retained in the pane record and applied when loading stops.

The emulated surface remains inside the native pane bounds; only its CSS layout and rendering scale are emulated. Fixed viewports always scale to fit, and the scale is recomputed from the current native bounds whenever the pane frame, window, aspect, or maximize state changes. Responsive panes use the pane content size directly. Optional user-agent overrides are intentionally not added in this slice, and no UA spoofing is performed.

The renderer exposes preset and custom width/height/DPR controls through the shared pane navigation component in the top toolbar. Invalid custom values are rejected in the shell and never reach IPC. The selector groups phone, tablet, and desktop presets. Choosing Custom replaces the address row with an inline width/height/DPR editor in the same 42 px toolbar; Apply or Cancel returns to the address without changing the toolbar height.

The toolbar **+** control opens a custom in-shell device menu built from the shared preset catalog. Selecting a device calls `paneflow:add-pane-with-viewport`; main validates the viewport, creates a fresh profile, and creates the pane with that viewport. The menu is grouped into Phones, Tablets, and Desktop and shows CSS dimensions as muted metadata. Right-clicking empty Canvas opens a second custom menu with Add pane, Fit all panes, Reset zoom, Hand tool, Profiles, Workspaces, and Appearance.

The bottom canvas bar's appearance control opens the in-shell System/Light/Dark menu; the custom Canvas menu exposes the same three choices through a validated `paneflow:set-theme` call, and the native View menu remains available. Main keeps `nativeTheme.themeSource`, persisted preference, native chrome, and the shell's resolved `data-theme` synchronized. Each pane's webContents receives the resolved `prefers-color-scheme` through the debugger's `Emulation.setEmulatedMedia`, so loaded websites react without a reload. Workspace and profile management are native menu items that send shell commands to open the existing dialogs.

Canvas layout uses world-coordinate pane positions plus a viewport pan offset and zoom. The shell draws a radial-gradient dot field whose background position follows the pan. Dragging empty canvas, wheel panning, or using the Hand tool updates only the shell transform until the gesture ends; native views are hidden for the duration. Holding Space temporarily enables the Hand tool. While Hand is active, the wheel zooms around the cursor between 25% and 200%. Canvas zoom is a uniform pane scale: the slot is sized to the declared world frame times the zoom, the pane header is laid out at its world width and CSS-scaled by the zoom, and the page keeps its declared CSS viewport while main applies the matching device-emulation scale. Pane header chrome, page content, positions, and snapshots therefore scale together, without reflowing the page. Dragging a pane header updates that pane's world position and snaps to neighboring edges/centers with live guides. Pane headers keep their maximize, actions, and close controls at every zoom; the profile is hidden first when the header narrows. A primary click on empty canvas without movement clears the active pane; selecting a pane, its header, or a minimap frame restores it. The top toolbar remains mounted with a quiet empty state, so selection changes never move or resize the workspace. Main captures JPEG page snapshots through `capturePaneSnapshots`; the shell displays those images while panning, for partially off-screen panes, and under open menus. On release, the validated bounds path restores native views for frames fully inside the workspace and not covered by a menu. Canvas positions are persisted in workspace layout; pan, zoom, and cleared selection are viewport state. The shell fits every workspace on first appearance and after a workspace switch, with a short ready/retry loop until the workspace has non-zero size.

The Canvas overview is a separate trusted `WebContentsView` because a DOM minimap would be covered by native pane views. It is pinned to the bottom-right, sized between 168 and 208 px wide as the window changes, and raised above the pane stack whenever Canvas is active. The panel can collapse to its header. `src/shared/minimap.ts` projects all pane frames and the current viewport into the map, including the viewport bounds so panes remain findable after panning far away; it also owns the adaptive panel size. The shell sends validated projection state through `paneflow:update-canvas-minimap`; main relays it to the minimap view. Selecting a frame centers and focuses that pane, selecting the map background centers that world point, and the header's fit control or the top toolbar runs Fit all. Minimap actions are validated in main and relayed to the shell, which then regains focus. Covered native views are never hidden for the minimap, so pages stay live outside its corner. The minimap hides while a shell dialog or a non-zoom/non-appearance custom menu is open and returns afterward.

The bottom-center canvas bar is a second trusted `WebContentsView` rendered from `zoom.html`. It is 280 × 40 DIP with a 12 px bottom margin and sits above the pane stack and the minimap. It contains Hand, zoom-out, a percentage button, zoom-in, and appearance. `src/shared/zoom.ts` owns the 25–200% range, 10% step, presets, bar dimensions, state/action validation, and the hand/theme state carried to the bar. The shell sends zoom changes through `paneflow:set-canvas-zoom` and hand changes through `paneflow:set-canvas-hand-mode`; main forwards the current zoom, resolved theme, theme preference, and hand state to the bar through `paneflow:canvas-zoom-state`. The bar's Hand, step, preset, Fit all, Reset, and appearance actions travel through `paneflow:canvas-zoom-action` to the shell, which applies zoom around the workspace center, toggles Hand, or opens the appearance menu. Main validates that sender against the built `paneflow://shell/zoom.html` document (or the validated development origin) before relaying anything. The percentage and appearance buttons ask the shell to open its standard `AppMenu` above the bar; unlike other menus, these keep the bar and minimap visible because they do not overlap them. Using a bar or minimap action closes the menu first. The zoom menu offers 25%, 50%, 75%, 100%, 125%, 150%, 200%, Fit all, and Reset (100%).

`PaneCard` exposes `.pane-content[data-pane-content="<paneId>"]`. `App.vue` observes the workspace with a `ResizeObserver` and re-measures after state changes and window resize notifications. Measurements are coalesced into one `requestAnimationFrame`. The renderer sends absolute rectangles relative to the shell viewport; the shell view starts at `(0, 0)` in the window content, so these coordinates are directly usable as `View.setBounds` DIP coordinates.

The main process re-validates every rectangle in `parsePaneBounds`:

- known pane ID and no duplicates;
- finite, positive dimensions;
- rounded and clamped to the shell canvas;
- minimum pane view size of 80 × 60.

The canvas comes from the shell view's actual bounds, not from a renderer-supplied size. A view is made visible only after valid bounds exist, when the shell reports it fully visible, and when it is not showing `about:blank` or an error panel. Load failures hide the native view so the shell can render a retry panel in place.

Focus stays in the trusted shell: adding a pane moves focus to its address input, and closing a pane recovers focus to an adjacent address control (or the empty-state action). Native pane focus notifications update the renderer's active pane for menu commands, and shell pointer/focus interactions set it back.

## Layout engine

`src/shared/canvas.ts` is the primary pure Canvas layout subsystem. It has no Vue or Electron imports and is unit-tested independently of the running app. `src/shared/layout.ts` retains legacy grid/freeform and general geometry helpers so older workspaces and pure tests remain valid, but those modes are no longer selectable.

Contract:

- All pixel geometry is expressed in CSS pixels/DIP at the renderer boundary. The main process continues to validate native view rectangles separately.
- Canvas frame sizes derive from viewport presets and include the compact pane header; missing positions use a deterministic row arrangement.
- Pane world positions are finite and bounded. Snapping checks the dragged frame's leading/center/trailing edges against neighboring frames on each axis and returns guide coordinates plus snapped positions.
- The snap threshold is expressed in world units; the renderer divides the screen threshold by canvas zoom.
- Ordering helpers treat the end of the list as the topmost/front pane. Maximize returns both the maximized rectangle and the previous rectangle for restore.
- Legacy grid/freeform normalization and geometry helpers remain for migration and historical tests only.

The renderer uses Canvas positions, the native overview, and the top toolbar's active-pane controls. Native views are shown only when fully inside the viewport and outside an open menu. Maximize temporarily fills the workspace while hiding other native views. Native menu/keyboard commands cover add, close, reload, and maximize.

## Profile manager

The shell exposes a **Profiles** toolbar dialog. Opening it hides all native pane views through the existing validated visibility path so the trusted DOM dialog is not covered; closing it re-measures and restores visible panes. The dialog traps focus, closes on Escape/backdrop/Close, and returns focus to the toolbar action.

The main process supplies labels, creation dates, and pane IDs for each profile. Rename persists metadata and emits a pane-state refresh so live headers show the new label. Clear and delete confirm how many panes use the profile, accept an explicit `closePanes` flag, destroy those panes, verify usage is empty, then clear the session and optionally remove metadata. Clear calls `clearStorageData`, `clearCache`, and `clearAuthCache` on the profile partition. Delete also removes `profiles.json` metadata and best-effort removes `Partitions/paneflow-profile-<id>`. No cookies, tokens, or raw storage are exposed in the dialog or IPC responses.

The profile manager's **Open pane** action explicitly creates a new pane with the selected profile through validated IPC. Those panes share the same persistent partition, cookies, and site storage. Pane headers show a `· N panes` suffix when the profile is shared, and the manager usage line lists the count and pane titles. The toolbar Add pane control, including its device-size menu, still creates a fresh profile. Clearing/deleting an in-use profile requires confirmation and closes all panes that reference it before session data is cleared.

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
| `paneflow:set-pane-viewport` | Validated per-pane viewport preset, custom size, and DPR |
| `paneflow:add-pane-with-viewport` | Validated viewport plus a fresh profile for a new pane |
| `paneflow:set-theme` | Validated System/Light/Dark preference from the custom Canvas or bottom-bar appearance menu |
| `paneflow:capture-pane-snapshots` | In-memory JPEG snapshots for canvas panning and partially visible panes |
| `paneflow:update-canvas-minimap` | Validated shell → main Canvas projection state |
| `paneflow:set-canvas-minimap-visible` | Show or hide the native overview in Canvas mode |
| `paneflow:canvas-minimap-state` | Main → minimap projection state |
| `paneflow:canvas-minimap-action` | Validated minimap → main focus, recenter, fit, or collapse action |
| `paneflow:canvas-minimap-action-requested` | Main → shell minimap action request |
| `paneflow:save-workspace-layout` | Validated renderer-owned Canvas layout state |
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

Every `ipcMain.handle` validates that the sender is the shell `webContents`, that the sender frame is the shell's main frame, and that the frame document is the built `paneflow://shell/index.html` entry or the validated loopback development origin. The minimap action channel instead requires the dedicated minimap `webContents`, its main frame, and the trusted `minimap.html` document. Payload types and lengths are checked again in main. The renderer's validation is only a UX convenience. Unauthorized state reads receive an empty default state rather than workspace metadata.

## Sessions and profiles

`ProfileStore` currently seeds two profile records on first launch so the Phase 0/1 experiment can reuse stable partitions across restarts. Newly created panes receive a new UUID and a new `persist:paneflow-profile-<uuid>` partition. Labels are presentation metadata and never appear in partition names. Records live in `<userData>/profiles.json`, written with a temp-file + flush + rename sequence. Writes are serialized and use a unique temporary name so concurrent saves cannot overwrite a newer snapshot. Invalid files are renamed with a `.corrupt-<timestamp>` suffix and replaced with safe defaults.

The profile manager provides validated rename, clear, and delete lifecycle actions with live-pane usage checks, explicit sharing, and confirmed close-and-delete flows.

PaneFlow is not an identity provider and stores no credentials. Authentication remains owned by each website: the website sets cookies in its profile's Electron session, and the app preserves that session across pane recreation and app restarts. The local fixture demonstrates this with server-issued HttpOnly session cookies for two synthetic accounts, including logout isolation and restart persistence.

Every remote session applies:

- `setPermissionRequestHandler` → deny;
- `setPermissionCheckHandler` → deny;
- `setDisplayMediaRequestHandler` → deny (null stream);
- `setDevicePermissionHandler` → deny HID/serial/USB;
- `setBluetoothPairingHandler` → reject pairing;
- `will-download` → prevent;
- pane `setWindowOpenHandler` → deny;
- `will-attach-webview` → prevent.

The trusted shell's default session receives the same deny-by-default policy. Remote views use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, no application preload, and their profile partition. `will-navigate` and `will-redirect` enforce the `http:` / `https:` / `about:blank` policy. URLs with embedded credentials or more than 2,048 characters are rejected so they cannot enter workspace state. TLS errors are not ignored.

## Shell security

- The shell loads the Vite dev server in development and `paneflow://shell/index.html` in production. `ELECTRON_RENDERER_URL` is honored only in unpackaged runs and only for a loopback `http(s)` origin; the loaded origin is verified, and cross-origin shell redirects are blocked.
- The production shell uses a privileged, standard, secure custom protocol instead of broad `file://`. Its handler serves only files under the built renderer root, rejects parent/backslash/null-byte traversal and malformed encodings, sets explicit MIME types, and adds `nosniff`, no-referrer, and no-store headers.
- CSP is enforced as a response header in both modes; there is no static meta-tag fallback. `buildShellCsp` emits `connect-src 'self'` in production and adds only the exact development origin plus its WebSocket in development. Inline script and eval are not allowed. Inline styles remain allowed because Vue writes pane geometry through inline style attributes.
- The shell preload is sandboxed, context-isolated, and exposes only the typed pane API.
- Shell navigation and window creation are denied; webview attachment is prevented. A global `web-contents-created` handler also denies window creation and webview attachment for future views.
- The shell has no Node integration, no subframe/worker Node integration, and no `webviewTag`.

## Persistence

`ProfileStore` owns `profiles.json`. `WorkspaceStore` owns `app-state.json` and `workspaces/<id>.json`:

- `app-state.json` contains the schema version and active workspace ID.
- `workspaces/default.json` contains stable pane IDs, profile references, URLs, viewport settings, a Canvas layout marker, pane order, and world-coordinate canvas positions. Legacy grid/freeform fields may remain so older files can be read and migrated.
- Writes serialize through a queue and use a temporary file, `fsync`, and rename. Invalid files are renamed to `.corrupt-<timestamp>` and the app recovers with safe defaults.
- Pane records are created from the stored workspace before the shell loads, so the renderer's first state read sees the restored panes and layout.
- Profile IDs are reused, preserving persistent sessions. If profile metadata is missing but the workspace references a valid ID, `ProfileStore.ensure` reconstructs the record for the same partition.
- The renderer owns Canvas layout state and sends normalized updates through `save-workspace-layout`; the main process validates and normalizes pane references and migrates legacy modes to Canvas. Saves are skipped during active drags and committed after the interaction.
- Pane maximize remains temporary renderer state; application-window maximized/full-screen state is persisted in `app-state.json`. No cookies, tokens, page contents, or credentials are written to workspace JSON.

`app-state.json` also carries optional normal window bounds, `maximized`/`fullScreen` flags, and a `system`/`light`/`dark` theme preference. Bounds are validated, saved after debounced move/resize/maximize/fullscreen events and before close, and restored only if they intersect a connected display's work area. Maximized/full-screen presentation restores only when those safe bounds are available; minimized and focused state are not persisted. Save snapshots capture the target workspace path at enqueue time so an active-workspace change cannot redirect a queued write.

The bottom canvas bar appearance menu and native **View → Theme** radio menu update `nativeTheme.themeSource`, window/shell backgrounds, persistence, and shell state. Main sends a resolved `light`/`dark` value and the shell always applies an explicit `data-theme`; System mode therefore stays synchronized with native chrome even though renderer `prefers-color-scheme` propagation is unreliable in the tested Electron/Playwright environment. Pane webContents receive the same resolved scheme through CDP media emulation on creation, navigation, and every appearance change. Theme preferences are application-wide, not per workspace.

Multiple workspace files can coexist under `workspaces/`. The active workspace ID is persisted in `app-state.json`; names are unique case-insensitively. Deleting the active or final workspace is blocked. Switching first persists current pane definitions/layout, flushes the save queue, activates the target store file, destroys the current native manager/views, creates the target panes, and reapplies the target layout. Test hooks read the current manager rather than a captured initial instance.

Duplicating a workspace creates new pane IDs and fresh profiles, then remaps Canvas positions and legacy order/geometry fields to the new IDs. Deleting a workspace leaves its profiles and partition data intact for independent profile-manager cleanup. Workspace switching reloads pages rather than keeping background panes warm.

Workspace transfer files use a separate versioned `paneflow-workspace` schema containing only workspace name, pane URLs/viewports, and index-based layout. Profile IDs and browser data are stripped. Export includes pane URLs, including query strings, so users must not store secret-bearing URLs in panes they export. Import verifies the selected path is a regular file, enforces a 1 MB limit, and validates the full schema, URLs (including credential and length rejection), viewports, pane-index order, and legacy geometry before generating fresh profiles, pane IDs, a unique imported name, and a mapped Canvas workspace. Imported workspaces are inactive and never carry authentication. Native Save/Open dialogs stay in main; transfer/materialization logic is pure and unit-tested.

Shutdown flushes queued writes through `will-quit`.

## Testing

- **Unit:** pure bounds validation, Canvas frame sizing/default placement/snapping, minimap projection/adaptive sizing, legacy grid/freeform normalization, viewport preset/custom validation and fit math, workspace schema/order/geometry normalization, workspace-store persistence/corruption/validation plus create/rename/switch/delete lifecycle, workspace export/import serialization/profile stripping/fresh-ID materialization, CSP construction and trusted shell-document matching, shell asset path/MIME validation, URL normalization/scheme/credential/length policy, profile ID/partition/directory/label validation, profile-store seeding/restoration/rename/removal, corruption recovery, and atomic persistence.
- **Integration/e2e:** launches the built Electron app against a local fixture server and verifies the internal shell protocol, CSP inline-script/cross-origin-fetch blocking, invalid-sender IPC rejection from a separate node-enabled webContents, blocked remote `file:`/`data:` navigation, two isolated profiles, independent form-based authentication with HttpOnly sessions, logout isolation, cookie/localStorage/IndexedDB isolation, popup and permission denial, no remote bridge/Node access, Canvas-only startup with all panes fitted, a single-row top toolbar that embeds active-pane navigation/address/viewport controls and keeps only Fit all/Reload/Add on the right, native Workspace and Profiles menu commands, a bottom canvas bar with Hand, zoom step/presets, and appearance, zoom-menu retention of the bar and minimap, whole-pane uniform zoom with the declared page viewport unchanged, empty-canvas deselection with a stable workspace rectangle, pane actions remaining visible when pane widths straddle the old 340 px breakpoint at 80% zoom, borderless top-right toolbar controls, pane-header dragging with world-space snapping guides, custom **+** device menu creation and Escape dismissal, right-click canvas menu Add pane/Hand/Appearance actions, native-view hiding only under menus, temporary maximize/restore, menu command routing, duplicate pane with fresh profile/URL/viewport, per-pane viewport presets/custom dimensions, concurrent different presets in two panes, responsive emulation under canvas zoom, pane creation from a selected device preset, invalid custom recovery, workspace persistence through restart (pane identity, profile, URL, viewport, Canvas position, window bounds, theme), retained closed-profile cookies, profile-manager usage/rename/clear/delete and explicit close-panes flows, shared-profile panes with shared localStorage and profile deletion, workspace create/switch/rename/duplicate/delete with active-state persistence, repeated workspace switching with configurable soak cycles, baseline webContents/native-view counts and working-set sampling, window resize alignment, address/back controls, focus handoff, active-pane outline/`aria-current`, live pane `prefers-color-scheme` changes, Canvas panning with snapshots and Hand-tool hiding of native views, pane close destroying a `webContents`, fresh profiles for new panes, and authenticated session/cookie/localStorage/profile-ID persistence after a restart.
- **Accessibility:** `tests/e2e/accessibility.spec.ts` verifies toolbar/pane/dialog roles and accessible names, named dialog triggers and expanded state, 2 px focus-visible outlines, forward/reverse tab order, active-pane `aria-current`, dialog focus traps and focus return, and unique contextual row-action names. It reads Chromium's CDP accessibility tree and runs axe-core with WCAG 2.0/2.1/2.2 A/AA plus best-practice tags against the shell and both dialogs. Axe is injected with CDP `Runtime.evaluate` rather than an inline script because the shell CSP blocks the latter.
- **Contrast:** `npm run check:contrast` computes WCAG ratios for text, muted/faint, accent, focus, and danger token pairs in explicit light/dark themes.
- **Manual:** Retina viewport (`devicePixelRatio` 2), native menu stacking, visual always-fit scaling, custom menu light/dark visual review, VoiceOver/screen-reader order and announcements, workspace/profile dialog visual review, theme menu/token review, workspace restore smoke check, packaged unsigned app launch, and alignment on macOS.

The Playwright tests inspect the main process through a test hook that is only installed when `PANEFLOW_TEST=1` and the app is not packaged. Native page targets are also available to Playwright, so real page clicks are used for fixture interactions.

## Packaging

`electron-builder.yml` packages the built `out/` tree with asar enabled. Product metadata is PaneFlow 0.1.0, app ID `com.kanharithsok.paneflow`, developer-tools category, MIT license, and the `build/icon.icns` icon generated from the checked-in SVG source. `npm run package:mac` builds arm64 DMG and ZIP artifacts into `dist/`; `npm run package:dir` produces the unpacked app for faster checks. `dist/` is ignored by Git.

Electron fuses are applied after packing and before the (skipped) signing step: `RunAsNode` disabled, Node options and inspector arguments disabled, embedded ASAR integrity validation enabled, only-load-from-ASAR enabled, `file://` extra privileges disabled, and the ad-hoc Darwin signature reset. The shell custom protocol plus these fuses avoid the former broad `file://` shell transport. Fuse state is read back with `npx electron-fuses read --app dist/mac-arm64/PaneFlow.app`.

Code signing is intentionally disabled with `identity: null` for the current unsigned local builds. The local machine has only an Apple Development certificate, not a Developer ID Application certificate or notarization credentials. Signed distribution requires installing the Developer ID certificate, configuring notarytool credentials outside the repository, enabling hardened runtime/signing in builder config, and notarizing/stapling both the app and disk image. Cookie encryption at rest is not enabled for these ad-hoc builds; see `SECURITY.md`.

## Known architectural gaps

- DOM content cannot be drawn over native browser views. Custom Canvas menus hide only intersecting native panes and show their snapshots; future contextual UI must use the same hiding strategy, a native menu, or a separately proven overlay view.
- Native views are not clipped by the shell's scroll containers. Canvas and menu visibility work by hiding intersecting or partially off-screen views; only fully visible, uncovered panes are interactive.
- Fixed viewports always fit the pane and can letterbox when the emulated aspect ratio differs from the pane; there is no fill/crop display mode.
- Workspace switching tears down and recreates native pane views; pages reload instead of staying warm in the background.
- Leak stress is count-based (webContents/native views) over a 50-cycle switch loop, not long-duration memory profiling; memory is sampled before/after rather than peak/per-process, and observed 50-cycle growth ranged from 0 MB in one run to ~95 MB on final `main`.
- Duplicated workspaces receive fresh profiles immediately, even if the duplicate is never opened.
- Normal window bounds and maximized/full-screen state restore only when the saved normal bounds still intersect a current display.
- Overlapping Canvas panes can cover each other's headers; use the overview or Fit all to locate and recover them.
- Profile clear/delete of in-use profiles closes all panes using them after confirmation.
- Profile sharing is initiated only from the profile manager; there is no profile picker in the main Add pane flow.
- Duplicate pane copies URL/viewport/custom title and always creates a fresh profile; session copying is not supported.
- Native workspace import/export file dialogs are not automated in Playwright; pure transfer/materialization logic is unit-tested.
- Background-warm workspace switching and long-duration memory/CPU profiling with loaded pages are not implemented.
- Partition-directory deletion is best-effort after session data is cleared.
- Canvas stress is count-based at one window size and pane count; more performance measurement remains.
- Pane movement is pointer-only; keyboard movement remains.
- Maximize is temporary and intentionally not persisted.
- A fully covered pane can be unreachable until the covering pane moves or Fit all is used.
- Keyboard menu commands act on the active pane; the active card is outlined and marked with `aria-current`. Dialog triggers expose `aria-haspopup`/`aria-expanded`, and the toolbar collapses secondary labels at narrow widths. Automated axe/role/AX checks cover the shell and dialogs, but a VoiceOver/screen-reader pass and practical focus-visibility review remain manual.
- Canvas snapping guides are asserted by e2e at the default zoom; extreme zoom and high pane counts remain manual.
- The legacy layout engine's 160 × 140 card minimum and main's 80 × 60 native view minimum still need to be unified and verified at the minimum window size.
- Window resize alignment converges after one layout frame; an e2e assertion waits for stable alignment.
- Long-duration, third-party-page CPU/memory profiling remains.
- Remote `http:` destinations are not visually distinguished from HTTPS yet; the URL helper computes the condition but the pane state does not expose it.
- A page that closes its own `webContents` removes the pane cleanly, but the shell does not yet explain why the pane disappeared.
- Electron integration tests require a local macOS GUI session; CI covers typecheck, lint, contrast, unit tests, and build only.
- Packaging is arm64-only and unsigned/ad-hoc; Developer ID signing, notarization, stapling, cookie encryption at rest, and release automation remain.
- The shell CSP permits inline styles for Vue geometry bindings. Inline script and eval remain blocked.
- Local profile data is protected by OS account permissions, not application-level encryption in this unsigned build.
- Development CSP intentionally adds the loopback Vite origin/WebSocket; production has no such allowance.
