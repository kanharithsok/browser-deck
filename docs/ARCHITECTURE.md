# Architecture

> Status: BrowserDeck 1.1.0 is the unsigned local macOS release. Native composition, profile sessions, Canvas-only workspace behavior with world-space snapping, anchored duplicate placement, explicit arrangements, custom menus, keyboard/menu actions, two-row browser headers with per-pane address and viewport controls, per-pane viewport emulation, workspace persistence/management, internal per-pane sessions released on close, safe window bounds, theme persistence, unsigned arm64 packaging, repeated-switch leak stress, duplicate pane, workspace import/export, active-pane accessibility, automated accessibility audits, a 50-cycle loaded-page soak, and shell/IPC/session security hardening are implemented and verified. Post-1.0 hardening covers the VoiceOver/manual screen-reader pass, longer CPU/memory profiling, Windows/Linux packaging, and signed/notarized distribution once Apple Developer credentials exist.

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
    shell-protocol.ts   secure `browserdeck://shell/` asset handler
    test-hook.ts        test-only inspection hook (gated)
  preload/
    index.ts            minimal typed bridge for the trusted shell
    index.d.ts          `window.browserdeck` declaration
  renderer/
    index.html          shell entry
    minimap.html        trusted Canvas overview entry
    zoom.html           trusted bottom Canvas bar entry
    src/App.vue         toolbar, workspace, bounds measurement
    src/components/AppMenu.vue
    src/components/MenuIcon.vue
    src/components/PaneCard.vue
    src/components/PaneNavigation.vue
    src/minimap.ts      Canvas overview rendering and actions
    src/minimap.css     compact overview panel styles
    src/zoom.ts         bottom Canvas bar rendering and actions
    src/zoom.css        bottom Canvas bar styles
    src/assets/app.css  design tokens and base styles
  shared/
    ipc.ts              channel names and IPC payload types
    geometry.ts         bounds validation and clamping
    canvas.ts           infinite-canvas frame sizing and row arrangement
    layout.ts           legacy grid/freeform helpers and general geometry
    minimap.ts          projects pane frames and the viewport into an overview map
    profiles.ts         profile IDs, labels, partition names, validation
    shell.ts            shell URL constants, CSP builder, trusted document check
    url.ts              address normalization and scheme policy
tests/
  unit/                 Vitest tests for pure modules and profile storage
  e2e/                  Playwright Electron integration and accessibility audits
  fixtures/             deterministic local HTTP + authentication fixture server
scripts/
  dev.mjs               starts fixtures + electron-vite dev
  start-packaged.mjs    launches the packaged BrowserDeck app for `make start`
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

The shell is the first child of `contentView` and fills the window content area. Each pane view is added afterwards and occupies only the rectangle of its `.pane-content` placeholder. Pane chrome therefore remains ordinary DOM and is never covered by a native view. In Canvas a small trusted overview `WebContentsView` is raised above the pane stack at the bottom-right; it is the only persistent native overlay above browser content. Canvas **+** and right-click menus are shell DOM, so any native pane whose content intersects the open menu is hidden and its snapshot remains; uncovered panes stay live. The custom shell menu handles pane actions, Canvas actions, and the browser palette; native menus remain for the application menu bar.

On macOS the window uses `titleBarStyle: 'hiddenInset'` with the traffic lights at `(16, 16)`. The shell fills the full window bounds, the toolbar is the window drag region, and interactive toolbar controls opt out with `-webkit-app-region: no-drag`. The toolbar reserves 84 px at the leading edge for traffic lights. Other platforms keep the default native frame.

Canvas positions absolutely placed `.pane-slot` elements from world coordinates plus the current pan and zoom. `App.vue` measures the workspace content box and re-measures native content rectangles after Vue commits the layout. Empty-canvas drag and Hand mode pan the world; pane header drags update only that pane's persisted world position. While a pane is dragged, other panes' edges and centers produce snap candidates and shell-rendered alignment guides. The flush snap threshold is eight screen pixels divided by the current zoom. A first magnetic stop leaves a 16-pixel gap when opposite edges are within 24 pixels; a wider 64-pixel range produces lighter dashed guides before that stop. Once an axis snaps at either stage, its solid guide replaces the dashed proximity guide. Native views are hidden for the duration of a pane drag so guides and snapshots remain visible.

Native views cannot be clipped by DOM overflow. Pane content is shown only when its content rectangle is fully inside the visible workspace viewport and outside an open Canvas menu. Partially visible or off-screen panes are hidden in the native layer, show a shell message or snapshot, and have no new bounds applied while hidden. The main process re-validates the visibility flag before showing any view.

