# PaneFlow

**Multiple real browser sessions. One flexible workspace.**

PaneFlow is a local-first macOS desktop application for developers, designers, and QA teams who need to open, arrange, resize, and interact with multiple independent browser sessions at once.

> **Project status:** Phases 0–4 complete; the unsigned local macOS MVP is complete. The app is a working Electron/Vue browser workspace with isolated persistent sessions, grid and freeform layouts, native-aware scrolling, drag reorder, resize/snapping, z-order, maximize/restore, native Pane-menu commands, per-pane viewport emulation, workspace persistence and management, safe window bounds, a profile manager, explicit shared-profile panes, persisted system/light/dark themes, unsigned arm64 macOS packaging, repeated-switch leak stress, close-and-delete profile lifecycle, workspace import/export, active-pane accessibility, automated Playwright/CDP/axe accessibility audits, a 50-cycle loaded-page soak, and a security-hardened shell/IPC/session boundary. Post-MVP hardening covers a VoiceOver/manual screen-reader pass, longer CPU/memory profiling, Windows/Linux packaging, and signed/notarized distribution once Apple Developer credentials exist. See [`SECURITY.md`](./SECURITY.md).

## Current capabilities

- Electron `BaseWindow` with a trusted Vue shell and native `WebContentsView` browser panes.
- Two browser panes by default; add, duplicate, and close panes dynamically. The toolbar add control includes a device-size dropdown that creates a pane with the selected viewport. Duplicates copy URL/viewport with a fresh profile.
- One persistent, internally generated browser profile per new pane.
- Independent navigation, back, forward, reload, loading, and load-error states.
- Per-pane native menu for back/forward/reload/DevTools/close.
- Retina-correct bounds synchronization verified at `devicePixelRatio: 2`.
- Denied popups, permissions, downloads, display capture, and device access for remote content; sandboxed browser views with no app bridge or Node access.
- Trusted shell served over a secure internal `paneflow://shell/` protocol with a production CSP that has no development network allowance, plus IPC sender document validation.
- Independent authenticated sessions on one local origin, with HttpOnly persistent cookies, localStorage, and IndexedDB isolated per profile and restored after restart.
- Pure TypeScript layout engine for grid placement/reflow, normalized freeform geometry, clamping, snapping, ordering, and maximize/restore, with 33 unit tests.
- Engine-driven grid mode with a compact 1–5 column selector, equal-width reflow, native bounds alignment, and add/remove reflow.
- Native-aware vertical grid scrolling: partially off-screen panes hide their browser view so it cannot cover chrome or escape the workspace.
- Grid drag reordering from the pane title row, with native views temporarily hidden so pointer movement stays in the shell.
- Freeform mode with normalized pane geometry, title-row dragging, eight resize handles, snapping guides, explicit bring-front/send-back controls, and a Tidy action.
- Temporary maximize/restore with unrelated native views hidden and the prior arrangement preserved.
- Native **Pane** menu commands for add, close, reload active/all, maximize, and grid/freeform toggle, with an active pane inferred from shell/native focus.
- Per-pane viewport emulation with responsive, mobile, tablet, laptop, and desktop presets, custom width/height/DPR, and automatic fit-to-pane scaling. New panes can start with a preset from the add-pane device dropdown. Page values are verified inside the fixture pages, and panes can use different presets simultaneously.
- Versioned workspace persistence: pane IDs, profile references, URLs, viewport settings, grid columns/order, grid/freeform mode, and freeform geometry restore after restart. Profile partitions and sessions are retained.
- Safe window restoration: normal bounds, maximized state, and full-screen state restore after restart when the saved normal bounds remain visible on a connected display.
- Hidden-inset macOS title bar: traffic lights sit inside the compact toolbar, the shell fills the full window content, and empty toolbar space drags the window.
- Compact single-row pane chrome that wraps only at narrow widths, with a frameless pane surface and a subtle active-pane outline.
- Canvas layout with a dotted infinite backdrop, background drag and Hand-tool panning, Space as a temporary Hand tool, draggable pane headers, 50–200% wheel zoom around the cursor, world-coordinate pane positions, and captured pane snapshots while the world moves. Page content stays interactive when the pane is fully visible; device bezels are not implemented yet.
- Persisted System/Light/Dark theme from the toolbar appearance menu and native View menu, with matching window chrome and shell tokens. Loaded website panes receive the effective appearance as a live `prefers-color-scheme` change without reloading.
- Temporary pane-chrome preview in the Add pane chevron menu: Quiet bar, Canvas label, or Global bar. The preview applies to all panes; Quiet bar is the default.
- Atomic workspace writes with corrupt-file preservation, plus profile metadata reconciliation for referenced profile IDs.
- Profile manager dialog with creation dates, live pane usage, rename, and confirmed clear/delete. In-use profiles can be closed and deleted through a single explicit confirmation.
- Explicit shared-profile panes from the profile manager, with shared cookie/storage behavior and usage/count indicators. New panes still receive fresh profiles by default.
- Workspace manager for create, rename, duplicate, switch, delete, and secret-free import/export. Imported/duplicated workspaces receive fresh profiles.
- Repeated workspace-switch stress coverage that verifies webContents and native-view cleanup against a baseline, with a configurable loaded-page soak (50 cycles observed).
- Automated accessibility coverage for the shell toolbar, pane cards, profile dialog, and workspace dialog: accessible roles and names, focus order and visible focus, dialog focus traps and focus return, Chromium CDP accessibility-tree checks, and axe-core WCAG/best-practice audits. Axe is injected through CDP because the production CSP deliberately blocks inline scripts.
- Deterministic local fixture server, unit tests, and two Playwright Electron tests including an eight-pane alignment/freeform stress pass, viewport-emulation checks, a full workspace/session restart, profile-manager lifecycle checks, workspace management, and the accessibility audit.

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

