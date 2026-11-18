# Architecture

> Status: Phases 0 and 1 complete; Phase 2 in progress. The native-view composition and per-profile browser session foundation are implemented and verified. The pure layout engine exists and is unit-tested; renderer integration is not started. See `docs/DECISIONS.md` and `docs/PHASE_REPORTS.md`.

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

`PaneCard` exposes `.pane-content[data-pane-content="<paneId>"]`. `App.vue` observes the workspace with a `ResizeObserver` and re-measures after state changes and window resize notifications. Measurements are coalesced into one `requestAnimationFrame`. The renderer sends absolute rectangles relative to the shell viewport; the shell view starts at `(0, 0)` in the window content, so these coordinates are directly usable as `View.setBounds` DIP coordinates.

The main process re-validates every rectangle in `parsePaneBounds`:

- known pane ID and no duplicates;
- finite, positive dimensions;
- rounded and clamped to the shell canvas;
- minimum pane view size of 80 × 60.

The canvas comes from the shell view's actual bounds, not from a renderer-supplied size. A view is made visible only after valid bounds exist and when it is not showing `about:blank` or an error panel. Load failures hide the native view so the shell can render a retry panel in place.

Focus stays in the trusted shell: adding a pane moves focus to its address input, and closing a pane recovers focus to an adjacent address control (or the empty-state action). Native pane focus handoff is not implemented yet.

## Layout engine

`src/shared/layout.ts` is the pure layout subsystem. It has no Vue or Electron imports and is unit-tested independently of the running app.

Contract:

- All pixel geometry is expressed in CSS pixels/DIP at the renderer boundary. The main process continues to validate native view rectangles separately.
- Grid layout is row-major with equal-width columns, validated 1–5 column counts, configurable padding/gap, and a minimum pane card size. Row height is at least the minimum, so excessive rows report `needsVerticalScroll` instead of silently shrinking or dropping panes. Narrow columns report `columnTooNarrow` for the caller to handle.
- Grid order is the pane ID order. Reorder, add, and remove operations feed a new ordered ID list into `layoutGrid`.
- Freeform geometry can be stored as normalized rectangles and converted to pixels for the current canvas. Conversion clamps to the canvas and enforces a minimum size; when the canvas is smaller than the minimum, the canvas wins.
- Move and edge-resize helpers clamp to canvas bounds. Snapping produces candidate-aligned rectangles and guide coordinates for canvas edges/centers, neighboring pane edges/centers, and optional grid lines within a configurable threshold.
- Ordering helpers treat the end of the list as the topmost/front pane. Maximize returns both the maximized rectangle and the previous rectangle for restore.

The renderer still uses its CSS auto-fit grid; wiring the engine into DOM card placement and native bounds synchronization is the next Phase 2 slice. Scroll-aware clipping of native views is still unresolved and is intentionally not hidden behind the engine.

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
| `paneflow:close-pane` | Destroy a pane and its view |
| `paneflow:navigate` | Normalize and load an address |
| `paneflow:back` / `forward` | Pane-specific navigation history |
| `paneflow:reload` / `reload-all` | Reload one or all panes |
| `paneflow:set-pane-bounds` | Validated native view rectangles |
| `paneflow:show-pane-menu` | Native pane actions menu |
| `paneflow:state-changed` | Main → shell state snapshots |
| `paneflow:request-measurement` | Main → shell re-measure request |

Every `ipcMain.handle` validates that the sender is the shell `webContents` and that the sender frame is the shell's main frame. Payload types and lengths are checked again in main. The renderer's validation is only a UX convenience.

## Sessions and profiles

`ProfileStore` currently seeds two profile records on first launch so the Phase 0/1 experiment can reuse stable partitions across restarts. Newly created panes receive a new UUID and a new `persist:paneflow-profile-<uuid>` partition. Labels are presentation metadata and never appear in partition names. Records live in `<userData>/profiles.json`, written with a temp-file + flush + rename sequence. Writes are serialized and use a unique temporary name so concurrent saves cannot overwrite a newer snapshot. Invalid files are renamed with a `.corrupt-<timestamp>` suffix and replaced with safe defaults.

This is provisional infrastructure. Rename, clear, delete, explicit sharing, and an in-use registry belong to Phase 3.

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

Only profile metadata and Electron-managed partition data exist so far. Workspace files, active workspace, pane URLs, layout, and viewport settings are not yet persisted; Phase 3 adds those with a versioned schema and migrations. No cookies, tokens, page contents, or credentials are written to PaneFlow JSON.

## Testing

- **Unit:** pure bounds validation, grid/freeform layout, normalized geometry, snapping, ordering, maximize/restore, URL normalization/scheme policy, profile ID/partition/label validation, profile-store seeding, corruption recovery, and atomic persistence.
- **Integration/e2e:** launches the built Electron app against a local fixture server and verifies two isolated profiles, independent form-based authentication with HttpOnly sessions, logout isolation, cookie/localStorage/IndexedDB isolation, popup and permission denial, no remote bridge/Node access, page viewport matching the pane content rectangle, DOM/native bounds alignment before and after resize, address/back controls, focus handoff, pane close destroying a `webContents`, fresh profiles for new panes, and authenticated session/cookie/localStorage/profile-ID persistence after a restart.
- **Manual:** Retina viewport (`devicePixelRatio` 2), native menu stacking, and visual alignment on macOS.

The Playwright test inspects the main process through a test hook that is only installed when `PANEFLOW_TEST=1` and the app is not packaged. Native page targets are also available to Playwright, so real page clicks are used for fixture interactions.

## Known architectural gaps

- DOM content cannot be drawn over native browser views. Future contextual UI must use native menus, hide/shift the view, or introduce a separately proven overlay view.
- Native views are not clipped by the shell's scroll containers. Scrolling many panes and partial off-screen clipping are Phase 2 work.
- The current renderer grid still shrinks panes rather than using the new layout engine. Below the 80 × 60 native minimum the bounds update is rejected and the shell shows an error banner.
- The layout engine's default 160 × 120 card minimum and main's 80 × 60 native view minimum must be reconciled when grid mode is wired.
- Window resize alignment converges after one layout frame; an e2e assertion waits for stable alignment.
- Startup always creates two panes and uses the first two profile records. Workspace restoration replaces this in Phase 3.
- Profile rename, clear, delete, explicit sharing, and an in-use profile manager are Phase 3 work.
- Remote `http:` destinations are not visually distinguished from HTTPS yet; the URL helper computes the condition but the pane state does not expose it.
- A page that closes its own `webContents` removes the pane cleanly, but the shell does not yet explain why the pane disappeared.
- Electron integration tests require a local macOS GUI session; CI covers typecheck, lint, unit tests, and build only.
- macOS packaging, code signing, and notarization are deferred to Phase 4.
- The shell CSP still permits inline styles and local development connections; revisit in the packaging/hardening phase.