Canvas pane order is renderer state, independent of the main-process pane snapshot order; add/close operations reconcile it. Dragging empty canvas briefly replaces pages with snapshots and restores fully visible native views afterward.

## Keyboard and menu commands

A native **Browser** menu defines accelerators (`Cmd/Ctrl+N` add browser, `Cmd/Ctrl+K` find browser, `Cmd/Ctrl+L` focus address, `Cmd/Ctrl+R` reload, `Cmd/Ctrl+D` duplicate, `Delete`/`Backspace` close from shell focus) and sends typed commands to the trusted shell; the native **View** menu adds Canvas zoom accelerators (`Cmd/Ctrl+=`, `Cmd/Ctrl+-`, `Cmd/Ctrl+0`). The renderer tracks an active pane from shell pointer/focus and native pane focus notifications; the active pane slot gets a subtle accent ring and `aria-current="true"` on the card. Commands cover add, duplicate, close, reload active/all, focus address, find browser, and Canvas zoom. The shell remains the only frame that receives these events; remote pages have no bridge. Canvas add/context menus are custom shell components, not native menus, so they can match the app's visual language; their actions call the same validated IPC and renderer operations.

Menu command routing is tested by invoking menu items from the Electron main process; raw key-chord automation remains a follow-up.

## Accessibility

The shell exposes one level-1 heading (`BrowserDeck`), a banner toolbar, and a named `Browser workspace` main landmark. Browser cards are named articles (`Browser: <title>`) with a two-row header. The top row has a drag grip, title, per-browser viewport trigger, back, forward, reload, open-in-browser, actions, and close controls; the second row shows the viewport class label, that pane's centered address bar, and the CSS resolution. The custom actions menu is the same component used by the + browser menu. The top toolbar carries only Add and draggable space. Icon-only controls have names and tooltips. Dialog triggers expose `aria-haspopup="dialog"`, `aria-expanded`, and a workspace-aware name.

Profile and workspace dialogs use `role="dialog"`, `aria-modal`, `aria-labelledby`, and `aria-describedby`, focus the dialog container on open, trap Tab/Shift+Tab within the dialog, close on Escape, and return focus to the trigger. Workspace rows expose one selection control named `Switch to workspace <name>` plus a per-row actions trigger named `Workspace actions for <name>`; rename, duplicate, and delete live in that row menu, with active-workspace and last-workspace constraints reflected as disabled items. Focus-visible styling uses the shared `--focus` token; the dialog container draws the same ring when opened from the keyboard. Dialog header wrappers are plain `div`s so they do not create a second `banner` landmark.

`tests/e2e/accessibility.spec.ts` automates the trusted shell and both dialogs with Playwright roles/names, tab-order and focus-visible assertions, focus-trap/focus-return checks, Chromium's CDP `Accessibility.getFullAXTree`, and axe-core. Axe is evaluated through CDP `Runtime.evaluate` because the shell CSP deliberately blocks inline script injection; the production CSP is unchanged. The axe run covers WCAG 2.0/2.1/2.2 A/AA and best-practice rules. This is regression coverage, not a substitute for a VoiceOver pass: axe and the CDP tree cannot verify spoken order, live-region timing, or whether a focus indicator is practically usable.

## Viewport emulation

`src/shared/viewports.ts` is the pure viewport contract: responsive plus mobile (390 × 844, DPR 3), tablet (820 × 1180, DPR 2), laptop (1280 × 800, DPR 1), and desktop (1440 × 900, DPR 1) presets, custom dimensions/DPR validation, and fit-scale math. Pane state carries the selected viewport. The main process validates every incoming viewport again before applying it.

`BrowserManager.applyEmulation` uses Chromium's `Emulation.setDeviceMetricsOverride` through the attached debugger:

- `width` and `height` equal to the requested CSS viewport; `deviceScaleFactor` from the preset or custom value.
- `mobile: true` for phone/tablet presets, so the viewport meta tag is honored and Chromium uses mobile scrollbar behavior. Desktop presets use `mobile: false`.
- `scale` equal to `min(availableWidth / width, availableHeight / height)`, clamped to a safe range, so fixed viewports always fit the pane content.
- `Emulation.clearDeviceMetricsOverride` for responsive panes at 100% Canvas zoom; responsive panes at other zooms use the 560 × 700 reference viewport with the Canvas scale.
- `Emulation.setTouchEmulationEnabled` with five touch points for phone/tablet presets, which also makes `hover: none` and `pointer: coarse`; desktop/responsive panes disable touch emulation.

Using one CDP path for fixed and responsive emulation avoids stale metrics when switching between presets.