The Add pane chevron menu also contains a temporary **Pane chrome preview** section with Quiet bar (default), Canvas label, and Global bar. The choice applies to all panes and is stored locally for comparison; it is not a final product preference yet.

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
| `Cmd/Ctrl+Shift+L` | Toggle grid/freeform |
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
- native view bounds matching shell content rectangles before and after window resize;
- 2/5/1-column grid reflow with native bounds alignment at every step;
- drag reordering with native views hidden during drag and alignment restored afterward;
- freeform move/resize with hidden native views and preserved geometry across mode switches;
- temporary maximize/restore with unrelated native views hidden;
- explicit freeform z-order changes reflected in native child order;
- menu command routing for add/close/maximize/layout actions;
- next/previous workspace menu shortcuts with stable IDs, accelerator discovery, enabled-state updates, and restored pane identity;
- an eight-pane grid/freeform alignment stress pass;
- overflowing grid scrolling with native views hidden when partially off-screen;
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

The trusted shell is a `WebContentsView` filling a `BaseWindow`. Each browser pane is another `WebContentsView` stacked above it, bounded exactly to a content placeholder in the shell. Pane chrome stays outside native browser bounds; native `Menu.popup` is used when a menu must cover a website. Bounds are measured in CSS pixels/DIP in the renderer, validated and clamped in the main process, and applied without multiplying by `devicePixelRatio`.

Layout math lives in a pure TypeScript engine under `src/shared/layout.ts`, and viewport presets, validation, and fit-scale math live in `src/shared/viewports.ts`. Grid mode positions pane cards from engine results, scrolls to the engine content height, hides native views when panes are only partially visible, and temporarily hides all native views while dragging/reordering. Freeform mode stores normalized per-pane geometry, uses a shell inset for resize handles, and preserves separate grid/freeform arrangements. Maximize is temporary renderer state layered over the current arrangement. A native Pane menu routes typed commands to the active pane. Pane headers expose viewport preset and custom size controls; fixed viewports always fit the pane, and the main process re-applies the fit scale when native bounds change. `WorkspaceStore` persists validated pane references and renderer-owned layout state into versioned JSON with atomic writes. A trusted **Profiles** dialog lists profile usage, manages rename/clear/delete, and can explicitly open a pane with an existing profile while native views are hidden. Theme choices are available from the toolbar appearance menu and the native **View → Theme** menu; main applies the effective color scheme to native chrome, shell tokens, and loaded website panes. The temporary pane-chrome preview is selectable from the Add pane chevron menu. A **Workspaces** dialog creates, renames, duplicates, switches, and deletes saved workspaces with fresh profiles on duplication. Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), the decisions in [`docs/DECISIONS.md`](./docs/DECISIONS.md), and the Phase evidence in [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md).

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
- Active-pane chrome is indicated by a subtle accent outline and `aria-current`; dialog triggers expose expanded state, and the toolbar stays overflow-free at the tested 760 px width. Automated axe/role/AX checks cover the shell and dialogs, but VoiceOver order/announcements and focus-ring usability still need a manual pass.
- Workspace import/export transfers configuration only; imported panes receive fresh profiles and require sign-in again. Native file dialogs are not automated by e2e.
- Leak coverage includes a configurable loaded-page switch soak (up to 50 cycles observed: 2 webContents, working set 589 MB → 684 MB on final `main`; earlier runs measured 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB). Working set is sampled before/after rather than peak/per-process; multi-hour CPU/memory and heavy third-party page profiling are not yet run.
- Canvas mode has 50–200% zoom but no device-bezel or frame-resize controls yet. Dragging a pane header repositions that frame; website content stays interactive. Panning and Hand mode replace native pages with recent snapshots. At zoom levels where a frame no longer fits fully inside the workspace, its native view is hidden and the snapshot remains until the frame fits again. Selecting a partially visible pane centers it. Space activates the Hand tool only while shell chrome has focus; a focused website keeps normal keyboard input.
- Viewport emulation sets CSS dimensions and DPR only; it does not spoof user agents, touch, GPS, or other device APIs.
- In actual display mode, an emulated viewport larger than its pane is clipped; pane-level panning/scrolling of the emulated surface is not implemented.
- Window position, size, maximized state, and full-screen state restore when the saved normal bounds remain visible on a current display. Minimized and focused state are not restored.
- Partially visible grid panes are hidden while scrolling and only become interactive when fully in view.
- A fully covered freeform pane may be unreachable until the covering pane moves.
- Raw keyboard accelerators are configured in the native menu; menu command routing is tested, raw key chords are not yet automated.
- Freeform geometry, selected columns, grid order, layout mode, viewport settings, pane order, and URLs now restore after restart. Unused profiles remain available in the profile manager for rename/clear/delete.
- Clearing/deleting an in-use profile closes all panes that use it after explicit confirmation.
- Overlapping freeform panes can cover each other's headers and far resize handles; move the covering pane or use a reachable control.
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
