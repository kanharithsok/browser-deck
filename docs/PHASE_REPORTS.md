# Phase Reports

The agent updates this file at the end of each phase. Record actual outcomes, not intended outcomes.

## Phase 0 — Repository bootstrap and native-view spike

- **Status:** Complete; awaiting repository-owner review. Phase 1 not started.
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
- Added CI configuration for typecheck, lint, unit tests, and build. It has not run on GitHub yet because nothing was pushed.

### Verification commands and results

| Command | Result |
| --- | --- |
| `npm install` | Passed. Installed 217 packages and created/updated the lockfile. |
| `npm audit` / `npm audit --omit=dev` | Dev toolchain: 13 high-severity advisories via `picomatch` (ReDoS). Runtime dependency audit: 0 vulnerabilities. The latest installed `picomatch` 4.0.7 was still covered by the advisory and no fixed release was available. |
| `npm run typecheck` | Passed (`tsc` for main/preload/shared/tests and `vue-tsc` for the renderer). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run test:unit` | Passed: 4 files, 34 tests. Covers bounds validation, URL normalization/scheme rejection, loopback hostname checks, profile IDs/partitions/labels, store seeding, corrupt-file recovery, concurrent write safety, and persistence. |
| `npm run build` | Passed. electron-vite emitted `out/main/index.js` (35.44 kB), `out/preload/index.js` (1.93 kB), and the renderer bundle/CSS. |
| `npm run test:e2e` | Passed: 1 Playwright test, 1.2 s. It launches the built app against a random local fixture server, verifies two isolated profiles, cookies, `localStorage`, bridge/Node absence, popup and notification denial, light/dark design tokens, page viewport matching the pane content rectangle, DOM/native bounds alignment before and after resize, address/back controls, address-error recovery, focus handoff after add/close, malformed IPC rejection, closed-pane `webContents` destruction, self-closed pane removal, fresh profile for a new pane, and cookie/profile-ID persistence after restart. |
| `npm run dev` | Passed manually. Fixture server and electron-vite started; the app window loaded the Vue shell and both fixture panes. |
| Native menu check | Passed manually. The pane actions `Menu.popup` rendered above native browser content. Automated menu interaction is not yet in the e2e suite. |
| Retina/composition check | Passed manually. Both panes reported `623 × 696` CSS pixels and `devicePixelRatio: 2`; chrome and native content remained aligned. |
| `npm run start` | Passed launch check: electron-vite rebuilt and started the built app. No interactive walkthrough beyond the e2e run was performed. |
| `npm run package:mac` | Unavailable. macOS packaging is Phase 4 work and no script exists yet. |

### Architecture decision

ADR-001 in `docs/DECISIONS.md`: trusted shell `WebContentsView` plus inset `WebContentsView` rectangles, chrome outside native bounds, native menus for overlays, renderer measurement with main-process validation, CSS pixels/DIP without `devicePixelRatio` multiplication, and explicit teardown.

### Independent reviews

- **Security review:** no critical or high findings. Confirmed IPC sender/payload validation, partition isolation, sandboxing, and popup/permission/download policy. Fixed confirmed issues: cross-origin/unpackaged dev-shell loading is now loopback-only and origin-checked; unexpected `webContents` destruction removes stale panes; profile saves are serialized with unique temp files; window-teardown races no longer leak a new view. Remote HTTP ambiguity is documented as Phase 1 UI work.
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
- Remote `http:` addresses are not visually distinguished from HTTPS yet. The URL helper computes `insecureRemote`, but the state/UI does not surface it; this is required in Phase 1.
- If a page closes its own `webContents`, the pane is removed cleanly but without a user-facing explanation. Add a shell notice in Phase 1.
- The shell CSP allows inline styles and localhost WebSocket connections for development; production hardening is deferred to Phase 4.
- The app is not packaged, signed, or notarized. The macOS menu shows “Electron” while running unpackaged.
- Native menu behavior is verified manually; the test driver must close a native popup before shutdown, and the automated suite does not cover popup interaction.
- Keyboard focus can move through shell chrome, but there is no command or focus indicator for entering native pane content yet. This is Phase 2 keyboard work.
- Zoom is not implemented. The application menu deliberately omits zoom roles so shell zoom cannot desynchronize CSS-pixel measurements from native DIP bounds.
- `npm audit` has 13 high-severity dev-toolchain advisories with no fixed `picomatch` release at verification time.
- TypeScript is pinned to 6.0.3 because current `typescript-eslint` does not support TypeScript 7.
- CI is configured but unexecuted in GitHub because the repository has not been pushed.

### Next smallest slice

Phase 1: formalize the secure browser/session foundation — finish the profile registry and shared-profile rules, harden navigation/error UI, and build deterministic per-pane integration tests for independent authentication and restart persistence on a local fixture origin. Do not begin the Phase 2 layout engine until Phase 1 exit criteria are verified.

## Phase 1 — Browser isolation foundation

- **Status:** Not started
- **Delivered:** —
- **Verification commands and results:** —
- **Known issues / risks:** —
- **Next smallest slice:** —

## Phase 2 — Workspace engine

- **Status:** Not started
- **Delivered:** —
- **Verification commands and results:** —
- **Known issues / risks:** —
- **Next smallest slice:** —

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