Emulation is applied only after a page has reached `did-stop-loading`. Enabling device emulation on an empty `WebContentsView` before its first navigation segfaulted Electron 45 on macOS. Viewport changes made while a navigation is in flight are retained in the pane record and applied when loading stops. Reloads and navigations invalidate the emulation signature at `did-start-loading`, because Chromium can reset emulation during navigation; the stop handler then reapplies the current Canvas scale even when the viewport settings did not change. App-initiated reloads and navigation also hide an emulated native view until that reapplication completes, showing the existing snapshot/loading state instead of flashing the previous scale.

The emulated surface remains inside the native pane bounds; only its CSS layout and rendering scale are emulated. Fixed viewports always scale to fit, and the scale is recomputed from the current native bounds whenever the pane frame, window, aspect, or zoom changes. Responsive panes use the pane content size directly. Optical rotation is a per-viewport `rotated` flag: fixed viewports swap their effective width and height for device metrics, fit scaling, canvas frame math, viewport labels, and mobile screen orientation. Responsive panes cannot rotate.

`src/shared/user-agent.ts` maps fixed presets to a category-appropriate UA: iPhone Safari for Apple and generic phones, Android Chrome for Galaxy/Pixel phones, iPad Safari for iPad and generic tablets, Android Chrome for the Galaxy Tab, and desktop Chrome for laptop/desktop presets. Responsive and custom viewports keep each pane's original Electron UA. BrowserManager stores that original per pane, applies the mapped UA before the first load, and when a viewport change alters the category it updates the UA and reloads the current URL so the site can serve its mobile document. The viewport, DPR, and fit math remain unchanged; the UA is for layout fidelity, not identity or restriction bypass.

The custom browser actions menu also exposes **Copy URL**, **Rotate Viewport**, **Clear Site Data…**, and **Capture Screenshot…**. Rotation is disabled for responsive viewports. Screenshot capture calls `webContents.capturePage()`, opens a native save dialog, writes the PNG to the user-selected path, and reports failures through a native error box. The IPC handler validates the trusted shell sender and pane ID; it never accepts a filesystem path from the renderer.

Each browser header exposes its own preset trigger from the shared viewport catalog. It shows the short preset name; the second row adds the viewport class (Phone/Tablet/Desktop/Responsive/Custom) and CSS resolution around the address. The trigger opens the same custom in-shell menu used by Add, with the complete catalog, left-aligned names, right-aligned dimensions, and a checkmark for that browser's preset. Selecting Custom… hides the side labels and replaces the address row with the inline width/height/DPR editor. Apply or Cancel returns to the address without changing the header height. No viewport control lives in the top toolbar. Invalid custom values are rejected in the shell and never reach IPC.

The toolbar **+** control opens a custom in-shell browser menu built from the shared preset catalog. It lists every fixed preset plus Responsive, grouped into Phone viewports, Tablet viewports, and Desktop viewports, and shows CSS dimensions as muted metadata. Selecting a browser calls `browserdeck:add-pane-with-viewport`; main validates the viewport, creates a fresh profile, and creates the pane with that viewport. Right-clicking empty Canvas opens a second custom menu with Add browser, Fit all browsers, Reset zoom, Hand tool, Workspaces, and Appearance.

The bottom canvas bar's appearance control opens the in-shell System/Light/Dark menu; the custom Canvas menu exposes the same three choices through a validated `browserdeck:set-theme` call, and the native View menu remains available. Main keeps `nativeTheme.themeSource`, persisted preference, native chrome, and the shell's resolved `data-theme` synchronized. Each pane's webContents receives the resolved `prefers-color-scheme` through the debugger's `Emulation.setEmulatedMedia`, so loaded websites react without a reload. Workspace and profile management are native menu items that send shell commands to open the existing dialogs.

