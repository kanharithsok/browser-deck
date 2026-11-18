# PaneFlow

**Multiple real browser sessions. One flexible workspace.**

PaneFlow is a local-first macOS desktop application for developers, designers, and QA teams who need to open, arrange, resize, and interact with multiple independent browser sessions at once.

> **Project status:** Phases 0 and 1 complete; Phase 2 in progress. The repo contains a working Electron/Vue native-view spike with two isolated persistent browser panes, independent authenticated sessions, editable address chrome, and window resizing. Grid mode has a 1–5 column selector, scrolling, and drag reorder; freeform mode supports move/resize, snapping, z-order raising, tidy, and temporary maximize/restore. Explicit send-to-back controls, keyboard layout actions, and the 8-pane exit test remain. Viewport emulation and packaging arrive in later phases.

## Current capabilities

- Electron `BaseWindow` with a trusted Vue shell and native `WebContentsView` browser panes.
- Two browser panes by default; add and close panes dynamically.
- One persistent, internally generated browser profile per new pane.
- Independent navigation, back, forward, reload, loading, and load-error states.
- Per-pane native menu for back/forward/reload/DevTools/close.
- Retina-correct bounds synchronization verified at `devicePixelRatio: 2`.
- Denied popups, permissions, and downloads for remote content; sandboxed browser views with no app bridge or Node access.
- Independent authenticated sessions on one local origin, with HttpOnly persistent cookies, localStorage, and IndexedDB isolated per profile and restored after restart.
- Pure TypeScript layout engine for grid placement/reflow, normalized freeform geometry, clamping, snapping, ordering, and maximize/restore, with 33 unit tests.
- Engine-driven grid mode with a compact 1–5 column selector, equal-width reflow, native bounds alignment, and add/remove reflow.
- Native-aware vertical grid scrolling: partially off-screen panes hide their browser view so it cannot cover chrome or escape the workspace.
- Grid drag reordering from the pane title row, with native views temporarily hidden so pointer movement stays in the shell.
- Freeform mode with normalized pane geometry, title-row dragging, eight resize handles, snapping guides, z-order raising, and a Tidy action.
- Temporary maximize/restore with unrelated native views hidden and the prior arrangement preserved.
- Deterministic local fixture server, unit tests, and a Playwright Electron integration test.

The current build does **not** include explicit send-to-back controls, keyboard layout actions, workspace persistence, viewport presets, profile management UI, or macOS packaging. See the roadmap in [`SPEC.md`](./SPEC.md).

## Development prerequisites

- macOS for the initial development target.
- Git.
- Node.js 24 (use the version in `.nvmrc`).
- npm.
- [OpenCode 2](https://opencode.ai/) installed and configured with a coding model.

The verified environment is Node 24.22.3, npm 11.19.1, Electron 45.3.4, and macOS 27.2.1 on Apple silicon.

## Run PaneFlow

```bash
nvm use
npm install
npm run dev
```

`npm run dev` starts a local fixture server on a random loopback port and launches electron-vite. Two panes open with independent fixture sessions (`alice` and `bob`) that display their per-profile cookie, localStorage, viewport, and device pixel ratio. Open `/login` in a pane to try the fixture's independent authenticated sessions.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Fixture server + electron-vite development app |
| `npm run build` | Build main, preload, and renderer into `out/` |
| `npm run start` | Preview the built app through electron-vite |
| `npm run typecheck` | Strict TypeScript check for node and renderer code |
| `npm run lint` | ESLint across source, tests, and scripts |
| `npm run test:unit` | Vitest unit tests |
| `npm run test` | Alias for the unit suite |
| `npm run test:e2e` | Build, then run the Playwright Electron integration test |

`package:mac` is not implemented yet; it is Phase 4 work. Do not treat a build as a distributable macOS app.

## Testing

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e
```

The e2e test launches the built app against local fixtures and verifies:

- two panes with distinct persistent profiles and isolated cookies/localStorage/IndexedDB;
- two independent fixture accounts signed in on the same origin, HttpOnly session cookies, and logout isolation;
- no `window.paneflow`, `require`, or `process` in remote pages;
- denied popups and notifications;
- native view bounds matching shell content rectangles before and after window resize;
- 2/5/1-column grid reflow with native bounds alignment at every step;
- drag reordering with native views hidden during drag and alignment restored afterward;
- freeform move/resize with hidden native views and preserved geometry across mode switches;
- temporary maximize/restore with unrelated native views hidden;
- overflowing grid scrolling with native views hidden when partially off-screen;
- real address-bar navigation and history controls;
- rejecting unsupported URLs and unknown pane IDs in main;
- pane close destroying its `webContents` without touching the other pane;
- fresh profiles for new panes;
- authenticated sessions, persistent cookies, localStorage, and profile IDs surviving an app restart.

The Playwright suite requires a local macOS GUI session. Unit tests include the pure layout engine. The CI workflow is configured to run typecheck, lint, unit tests, and build; e2e remains a local check until headless Electron execution is proven.

## Architecture

The trusted shell is a `WebContentsView` filling a `BaseWindow`. Each browser pane is another `WebContentsView` stacked above it, bounded exactly to a content placeholder in the shell. Pane chrome stays outside native browser bounds; native `Menu.popup` is used when a menu must cover a website. Bounds are measured in CSS pixels/DIP in the renderer, validated and clamped in the main process, and applied without multiplying by `devicePixelRatio`.

Layout math lives in a pure TypeScript engine under `src/shared/layout.ts`. Grid mode positions pane cards from engine results, scrolls to the engine content height, hides native views when panes are only partially visible, and temporarily hides all native views while dragging/reordering. Freeform mode stores normalized per-pane geometry, uses a shell inset for resize handles, and preserves separate grid/freeform arrangements. Maximize is temporary renderer state layered over the current arrangement. Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), the decisions in [`docs/DECISIONS.md`](./docs/DECISIONS.md), and the Phase evidence in [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md).

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

- The workspace still lacks explicit send-to-back controls, keyboard layout actions, viewport emulation, and a profile manager.
- Partially visible grid panes are hidden while scrolling and only become interactive when fully in view.
- Freeform manipulation is pointer-only; a fully covered pane may be unreachable until the covering pane moves.
- Maximize is temporary and not persisted.
- Freeform geometry, selected columns, grid order, and layout mode reset on restart until workspace persistence arrives.
- Browser panes share the app's Chromium runtime. Profiles isolate session data, but panes are not separate browser installations or OS sandboxes.
- Remote HTTP addresses are not visually distinguished from HTTPS yet; this remains a known security-UI gap.
- If a website closes its own browser view, the pane is removed safely but without an explanatory notice yet.
- Some identity providers and sites may block Electron user agents or behave differently from Chrome/Safari.
- Session-only cookies and `sessionStorage` are not guaranteed to survive pane recreation or an app restart.
- Automatic updates, code signing, notarization, extensions, DRM, and cloud sync remain outside the MVP.
- `npm audit` currently reports high-severity advisories in the development toolchain (`picomatch` via Vite/Vitest/ESLint). No fixed release was available at the time of the Phase 0 report.

See section 21 of [`SPEC.md`](./SPEC.md) and [`docs/PHASE_REPORTS.md`](./docs/PHASE_REPORTS.md) for details.

## License

No license has been selected. Do not assume the repository is open-source licensed merely because it is public. Add a license only after the repository owner chooses one.
