# PaneFlow

**Multiple real browser sessions. One flexible workspace.**

PaneFlow is a local-first macOS desktop application for developers, designers, and QA teams who need to open, arrange, resize, and interact with multiple independent browser sessions at once.

> **Project status:** Phases 0–4 complete; the unsigned local macOS MVP is complete. The app is a working Electron/Vue browser workspace with isolated persistent sessions, a Canvas-only workspace with world-space snapping guides, a custom device menu and canvas context menu, native-aware view hiding, maximize/restore, native Pane-menu commands, per-pane viewport emulation, workspace persistence and management, safe window bounds, a profile manager, explicit shared-profile panes, persisted system/light/dark themes, unsigned arm64 macOS packaging, repeated-switch leak stress, close-and-delete profile lifecycle, workspace import/export, active-pane accessibility, automated Playwright/CDP/axe accessibility audits, a 50-cycle loaded-page soak, and a security-hardened shell/IPC/session boundary. Post-MVP hardening covers a VoiceOver/manual screen-reader pass, longer CPU/memory profiling, Windows/Linux packaging, and signed/notarized distribution once Apple Developer credentials exist. See [`SECURITY.md`](./SECURITY.md).

## Current capabilities

- Electron `BaseWindow` with a trusted Vue shell and native `WebContentsView` browser panes.
- Two browser panes by default; add, duplicate, and close panes dynamically. The quiet toolbar **+** control opens a custom device menu with responsive, iPhone, Samsung, Pixel, iPad, Galaxy Tab, desktop, and MacBook presets. Duplicates copy URL/viewport with a fresh profile.
- One persistent, internally generated browser profile per new pane.
- Independent navigation, back, forward, reload, loading, and load-error states.
- Per-pane native menu for back/forward/reload/DevTools/close.
- Retina-correct bounds synchronization verified at `devicePixelRatio: 2`.
- Denied popups, permissions, downloads, display capture, and device access for remote content; sandboxed browser views with no app bridge or Node access.
- Trusted shell served over a secure internal `paneflow://shell/` protocol with a production CSP that has no development network allowance, plus IPC sender document validation.
- Independent authenticated sessions on one local origin, with HttpOnly persistent cookies, localStorage, and IndexedDB isolated per profile and restored after restart.
- Canvas-only workspace: pane headers drag panes in world coordinates, with live edge/center alignment guides against neighboring panes.
- Pure TypeScript canvas and viewport helpers for frame sizing, world-space snapping, viewport validation, fit scaling, and minimap projection.
- Temporary maximize/restore with unrelated native views hidden and the prior arrangement preserved.
- Native **Pane** menu commands for add, close, reload active/all, and maximize, with an active pane inferred from shell/native focus.
- Custom in-shell **+** device menu and right-click canvas menu. When a menu overlaps a native pane, that pane's view is hidden and its snapshot remains; uncovered panes stay live. Menus support keyboard arrows, Enter, Escape, and click-outside dismissal, and the minimap hides while a menu is open.
- Per-pane viewport emulation with responsive, iPhone 15 Pro/Pro Max/SE, Samsung Galaxy S24/S24 Ultra, Google Pixel 8/8 Pro, iPad Pro 12.9″/Air, Samsung Galaxy Tab S9, laptop, MacBook Air, desktop, and custom width/height/DPR presets. New panes can start with any preset from the **+** menu. Page values are verified inside the fixture pages, and panes can use different presets simultaneously.
- Versioned workspace persistence: pane IDs, profile references, URLs, viewport settings, pane order, layout mode, world-coordinate canvas positions, and legacy grid/freeform fields restore after restart. Legacy arrangements are normalized to Canvas. Profile partitions and sessions are retained.
- Safe window restoration: normal bounds, maximized state, and full-screen state restore after restart when the saved normal bounds remain visible on a connected display.
- Hidden-inset macOS title bar: traffic lights sit inside the compact toolbar, the shell fills the full window content, and empty toolbar space drags the window.
- Compact single-row pane chrome that wraps only at narrow widths, with a frameless pane surface and a subtle active-pane outline.
- Canvas is the only workspace layout. It has a dotted infinite backdrop, background drag and Hand-tool panning, Space as a temporary Hand tool, draggable pane headers, world-space edge/center snapping with live guides, 25–200% wheel zoom around the cursor, a bottom-center zoom bar with step controls and a percentage menu, an always-visible native overview in the bottom-right, one-click Fit all panes, fit-on-open for each workspace, click-empty-canvas deselection, world-coordinate pane positions, and captured pane snapshots while the world moves. The overview shows the current viewport, focuses or recenters from a click, and collapses to a compact header. Page content stays interactive when the pane is fully visible; device bezels and pane frame resizing are not implemented.
- Custom **+** add menu and right-click canvas menu with the Herdr-inspired compact menu language: sections, monochrome icons, dimension/shortcut metadata, checked Hand/Appearance states, keyboard navigation, and Escape dismissal.
- Persisted System/Light/Dark theme from the toolbar appearance menu, custom canvas menu, and native View menu, with matching window chrome and shell tokens. Loaded website panes receive the effective appearance as a live `prefers-color-scheme` change without reloading.
- Atomic workspace writes with corrupt-file preservation, plus profile metadata reconciliation for referenced profile IDs.
- Profile manager dialog with creation dates, live pane usage, rename, and confirmed clear/delete. In-use profiles can be closed and deleted through a single explicit confirmation.
- Explicit shared-profile panes from the profile manager, with shared cookie/storage behavior and usage/count indicators. New panes still receive fresh profiles by default.
- Workspace manager for create, rename, duplicate, switch, delete, and secret-free import/export. Imported/duplicated workspaces receive fresh profiles.
- Repeated workspace-switch stress coverage that verifies webContents and native-view cleanup against a baseline, with a configurable loaded-page soak (50 cycles observed).
- Automated accessibility coverage for the shell toolbar, pane cards, profile dialog, and workspace dialog: accessible roles and names, focus order and visible focus, dialog focus traps and focus return, Chromium CDP accessibility-tree checks, and axe-core WCAG/best-practice audits. Axe is injected through CDP because the production CSP deliberately blocks inline scripts.
- Deterministic local fixture server, unit tests, and two Playwright Electron tests covering Canvas snapping, the custom add/context menus, device presets, native-view hiding under menus, viewport emulation, a full workspace/session restart, profile-manager lifecycle checks, workspace management, and the accessibility audit.