Canvas layout uses world-coordinate pane positions plus a viewport pan offset and zoom. The workspace draws a radial-gradient dot field whose background position follows the pan. Dragging empty canvas, wheel panning, or using the Hand tool updates only the shell transform until the gesture ends; native views are hidden for the duration. Holding Space temporarily enables the Hand tool. While Hand is active, the wheel zooms around the cursor between 25% and 200%. Canvas zoom is a uniform pane scale: the slot is sized to the declared world frame times the zoom, the pane header is laid out at its world width and CSS-scaled by the zoom, and the page keeps its declared CSS viewport while main applies the matching device-emulation scale. Pane header chrome, page content, positions, and snapshots therefore scale together, without reflowing the page. Dragging a pane header updates that pane's world position and snaps to neighboring edges/centers with live guides, but cannot move the header above a 24 px top inset. Browser headers keep a drag grip, viewport trigger, address bar, back, forward, reload, open-in-browser, actions, and close controls at every zoom; the second-row viewport class and resolution give way to the address in very narrow panes and hide while the custom viewport editor is open. The bottom-bar Select tool swaps canvas dragging for a marquee. Native views are hidden for the gesture, the shell draws a fixed marquee rectangle, `canvasPaneIdsInRect` selects intersecting frames in screen space, and selected pane slots get a ring outside native bounds. The toolbar shows the selected count and a close action; Delete closes the set and Escape clears it. A primary click on empty canvas without movement clears the active pane; selecting a pane, its header, or a minimap frame restores it. The top toolbar remains mounted with a quiet empty state, so selection changes never move or resize the workspace. A bottom-bar magnifier button and `Cmd/Ctrl+K` open a trusted shell browser palette above snapshots. It highlights matching title, host, and viewport text; native views, the minimap, and the bottom canvas bar are hidden until it closes, then restored through the normal validated bounds path. Main captures JPEG page snapshots through `capturePaneSnapshots`; the shell displays those images while panning, for partially off-screen panes, and under open menus. On release, the validated bounds path restores native views for frames fully inside the workspace and not covered by a menu. Canvas positions are persisted in workspace layout together with the last camera and selection (`view: { pan, zoom, activePaneId }`). The shell restores that view on first appearance and after a workspace switch, and only runs the fit path for workspaces without a saved camera. Discrete camera changes, gesture ends, and selection changes are saved immediately; continuous gestures use a short debounce, and a best-effort final save runs while the shell unloads. The first bounds for a pane are applied even while it is hidden, so a restored offscreen pane still loads at a real viewport size instead of staying blank. Incidental native focus events are briefly ignored during a restore so the saved active browser sticks. Fit all remains the one-click recovery action for stale or offscreen cameras. It fits panes into a safe viewport inset 24 px at the top and sides and 64 px at the bottom, leaving clearance above the 40 px Canvas bar and its 12 px margin; single-pane focus, reveal centering, and partially visible pane centering use the same safe area.

The Canvas overview is a separate trusted `WebContentsView` because a DOM minimap would be covered by native pane views. It is pinned to the bottom-right, sized between 168 and 208 px wide as the window changes, and raised above the pane stack whenever Canvas is active. The panel can collapse to its header. `src/shared/minimap.ts` projects all pane frames and the current viewport into the map, including the viewport bounds so panes remain findable after panning far away; it also owns the adaptive panel size. The shell sends validated projection state through `browserdeck:update-canvas-minimap`; main relays it to the minimap view. Selecting a frame centers and focuses that pane, selecting the map background centers that world point, and the header's fit control or the zoom menu runs Fit all. Minimap actions are validated in main and relayed to the shell, which then regains focus. Covered native views are never hidden for the minimap, so pages stay live outside its corner. The minimap and bottom bar hide for shell dialogs and marquee drags. For custom menus they hide independently only when the menu rectangle intersects that overlay; zoom, Arrange, and appearance menus keep both visible.

The bottom-center canvas bar is a second trusted `WebContentsView` rendered from `zoom.html`. It is 422 × 40 DIP with a 12 px bottom margin and sits above the pane stack and the minimap. It contains Hand, Select, zoom-out, a percentage button, zoom-in, find-device, reload-all, Arrange, and appearance. Fit all and pane centering reserve its footprint plus 12 px of clearance so fitted browsers never sit behind it. `src/shared/zoom.ts` owns the 25–200% range, 10% step, presets, bar dimensions, state/action validation, and the hand/select/theme state carried to the bar. The shell sends zoom changes through `browserdeck:set-canvas-zoom`, hand changes through `browserdeck:set-canvas-hand-mode`, and Select changes through `browserdeck:set-canvas-select-mode`; main forwards the current zoom, resolved theme, theme preference, hand state, and select state to the bar through `browserdeck:canvas-zoom-state`. The bar's Hand, Select, step, preset, Fit all, Reset, find-device, reload-all, Arrange, and appearance actions travel through `browserdeck:canvas-zoom-action` to the shell, which applies zoom around the workspace center, toggles Hand or Select, opens the browser palette, reloads all browsers, opens the arrange menu, or opens the appearance menu. Main validates that sender against the built `browserdeck://shell/zoom.html` document (or the validated development origin) before relaying anything. The percentage, Arrange, and appearance buttons ask the shell to open its standard `AppMenu` above the bar; unlike other menus, these keep the bar and minimap visible because they do not overlap them. Arrange runs the pure `arrangeCanvasFrames` helper for Showcase, Horizontal row, 2 × 2 grid, or Vertical stack, persists the new positions, and fits the camera to the result. Using a bar or minimap action closes the menu first. The zoom menu offers 25%, 50%, 75%, 100%, 125%, 150%, 200%, Fit all, and Reset (100%).

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
- Ordering helpers treat the end of the list as the topmost/front pane.
- Legacy grid/freeform normalization and geometry helpers remain for migration and historical tests only.

The renderer uses Canvas positions, the native overview, per-browser header controls, and the minimal Add-only top toolbar. Native views are shown only when fully inside the viewport and outside an open menu. Native application-menu keyboard commands cover add, close, reload, focus address, find browser, and workspace actions; pane actions use the custom shell menu.

## Pane sessions

Each pane owns an internal persistent profile and partition. There is no profile manager, profile picker, profile sharing, or profile label in the chrome. `profiles.json` remains an internal registry so a pane can restore its partition across app restarts.

Closing a pane clears its storage, cache, and auth data, removes its profile metadata, and best-effort deletes its partition directory. Workspace switches and app shutdown bypass this release because the workspace retains the pane definitions. Deleting an inactive workspace may leave its profiles unused; they remain internal and are not surfaced in a manager.

The browser actions menu exposes **Clear Site Data…** with a second confirmation menu. Confirming clears that pane's cookies, storage, cache, and auth state, then reloads the pane. Other panes are untouched because sessions are never shared.

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

When a pane closes, its profile record, persistent session data, and partition are released. Workspace-switch and shutdown teardown bypass profile release because the workspace retains the pane definitions.

## IPC boundary

The preload exposes `window.browserdeck` only to the trusted shell. Channels are explicit; there is no generic send/invoke bridge.

| Channel | Purpose |
| --- | --- |
| `browserdeck:get-state` | Current pane snapshots |
| `browserdeck:add-pane` | Create a pane with an independent profile |
| `browserdeck:duplicate-pane` | Duplicate a pane with an independent profile, URL, and viewport |
| `browserdeck:close-pane` | Destroy a pane and its view |
| `browserdeck:navigate` | Normalize and load an address |
| `browserdeck:back` / `forward` | Pane-specific navigation history |
| `browserdeck:reload` / `reload-all` | Reload one or all panes |
| `browserdeck:set-pane-bounds` | Validated native view rectangles and visible/hidden state |
| `browserdeck:set-pane-viewport` | Validated per-pane viewport preset, custom size, and DPR |
| `browserdeck:rotate-pane-viewport` | Toggle a fixed viewport between portrait and landscape |
| `browserdeck:capture-pane-screenshot` | Capture the pane to a PNG chosen through a native Save dialog |
| `browserdeck:open-pane-external` | Open the pane's validated HTTP(S) URL in the system browser |
| `browserdeck:add-pane-with-viewport` | Validated viewport plus a fresh profile for a new pane |
| `browserdeck:set-theme` | Validated System/Light/Dark preference from the custom Canvas or bottom-bar appearance menu |
| `browserdeck:capture-pane-snapshots` | In-memory JPEG snapshots for canvas panning and partially visible panes |
| `browserdeck:set-canvas-select-mode` | Validated Select-tool state from the trusted shell |
| `browserdeck:update-canvas-minimap` | Validated shell → main Canvas projection state |
| `browserdeck:set-canvas-minimap-visible` | Show or hide the native overview in Canvas mode |
| `browserdeck:canvas-minimap-state` | Main → minimap projection state |
| `browserdeck:canvas-minimap-action` | Validated minimap → main focus, recenter, fit, or collapse action |
| `browserdeck:canvas-minimap-action-requested` | Main → shell minimap action request |
| `browserdeck:save-workspace-layout` | Validated renderer-owned Canvas layout state |
| `browserdeck:list-workspaces` | Workspace summaries, pane counts, update dates, and active flag |
| `browserdeck:export-workspace` | Write a secret-free workspace transfer through a native Save dialog |
| `browserdeck:import-workspace` | Validate a transfer file and create a fresh-profile workspace |
| `browserdeck:create-workspace` | Create a validated empty workspace |
| `browserdeck:rename-workspace` | Rename a validated workspace with unique-name checks |
| `browserdeck:duplicate-workspace` | Clone a workspace with fresh profiles and mapped pane IDs |
| `browserdeck:switch-workspace` | Persist current panes, tear down views, and restore another workspace |
| `browserdeck:delete-workspace` | Delete an inactive, non-final workspace file |
| `browserdeck:bring-pane-to-front` | Reorder a native pane view to the top of the stack |
| `browserdeck:send-pane-to-back` | Reorder a native pane view to the bottom above the shell |
| `browserdeck:pane-command` | Trusted menu/shortcut command for the active pane |
| `browserdeck:copy-pane-url` | Copy the selected pane URL to the clipboard |
| `browserdeck:clear-pane-site-data` | Clear one pane's cookies, storage, cache, and auth state, then reload it |
| `browserdeck:open-pane-devtools` | Open detached DevTools for the selected pane |
| `browserdeck:pane-focused` | Main → shell notification when a native pane gains focus |
| `browserdeck:pane-notice` | Main → shell transient notice for a blocked popup, download, or permission request |
| `browserdeck:state-changed` | Main → shell state snapshots |
| `browserdeck:request-measurement` | Main → shell re-measure request |