The current build does **not** include optional user-agent overrides, background-warm workspace switching, or signed/notarized distribution. See the roadmap in [`SPEC.md`](./SPEC.md).

## Development prerequisites

- macOS for the initial development target.
- Git.
- Node.js 24 (use the version in `.nvmrc`).
- npm.
- GNU Make (included with the macOS developer tools).
- [OpenCode 2](https://opencode.ai/) installed and configured with a coding model.

The verified environment is Node 24.22.3, npm 11.19.1, Electron 45.3.4, and macOS 27.2.1 on Apple silicon.

## Run PaneFlow

```bash
nvm use
make dev
```

`make dev` checks the Node.js version, installs dependencies when `package.json` or `package-lock.json` has changed, downloads the Electron runtime when needed, and starts a local fixture server on a random loopback port. Two panes open with independent fixture sessions (`alice` and `bob`) that display their per-profile cookie, localStorage, viewport, and device pixel ratio. Open `/login` in a pane to try the fixture's independent authenticated sessions.

To preview the production build instead, run `make start`. Run `make` or `make help` to list every target. A separate `npm install` is not normally required; use `make install` to force a clean reinstall.

## Commands

| Make target | npm script | Purpose |
| --- | --- | --- |
| `make dev` | `npm run dev` | Fixture server + electron-vite development app |
| `make start` | `npm run start` | Build and preview the app through electron-vite |
| `make build` | `npm run build` | Build main, preload, and renderer into `out/` |
| `make typecheck` | `npm run typecheck` | Strict TypeScript check for node and renderer code |
| `make lint` | `npm run lint` | ESLint across source, tests, and scripts |
| `make check-contrast` | `npm run check:contrast` | WCAG contrast checks for light/dark design tokens |
| `make test-unit` | `npm run test:unit` | Vitest unit tests |
| `make test` | `npm run test:unit` | Alias for the unit suite |
| `make test-e2e` | `npm run test:e2e` | Build, then run the Playwright Electron integration test |
| `make check` | — | Typecheck, lint, unit tests, and contrast checks |
| `make package` | — | Build the unpacked arm64 `.app` (alias for `package-dir`) |
| `make package-mac` | `npm run package:mac` | Build an unsigned arm64 DMG + ZIP under `dist/` |
| `make package-dir` | `npm run package:dir` | Build the unpacked arm64 `.app` under `dist/` |
| `make install` | — | Force `npm ci` and an Electron runtime install |

## Packaging

`npm run package:mac` produces `dist/PaneFlow-0.1.0-arm64.dmg`, a matching ZIP, and `dist/mac-arm64/PaneFlow.app`. The bundle uses `com.kanharithsok.paneflow`, is arm64-only, and is **unsigned/ad-hoc**. It is suitable for local verification, not notarized distribution. Gatekeeper may block it on other machines until it is signed with a Developer ID Application certificate and notarized.

Packaging applies Electron fuses that disable `ELECTRON_RUN_AS_NODE`, Node options and inspector arguments, and `file://` extra privileges, while enabling ASAR integrity validation and load-only-from-ASAR. These controls reduce accidental local privilege paths; they do not replace code signing. See [`SECURITY.md`](./SECURITY.md) for the threat model and the full packaging checklist.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+T` | Add responsive pane |
| `Cmd/Ctrl+D` | Duplicate active pane |
| `Cmd/Ctrl+Shift+W` | Close active pane |
| `Cmd/Ctrl+Alt+R` | Reload active pane |
| `Cmd/Ctrl+Alt+Shift+R` | Reload all panes |
| `Cmd/Ctrl+Shift+M` | Toggle maximize for active pane |
| `Cmd/Ctrl+Shift+]` | Next workspace |
| `Cmd/Ctrl+Shift+[` | Previous workspace |

Workspace cycling follows workspace name order, wraps at either end, and restores the target workspace's saved panes and layout. Both items are disabled when only one workspace exists. The active pane follows shell chrome focus and native pane focus. Shortcuts are registered through the native Pane and Workspace menus.

## Testing

```bash
make check
make test-e2e
```

The e2e tests launch the built app against local fixtures and verify:

- two panes with distinct persistent profiles and isolated cookies/localStorage/IndexedDB;
- two independent fixture accounts signed in on the same origin, HttpOnly session cookies, and logout isolation;
- no `window.paneflow`, `require`, or `process` in remote pages;
- shell CSP blocking inline script and cross-origin fetch, the internal shell protocol, and rejection of IPC from a separate node-enabled webContents;
- blocked remote `file:`/`data:` navigation, denied popups and notifications;
- Canvas-only startup, persistent overview, pane-header dragging, world-space edge/center snapping, and guide cleanup;
- custom **+** device menu creation, section/dimension rendering, Escape dismissal, and selected-preset verification;
- right-click canvas menu actions for adding a pane, toggling Hand mode, and switching appearance;
- native view hiding only where a menu overlaps, with live views restored after close;
- native view bounds matching shell content rectangles before and after window resize;
- temporary maximize/restore with unrelated native views hidden;
- menu command routing for add/close/maximize actions;
- next/previous workspace menu shortcuts with stable IDs, accelerator discovery, enabled-state updates, and restored pane identity;
- real address-bar navigation and history controls;
- rejecting unsupported URLs and unknown pane IDs in main;
- pane close destroying its `webContents` without touching the other pane;
- fresh profiles for new panes;
- authenticated sessions, persistent cookies, localStorage, and profile IDs surviving an app restart;
- accessible roles, names, tooltips, dialog descriptions, and expanded states for the shell toolbar, pane cards, profile dialog, and workspace dialog;
- keyboard tab order across toolbar and pane chrome, visible 2 px focus outlines, active-pane `aria-current`, dialog focus trapping, Escape handling, and focus return to the trigger;
- Chromium's CDP accessibility tree and axe-core WCAG 2.0/2.1/2.2 A/AA plus best-practice audits for the shell and both dialogs.

For a longer loaded-page soak:

```bash
npm run build
PANEFLOW_STRESS_CYCLES=50 npx playwright test tests/e2e/browser-panes.spec.ts
```

The observed 50-cycle run on `main` after the final merge took about 20 s, returned to 2 non-destroyed webContents after every cycle, and sampled whole-app working set at 589 MB before and 684 MB after. Earlier runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB. It is a switch soak, not a peak, per-process, multi-hour, or third-party-page profile.

The Playwright tests require a local macOS GUI session. Unit tests include the pure layout engine. The CI workflow runs typecheck, lint, contrast, unit tests, and build; e2e remains a local check until headless Electron execution is proven.

## Architecture

The trusted shell is a `WebContentsView` filling a `BaseWindow`. Each browser pane is another `WebContentsView` stacked above it, bounded exactly to a content placeholder in the shell. Pane chrome stays outside native browser bounds. Custom Canvas menus live in the shell; when a menu overlaps native content, the intersecting pane views are hidden and their snapshots remain, while uncovered panes stay live. Native `Menu.popup` remains for pane actions and app-level commands. Bounds are measured in CSS pixels/DIP in the renderer, validated and clamped in the main process, and applied without multiplying by `devicePixelRatio`.

Canvas math lives in the pure TypeScript modules under `src/shared/canvas.ts`, `src/shared/minimap.ts`, `src/shared/viewports.ts`, and `src/shared/zoom.ts`; viewport presets, validation, fit-scale math, zoom bounds, and zoom action parsing also live in those modules. The shell keeps world positions, pan, and zoom, hides native views that are partially off-screen or under an open menu, and restores them when fully visible. Pane headers drag frames; neighboring edges and centers produce live alignment guides. Maximize is temporary renderer state layered over the current arrangement. The Canvas global bar exposes active-pane navigation and viewport controls; fixed viewports always fit the pane, and main re-applies the fit scale when native bounds change. A trusted native zoom bar at the bottom center sends step, preset, Fit all, and Reset actions through validated IPC; its percentage menu is the standard in-shell menu rendered above the bar. Each workspace opens fitted to its panes, and a primary click on empty canvas clears the active pane. `WorkspaceStore` persists validated pane references and renderer-owned canvas state into versioned JSON with atomic writes, while legacy grid/freeform fields are accepted and migrated. A trusted **Profiles** dialog lists profile usage, manages rename/clear/delete, and can explicitly open a pane with an existing profile while native views are hidden. Theme choices are available from the toolbar, the custom canvas menu, and the native **View → Theme** menu; main applies the effective color scheme to native chrome, shell tokens, and loaded website panes. A **Workspaces** dialog creates, renames, duplicates, switches, and deletes saved workspaces with fresh profiles on duplication. Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), the decisions in [`docs/DECISIONS.md`](./docs/DECISIONS.md), and the Phase evidence in [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md).

## Start with OpenCode

From the repository root:

```bash
opencode
```

Useful commands:

- `/start` — complete or verify Phase 0 only.
- `/next` — implement the next small, complete vertical slice.
- `/verify` — run the available checks and report exact results.
- `/review` — request a read-only code/security/UI review.

OpenCode discovers `AGENTS.md`, `.opencode/agents/`, `.opencode/skills/`, and `.opencode/commands/` automatically. Do not copy these instructions into every prompt.

## Repository map

```text
.github/              GitHub Actions CI
.opencode/            Project agents, skills, and slash commands
docs/                 Architecture, decisions, manual checks, phase reports
Makefile              Developer commands with toolchain and dependency checks
SECURITY.md           Threat boundaries and local-distribution checklist
scripts/              Development launcher
src/main/             Electron lifecycle, native views, IPC, profiles
src/preload/          Minimal typed shell bridge
src/renderer/         Vue shell and pane chrome
src/shared/           Pure URL, geometry, profile, and IPC types
tests/                Unit, integration, and fixture code
AGENTS.md             Persistent coding-agent rules
SPEC.md               Product and engineering specification
opencode.jsonc        Project-level OpenCode configuration
```

## Known limitations

- New panes receive fresh profiles by default; sharing requires the profile manager's Open pane action.
- Shared-profile panes intentionally share cookies and site storage.
- Workspace switching destroys and recreates native pane views, so pages reload rather than staying warm in the background.
- Active-pane chrome is indicated by a subtle accent outline and `aria-current`; dialog triggers expose expanded state. Automated axe/role/AX checks cover the shell, custom menus, and dialogs, but VoiceOver order/announcements, focus-ring usability, and minimum-window toolbar layout still need a manual pass.
- Workspace import/export transfers configuration only; imported panes receive fresh profiles and require sign-in again. Native file dialogs are not automated by e2e.
- Leak coverage includes a configurable switch soak (up to 50 cycles observed: 2 webContents, working set 589 MB → 684 MB on final `main`; earlier runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB). Working set is sampled before/after rather than peak/per-process; multi-hour CPU/memory and heavy third-party page profiling are not yet run.
- Canvas has 25–200% zoom but no device-bezel or frame-resize controls yet. Dragging a pane header repositions that frame with edge/center snapping guides; website content stays interactive. Panning and Hand mode replace native pages with recent snapshots. At zoom levels where a frame no longer fits fully inside the workspace, its native view is hidden and the snapshot remains until the frame fits again. Selecting a partially visible pane centers it; clicking empty canvas clears the active pane until another pane or pane chrome is used. The bottom-center zoom bar is a trusted native overlay with zoom-out/zoom-in steps and a percentage menu for 25–200%, Fit all, and Reset; it hides while a shell menu or dialog is open. The overview is a small trusted native view pinned to the bottom-right, always visible in Canvas without a reveal action; it adapts between 168 and 208 px wide, collapses to its header, and can cover a small part of the pane beneath it, but covered panes stay live outside that corner. The custom + and right-click menus hide only the native panes they overlap, showing those snapshots until the menu closes. Use Fit all panes in the Canvas global bar, the overview header, or the zoom menu for one-click recovery. Space activates the Hand tool only while shell chrome has focus; a focused website keeps normal keyboard input.
- Viewport emulation sets CSS dimensions and DPR only; it does not spoof user agents, touch, GPS, or other device APIs.
- Fixed viewport panes in Canvas are sized to their declared CSS dimensions; very large devices can extend beyond the visible workspace until you zoom out or fit all.
- Window position, size, maximized state, and full-screen state restore when the saved normal bounds remain visible on a current display. Minimized and focused state are not restored.
- Raw keyboard accelerators are configured in the native menu; menu command routing is tested, raw key chords are not yet automated.
- Canvas positions, pane order, viewport settings, and URLs restore after restart. Legacy grid/freeform files are migrated to Canvas. Unused profiles remain available in the profile manager for rename/clear/delete.
- Clearing/deleting an in-use profile closes all panes that use it after explicit confirmation.
- Overlapping canvas panes can cover each other's headers; use the overview or Fit all to locate and recover them.
- Browser panes share the app's Chromium runtime. Profiles isolate session data, but panes are not separate browser installations or OS sandboxes.
- Remote HTTP addresses are not visually distinguished from HTTPS yet; this remains a known security-UI gap.
- If a website closes its own browser view, the pane is removed safely but without an explanatory notice yet.
- Some identity providers and sites may block Electron user agents or behave differently from Chrome/Safari.
- Session-only cookies and `sessionStorage` are not guaranteed to survive pane recreation or an app restart.
- Packaging is arm64-only and unsigned/ad-hoc; Developer ID signing, notarization, stapling, cookie encryption at rest, automatic updates, extensions, DRM, and cloud sync remain outside the MVP.
- Workspace exports include pane URLs and therefore any query strings in them. Do not sign in through or store secret-bearing URLs when sharing an export.
- `npm audit --omit=dev` reports 0 runtime vulnerabilities. `npm audit` reports 6 moderate development-toolchain advisories in `minimatch` via `electron-builder`/`@electron/universal`; the offered fix is a breaking downgrade, so it is tracked rather than applied.

See section 21 of [`SPEC.md`](./SPEC.md) and [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md) for details.

## License

MIT. See [`LICENSE`](./LICENSE).