Every `ipcMain.handle` validates that the sender is the shell `webContents`, that the sender frame is the shell's main frame, and that the frame document is the built `browserdeck://shell/index.html` entry or the validated loopback development origin. The minimap action channel instead requires the dedicated minimap `webContents`, its main frame, and the trusted `minimap.html` document. Payload types and lengths are checked again in main. The renderer's validation is only a UX convenience. Unauthorized state reads receive an empty default state rather than workspace metadata.

## Sessions and profiles

`ProfileStore` seeds the initial pane profiles on first launch so stable partitions can be reused across restarts. Newly created panes receive a new UUID and a new `persist:browserdeck-profile-<uuid>` partition. Labels are internal metadata and never appear in the UI or partition names. Records live in `<userData>/profiles.json`, written with a temp-file + flush + rename sequence. Writes are serialized and use a unique temporary name so concurrent saves cannot overwrite a newer snapshot. Invalid files are renamed with a `.corrupt-<timestamp>` suffix and replaced with safe defaults.

There is no profile manager, sharing, or close-and-delete flow. Sessions are independent per pane and released on close.

BrowserDeck is not an identity provider and stores no credentials. Authentication remains owned by each website: the website sets cookies in its pane session, and the app preserves that session across workspace switches and app restarts until the pane is closed. The local fixture demonstrates this with server-issued HttpOnly session cookies for two synthetic accounts, including logout isolation and restart persistence.

Every remote session applies:

- `setPermissionRequestHandler` → deny and report a transient notice;
- `setPermissionCheckHandler` → deny;
- `setDisplayMediaRequestHandler` → deny (null stream);
- `setDevicePermissionHandler` → deny HID/serial/USB;
- `setBluetoothPairingHandler` → reject pairing;
- `will-download` → prevent and report a transient notice;
- pane `setWindowOpenHandler` → deny and report a transient notice;
- `will-attach-webview` → prevent.

Blocked-action notices are intentionally non-interactive. Permission requests map to a pane by `webContents` ID; downloads map by profile and initiator origin; popups are reported directly by the pane handler. The shell shows the message in that browser's header status for six seconds, so the deny-by-default policy remains intact while making the block visible.

The trusted shell's default session receives the same deny-by-default policy. Remote views use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, no application preload, and their profile partition. `will-navigate` and `will-redirect` enforce the `http:` / `https:` / `about:blank` policy. URLs with embedded credentials or more than 2,048 characters are rejected so they cannot enter workspace state. TLS errors are not ignored.

## Shell security

- The shell loads the Vite dev server in development and `browserdeck://shell/index.html` in production. `ELECTRON_RENDERER_URL` is honored only in unpackaged runs and only for a loopback `http(s)` origin; the loaded origin is verified, and cross-origin shell redirects are blocked.
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
- Application-window maximized/full-screen state is persisted in `app-state.json`. No cookies, tokens, page contents, or credentials are written to workspace JSON.

`app-state.json` also carries optional normal window bounds, `maximized`/`fullScreen` flags, and a `system`/`light`/`dark` theme preference. Bounds are validated, saved after debounced move/resize/maximize/fullscreen events and before close, and restored only if they intersect a connected display's work area. Maximized/full-screen presentation restores only when those safe bounds are available; minimized and focused state are not persisted. Save snapshots capture the target workspace path at enqueue time so an active-workspace change cannot redirect a queued write.

The bottom canvas bar appearance menu and native **View → Theme** radio menu update `nativeTheme.themeSource`, window/shell backgrounds, persistence, and shell state. Main sends a resolved `light`/`dark` value and the shell always applies an explicit `data-theme`; System mode therefore stays synchronized with native chrome even though renderer `prefers-color-scheme` propagation is unreliable in the tested Electron/Playwright environment. Pane webContents receive the same resolved scheme through CDP media emulation on creation, navigation, and every appearance change. Theme preferences are application-wide, not per workspace.

Multiple workspace files can coexist under `workspaces/`. The active workspace ID is persisted in `app-state.json`; names are unique case-insensitively. Deleting the active or final workspace is blocked. Switching first persists current pane definitions/layout, flushes the save queue, activates the target store file, destroys the current native manager/views, creates the target panes, and reapplies the target layout. Test hooks read the current manager rather than a captured initial instance.

Duplicating a workspace creates new pane IDs and independent sessions, then remaps Canvas positions and legacy order/geometry fields to the new IDs. Deleting a workspace releases profiles that are not referenced by another workspace or live pane. Workspace switching reloads pages rather than keeping background panes warm.

Workspace transfer files use a separate versioned `browserdeck-workspace` schema containing only workspace name, pane URLs/viewports, and index-based layout. Profile IDs and browser data are stripped. Export includes pane URLs, including query strings, so users must not store secret-bearing URLs in panes they export. Import verifies the selected path is a regular file, enforces a 1 MB limit, and validates the full schema, URLs (including credential and length rejection), viewports, pane-index order, and legacy geometry before generating fresh sessions, pane IDs, a unique imported name, and a mapped Canvas workspace. Imported workspaces are inactive and never carry authentication. Native Save/Open dialogs stay in main; transfer/materialization logic is pure and unit-tested.

Shutdown flushes queued writes through `will-quit`.

## Testing

- **Unit:** pure bounds validation, Canvas frame sizing/default placement/snapping/proximity guides, marquee hit testing, preset user-agent mapping, minimap projection/adaptive sizing, legacy grid/freeform normalization, viewport preset/custom validation and fit math, workspace schema/order/geometry/camera-view normalization, workspace-store persistence/corruption/validation plus create/rename/switch/delete lifecycle, workspace export/import serialization/profile stripping/fresh-ID materialization, CSP construction and trusted shell-document matching, shell asset path/MIME validation, URL normalization/scheme/credential/length policy, profile ID/partition/directory/label validation, profile-store seeding/restoration/rename/removal, corruption recovery, and atomic persistence.
- **Integration/e2e:** launches the built Electron app against a local fixture server and verifies the internal shell protocol, CSP inline-script/cross-origin-fetch blocking, invalid-sender IPC rejection from a separate node-enabled webContents, blocked remote `file:`/`data:` navigation, two isolated profiles, independent form-based authentication with HttpOnly sessions, logout isolation, cookie/localStorage/IndexedDB isolation, popup and permission denial, no remote bridge/Node access, Canvas-only startup with fit for new workspaces and exact camera/selection restore for saved workspaces, a minimal Add-only top toolbar and per-pane header address rows, per-browser header viewport triggers, drag grips, and open-in-browser handoff, native Workspace menu commands, native Canvas zoom commands and accelerators, a bottom canvas bar with Hand, Select, zoom step/presets, find-device, reload-all, Arrange, and appearance, zoom/Arrange menu retention of the bar and minimap, marquee multi-selection with rings/count/multi-delete, preset UA switching across iPhone/iPad/Android/desktop presets and the responsive fallback, duplicate placement beside or below the source, the four Arrange actions and horizontal-row positions (Showcase/grid/stack covered by unit tests), whole-pane uniform zoom with the declared page viewport unchanged, empty-canvas deselection with a stable workspace rectangle, pane actions remaining visible when pane widths straddle the old 340 px breakpoint at 80% zoom, borderless top-right toolbar controls, pane-header dragging with 16px-gap and flush snap stops plus dashed proximity previews, custom **+** browser menu creation and Escape dismissal, right-click canvas menu Add pane/Hand/Appearance actions, native-view hiding only under menus, menu command routing, matched viewport/Add preset menus, duplicate pane with independent session/URL/viewport, per-pane viewport presets/custom dimensions, concurrent different presets in two panes, responsive emulation under canvas zoom, pane creation from a selected browser preset, invalid custom recovery, workspace persistence through restart (pane identity, profile, URL, viewport, Canvas position, camera, selection, window bounds, theme), session release after close, confirmed per-pane Clear Site Data, deleted-workspace session cleanup, workspace create/switch/rename/duplicate/delete with active-state persistence, repeated workspace switching with configurable soak cycles, baseline webContents/native-view counts and working-set sampling, window resize alignment, address/back controls, focus handoff, active-pane outline/`aria-current`, live pane `prefers-color-scheme` changes, Canvas panning with snapshots and Hand-tool hiding of native views, pane close destroying a `webContents`, independent sessions for new panes, and authenticated session/cookie/localStorage persistence after a restart.
- **Accessibility:** `tests/e2e/accessibility.spec.ts` verifies toolbar/pane/dialog roles and accessible names, named dialog triggers and expanded state, 2 px focus-visible outlines, forward/reverse tab order, active-pane `aria-current`, dialog focus trap and return, workspace row-menu states, and unique contextual action names. It reads Chromium's CDP accessibility tree and runs axe-core with WCAG 2.0/2.1/2.2 A/AA plus best-practice tags against the shell and the workspace dialog. Axe is injected with CDP `Runtime.evaluate` rather than an inline script because the shell CSP blocks the latter.
- **Contrast:** `npm run check:contrast` computes WCAG ratios for text, muted/faint, accent, focus, and danger token pairs in explicit light/dark themes.
- **Manual:** Retina viewport (`devicePixelRatio` 2), native menu stacking, visual always-fit scaling, custom menu light/dark visual review, VoiceOver/screen-reader order and announcements, workspace dialog visual review, theme menu/token review, workspace restore smoke check, packaged unsigned app launch, and alignment on macOS.

The Playwright tests inspect the main process through a test hook that is only installed when `BROWSERDECK_TEST=1` and the app is not packaged. Native page targets are also available to Playwright, so real page clicks are used for fixture interactions.

## Packaging

`electron-builder.yml` packages the built `out/` tree with asar enabled. Product metadata is BrowserDeck 1.1.0, app ID `com.kanharithsok.browser-deck`, developer-tools category, MIT license, and the `build/icon.icns` icon generated from the checked-in SVG source. `npm run package:mac` builds arm64 DMG and ZIP artifacts into `dist/`; `npm run package:dir` produces the unpacked app for faster checks. `make start` uses that unpacked app so the Dock name, menu identity, and icon come from the real bundle rather than the Electron runtime. `dist/` is ignored by Git.

Electron fuses are applied after packing and before the (skipped) signing step: `RunAsNode` disabled, Node options and inspector arguments disabled, embedded ASAR integrity validation enabled, only-load-from-ASAR enabled, `file://` extra privileges disabled, and the ad-hoc Darwin signature reset. The shell custom protocol plus these fuses avoid the former broad `file://` shell transport. Fuse state is read back with `npx electron-fuses read --app dist/mac-arm64/BrowserDeck.app`.

Code signing is intentionally disabled with `identity: null` for the current unsigned local builds. The local machine has only an Apple Development certificate, not a Developer ID Application certificate or notarization credentials. Signed distribution requires installing the Developer ID certificate, configuring notarytool credentials outside the repository, enabling hardened runtime/signing in builder config, and notarizing/stapling both the app and disk image. Cookie encryption at rest is not enabled for these ad-hoc builds; see `SECURITY.md`.

## Known architectural gaps

- DOM content cannot be drawn over native browser views. All in-app context menus use the custom shell menu and hide only intersecting native panes while showing their snapshots; future contextual UI must use the same hiding strategy or a separately proven overlay view.
- Native views are not clipped by the shell's scroll containers. Canvas and menu visibility work by hiding intersecting or partially off-screen views; only fully visible, uncovered panes are interactive.
- Fixed viewports always fit the pane and can letterbox when the emulated aspect ratio differs from the pane; there is no fill/crop display mode.
- Workspace switching tears down and recreates native pane views; pages reload instead of staying warm in the background.
- Leak stress is count-based (webContents/native views) over a 50-cycle switch loop, not long-duration memory profiling; memory is sampled before/after rather than peak/per-process, and observed 50-cycle growth ranged from 0 MB in one run to ~95 MB on final `main`.
- Duplicated workspaces receive fresh profiles immediately, even if the duplicate is never opened.
- Normal window bounds and maximized/full-screen state restore only when the saved normal bounds still intersect a current display.
- Overlapping Canvas panes can cover each other's headers; use the overview or Fit all to locate and recover them.
- Closing a pane deletes its browser session with no extra confirmation. Reopening starts signed out. Duplicate pane copies URL/viewport/custom title into a new independent session; session copying is not supported. The duplicate is anchored beside the source, or below it when the adjacent slot is occupied.
- There is no profile manager, profile sharing, or profile labels in the UI. Clear Site Data is per pane and confirmed.
- Multi-select is a Canvas tool. A marquee starts from empty canvas or pane chrome because native page content receives its own pointer events. Delete closes the selected browsers immediately with no undo; Escape clears the selection first.
- Preset user agents are category-level, not exact model strings. User-Agent Client Hints may still identify Chromium, and touch/GPS/device APIs are not emulated.
- Native workspace import/export file dialogs are not automated in Playwright; pure transfer/materialization logic is unit-tested.
- Background-warm workspace switching and long-duration memory/CPU profiling with loaded pages are not implemented.
- Partition-directory deletion is best-effort after session data is cleared.
- Canvas stress is count-based at one window size and pane count; more performance measurement remains.
- Pane movement is pointer-only; keyboard movement remains.
- A fully covered pane can be unreachable until the covering pane moves or Fit all is used.
- Keyboard menu commands act on the active pane; the active pane slot is outlined and the card is marked with `aria-current`. Dialog triggers expose `aria-haspopup`/`aria-expanded`, and the toolbar collapses secondary labels at narrow widths. Automated axe/role/AX checks cover the shell and dialogs, but a VoiceOver/screen-reader pass and practical focus-visibility review remain manual.
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
