# PaneFlow — Product and Engineering Specification

**Document role:** Product and engineering source of truth  
**Status:** MVP specification  
**Initial platform:** macOS  
**Future platforms:** Windows and Linux  
**Product category:** Multi-browser desktop workspace

> This document defines what PaneFlow must do and the engineering constraints that shape it. Repository-wide coding-agent behavior belongs in `AGENTS.md`; OpenCode-specific workflows belong in `.opencode/`.

---

## 1. Product vision

PaneFlow is a local-first desktop application for opening multiple independent, interactive browser sessions in one flexible workspace. Users can arrange browser panes on an infinite canvas, snap them to each other, emulate different viewport sizes, and save reusable workspaces.

PaneFlow is intended for frontend developers, designers, QA engineers, agencies, and teams that need to compare websites, environments, accounts, roles, themes, or responsive layouts side by side.

**Core promise: multiple real browser sessions, one organized workspace.**

PaneFlow is not a screenshot viewer, a collection of iframes, or a static responsive preview. Every pane must display a real interactive website in Chromium, navigate independently, and use an isolated browser profile by default.

## 2. Product principles

1. **Isolation by default:** a new pane gets its own browser profile. Sharing a profile requires an explicit user action.
2. **Flexible workspace:** pane count and arrangement are user-controlled. Never hardcode an 8- or 10-pane product limit.
3. **Minimal UI:** the websites and workspace are the primary content; application chrome stays compact and quiet.
4. **Predictability:** navigation, dragging, resizing, snapping, focus, and persistence behave consistently.
5. **Local-first:** workspace configuration and browser profiles remain on the user's machine. The MVP requires no account, cloud service, or hosted browser infrastructure.
6. **Honest emulation:** viewport/device emulation is not a physical device, a separate browser engine, or a perfect reproduction of hardware.
7. **Secure by design:** remote websites are untrusted and never receive PaneFlow's privileged application APIs.
8. **Measured performance:** design for a practical multi-pane workload and measure resource use; do not promise unlimited capacity.
9. **Useful before clever:** deliver a reliable browser workspace before adding automation, analytics, collaboration, or AI features.

## 3. Target users and primary use cases

- **Frontend developers:** compare localhost, staging, and production; inspect different signed-in users, roles, or tenant themes.
- **Designers:** compare responsive layouts, themes, and design variations side by side.
- **QA engineers:** test permissions, workflows, account states, and browser behavior in parallel.
- **Agencies:** inspect several client websites or environments in one workspace.
- **E-commerce teams:** compare multiple storefronts, product configurations, and customer experiences.

Representative use cases:

- Open the same SaaS application as 8 different users, each with separate authentication.
- Compare one website at mobile, tablet, laptop, and desktop viewport sizes.
- Keep development, staging, and production open together.
- Arrange a flexible wall of client websites and save it as a workspace.

## 4. Platform and product boundaries

### 4.1 Platform strategy

- Build and validate macOS first.
- Keep platform-specific code isolated so Windows and Linux can be added later.
- Do not delay a working macOS MVP to support unvalidated platforms.
- Do not claim Windows/Linux support until the application has been built and tested on native runners for those platforms.

### 4.2 Browser engine

- Use the Chromium runtime bundled with Electron.
- Multiple panes share the application's Chromium runtime/process architecture, but use separate Electron `Session` objects by default.
- Do not describe panes as separate Chrome installations or separate browser engines.
- Pane isolation applies to session data and `WebContents` navigation state; it is not an operating-system security boundary between websites.

### 4.3 MVP product boundary

PaneFlow is a desktop workspace for real browser sessions. It is not intended to replace a full daily-use browser, a browser automation platform, or a cloud device farm.

---

## 5. MVP scope

### 5.1 Must ship

- A runnable macOS desktop application.
- Multiple real interactive browser panes in one application window.
- A distinct persistent browser profile/session for each newly created pane by default.
- Independent URL navigation, back, forward, reload, loading, and error states.
- Add, close, rename, and duplicate panes.
- Pane duplication uses a fresh isolated profile by default.
- Canvas-only workspace with world-coordinate pane placement and header dragging.
- World-space snapping to neighboring pane edges and centers, with visible alignment guides.
- Maximize/focus and restore a pane.
- Per-pane viewport presets, including popular phones, tablets, laptops, and desktops, plus custom dimensions.
- A compact **+** add control with a device picker, and a right-click canvas context menu for adding panes and common workspace settings.
- Save, restore, duplicate, rename, switch, and delete workspaces.
- Persistent browser profile data across normal application restarts.
- Profile management, including clear and delete operations with confirmation.
- Secure IPC boundary and safe URL/navigation handling.
- Unit tests for layout, URL handling, validation, and persistence logic.
- Integration tests for browser session isolation.
- Minimal, clean UI with system/light/dark appearance support.
- A working macOS packaging/build command for local testing.

### 5.2 After MVP / optional roadmap

These are useful product extensions, but must not delay the core MVP:

- URL templates: replace the hostname while keeping a shared path/query pattern across selected panes.
- Synchronized navigation across selected panes.
- Synchronized scrolling across selected panes.
- Workspace export/import with fresh profiles on import.
- Capture screenshots of one pane or the whole workspace.
- Side-by-side screenshot comparison or visual diffing.
- Aggregated console and network inspection.
- More advanced profile management and reusable profile templates.
- Team sharing or cloud synchronization.
- Browser automation and scripted journeys.
- Built-in AI features.

Only implement these when requested or after the MVP is stable and there is a clear product reason.

### 5.3 Explicitly out of MVP

- Browser extensions or an extension store.
- Widevine/DRM support.
- Multiple tabs inside a pane.
- Cloud accounts, collaboration, or hosted browser infrastructure.
- Automatic updates, code signing, notarization, and public release automation.
- Perfect physical-device simulation or multiple browser engines.
- Automated visual regression as a required workflow.
- Built-in AI features.
- A remote browser service or server-side browser fleet.

Do not silently add out-of-scope features.

---

## 6. UX and visual design

### 6.1 Design direction

PaneFlow must have a **minimal, clean, calm, and developer-focused interface**. It is a desktop tool, not an analytics dashboard or marketing website.

Visual principles:

- Use native-feeling system typography and restrained neutral surfaces.
- Use consistent spacing, subtle separators, simple icons, and one restrained accent color.
- Keep the workspace canvas visually dominant.
- Keep controls compact but discoverable.
- Prefer contextual menus for infrequent actions.
- Avoid decorative gradients, glass effects, oversized headings, heavy shadows, unnecessary cards, excessive badges, decorative illustrations, and permanent sidebars without a demonstrated need.
- Do not make the interface look like a generic admin dashboard.
- Support system appearance plus explicit light and dark modes. Website panes must follow the effective appearance as a preferred color-scheme change without reloading their pages.

### 6.2 Main application structure

The initial interface should contain:

1. **Top toolbar:** brand, the active pane's address/navigation/viewport controls, Fit all, reload-all, and the compact **+** add-pane control with its device menu. Keep this a stable single row.
2. **Workspace canvas:** the largest area; it contains browser panes and layout interactions.
3. **Bottom canvas bar:** Hand tool, zoom-out/zoom-in with a percentage menu, and appearance.
4. **Pane chrome:** compact single-row title and actions, with back, forward, reload, contextual actions, and close visible; lower-priority actions such as rotate and screenshot live in the contextual menu.
5. **Empty state:** one clear action to add the first browser device. Never show fake sample websites as if they were live pages.
6. **Focus state:** allow one pane to temporarily fill the workspace and restore its previous geometry afterward.

Workspace and profile management live in the native menu bar, not the top toolbar. Do not add a complex sidebar to the MVP unless testing demonstrates a clear need.

### 6.3 Pane controls

Each device exposes a compact title, loading/error status, back, forward, reload, contextual menu, and close action. The active Canvas device additionally exposes address and viewport controls in the top toolbar. The native Device menu keeps maximize available.

When space is tight, collapse lower-priority controls into the contextual menu. Controls must never overlap or become unusable. In Canvas, keep back, forward, reload, contextual-menu, and close available at every zoom level; hide lower-priority metadata such as the profile or viewport badge before hiding actions.

User-facing copy calls each browser frame a **device**. The internal model and APIs may continue to use **pane**.

Supported device actions:

- Add, close, rename, and duplicate.
- Navigate to a URL, back, forward, and reload.
- Rotate a fixed viewport between portrait and landscape.
- Capture a screenshot of one device to a user-selected PNG file.
- Reload all devices from the workspace toolbar.
- Change viewport preset or custom dimensions.
- Maximize/focus and restore.
- Open DevTools for an individual pane when native-view composition supports it cleanly; this may follow the first stable MVP slice.

Closing a pane destroys its active native view and `webContents`, but does not automatically delete its browser profile. Profile deletion is a separate explicit action.

### 6.4 Accessibility and interaction quality

- Keyboard navigation and visible focus states.
- Clear accessible names for icon-only controls.
- Readable contrast in light and dark appearance.
- Respect reduced-motion preferences.
- Dragging and resizing have usable minimum dimensions and clear hover/active feedback.
- Do not rely on color alone to communicate status or errors.
- Provide useful empty, loading, error, disabled, and recovery states.

### 6.5 Suggested keyboard shortcuts

Use standard platform conventions and document the final shortcuts. At minimum, plan for:

- Add pane.
- Duplicate selected pane (`Cmd/Ctrl+D`).
- Close selected pane, including `Delete`/`Backspace` from shell chrome.
- Reload focused pane.
- Reload all panes.
- Focus/maximize and restore pane from the native Device menu.
- Switch workspace.

Avoid conflicts with common macOS shortcuts. Shortcuts must be implemented and tested before being shown in menus.

---

## 7. Workspace and pane model

### 7.1 Dynamic pane management

- Pane count is dynamic; do not hardcode 8 or 10.
- Support adding and removing panes without rebuilding the workspace.
- Give every pane a stable internal ID.
- Keep pane identity separate from browser profile identity.
- Preserve pane order, viewport settings, URL, and Canvas positions when restoring a workspace.
- If the machine becomes resource-constrained, show a useful warning rather than silently dropping panes or changing website behavior.

### 7.2 Grid and Freeform modes (removed)

Grid and Freeform are no longer selectable. Existing workspace files that reference either mode load into Canvas, and exports normalize to Canvas. Legacy layout fields may be retained in the schema only so older workspaces can be read without data loss.

### 7.3 Canvas add and context menus

- The toolbar **+** control opens a compact device menu grouped into Phones, Tablets, and Desktop. It includes responsive mode and popular devices such as iPhone, Samsung Galaxy, Google Pixel, iPad, Galaxy Tab, MacBook Air, and desktop.
- Right-clicking empty Canvas opens a menu with Add pane, Fit all panes, Reset zoom, Hand tool, Profiles, Workspaces, and Appearance.
- The Add pane item switches the menu to the device picker without opening a separate modal.
- Menus must support keyboard arrows, Enter/Space activation, Escape dismissal, click-outside dismissal, checked/radio states, and visible focus.
- Keep the menu compact and visually quiet. Icons are optional but must not reduce legibility.
- Because native pane views sit above the shell, hide only the native views that intersect an open menu and show their snapshots; keep uncovered panes live.
- The zoom and appearance menus are the exception to hiding overlays: keep the bottom canvas bar and the overview visible while they are open, and close them when a bar or overview action is used.

### 7.4 Canvas mode

- Provide an infinite dotted workspace for arranging browser frames in world coordinates.
- Pan by dragging empty canvas; provide a Hand tool for panning from anywhere. Holding Space temporarily enables the Hand tool. Support trackpad/wheel panning while the Hand tool is not active.
- While the Hand tool is active, use the mouse wheel to zoom between 25% and 200% around the cursor; Ctrl/Cmd+wheel also zooms outside Hand mode. Show a bottom-center canvas bar with Hand, zoom-out and zoom-in buttons, a percentage menu containing 25%, 50%, 75%, 100%, 125%, 150%, 200%, Fit all, and Reset (100%), and appearance. Keep this bar and the overview visible while its zoom or appearance menu is open. Canvas zoom scales the whole pane as a unit (frame, header chrome, and page content) while the declared viewport stays fixed; do not reflow or change the page's CSS viewport dimensions.
- Fit all panes when a workspace first appears and after switching workspaces. Do not fit again on ordinary pane-state updates.
- Clicking empty canvas with the primary button and without dragging clears the active pane. Interacting with a pane, its header, or the minimap restores selection.
- Keep the top toolbar and its active-pane controls mounted at a stable height in Canvas. When no pane is selected, show a quiet empty state instead of removing the controls, so selecting or clearing a pane never moves or resizes the canvas.
- Drag a pane's header/label area to move only that pane in world space. Website content remains interactive; dragging content must not move the pane or the canvas.
- While dragging a pane, snap its left, center, or right edge to neighboring pane edges/centers, and similarly on the vertical axis. Show visible alignment guides for active snaps. The snap threshold should feel constant in screen pixels at every zoom.
- Keep pages live as native views when their content rectangle is fully inside the workspace and outside an open menu.
- While panning, replace native views with captured snapshots so content does not slide under chrome or clip at workspace edges.
- Partially visible panes may remain as snapshots until the user selects them; selecting one should bring it fully into view.
- Provide a persistent Canvas overview/minimap in the bottom-right showing every pane and the current viewport. It must be visible whenever Canvas mode is active, without a reveal action. Selecting a pane centers and focuses it; selecting empty map space recenters the viewport there.
- Keep the minimap compact and adaptive: shrink it on narrow windows, and let it collapse to a header and expand again. It must remain reachable while collapsed.
- Implement the minimap as a trusted native overlay rather than relying on DOM stacking above native views. Pane content outside the minimap rectangle must remain live and interactive.
- Provide a Fit all panes action in the top toolbar, in the overview, and in the zoom menu. It must bring every pane back inside the workspace.
- Use the top toolbar for active-pane address, navigation, and viewport controls, with compact labels on each frame.
- Provide the + device menu and right-click canvas context menu described in §7.3.
- Persist canvas positions per workspace. Pan offset, zoom, and a cleared active-pane selection are viewport state and may reset.
- Device bezels and pane frame resizing are not required.

### 7.5 Canvas-only layout

- Canvas is the only selectable layout. Remove Grid/Freeform controls and the grid/freeform toggle command from the user interface.
- Existing workspaces with a legacy layout mode open in Canvas. Normalize saved and exported layout modes to Canvas while retaining legacy fields only for readable migration.
- Do not persist temporary maximized/focused state.
- If many panes cannot comfortably fit, provide zoom, Fit all, and the overview; never silently discard panes.

### 7.6 Snapping behavior

- Snap pane edges and centers to neighboring pane edges and centers in world space.
- Show a 1px alignment guide while a snap is active; clear guides on pointer release or cancel.
- Use an 8 screen-pixel snap threshold, divided by canvas zoom for world-space calculations.
- Do not snap to the dragged pane itself. The minimap and Fit all remain the recovery paths for distant panes.
- A configurable snap sensitivity may be added later if it can be exposed without cluttering the interface.

### 7.7 Layout engine requirements

The layout engine is a core subsystem. Implement it in pure TypeScript, independent of Vue and Electron, and unit-test it.

It must handle:

- Canvas frame sizing from pane viewport presets.
- World-coordinate placement, default row arrangement, and persisted positions.
- Edge/center snap candidate calculation and thresholds.
- Minimap projection and adaptive minimap panel sizing.
- Viewport preset validation and fit-scale math.
- Maximize/restore geometry.
- Add/remove/reorder operations.
- Legacy grid/freeform schema validation for migration only.

Do not place layout calculations directly inside Vue components or Electron IPC handlers.

---

## 8. Browser navigation and website compatibility

### 8.1 Supported destinations

- Support `http://` and `https://` URLs.
- Support `about:blank` for an empty pane.
- Support localhost development servers, loopback addresses, LAN addresses, private IPs, `.local` hosts, staging websites, and public websites.
- Do not require a website to permit iframe embedding. PaneFlow uses real browser views, not iframe embedding.

### 8.2 URL normalization

If a scheme is omitted:

- Default to HTTP for `localhost`, loopback addresses, `.local` hosts, private IP addresses, and recognizable bare `host:port` development addresses.
- Default to HTTPS for other hostnames.

Normalize and parse URLs with a proper URL parser. Do not validate URLs using fragile string-prefix checks.

### 8.3 Navigation policy

- Allow only approved `http:`, `https:`, and `about:blank` destinations in remote panes.
- Reject `javascript:`, `data:`, `file:`, unknown custom schemes, and other unsupported protocols.
- Show a useful validation or navigation error. Never silently redirect to an unrelated URL.
- Do not disable Chromium web security to make a site work.
- Do not ignore TLS/certificate errors as a convenience.
- HTTP is permitted because local development and testing may require it. Make insecure non-local HTTP destinations distinguishable where practical.
- Handle normal redirects while applying the navigation policy to the destination.

### 8.4 Popups and external links

**MVP default:** deny new windows/popups from remote pages. Do not create privileged application windows for remote content.

If a later requirement supports popups:

- Use a controlled child browser view/window with the opener's profile unless the user explicitly selects otherwise.
- Apply the same security and navigation rules.
- Validate the requested destination.
- Do not grant extra privileges to child windows.

Do not pass arbitrary untrusted URLs directly to `shell.openExternal`.

### 8.5 Known website limitations

Some identity providers, payment pages, streaming services, or bot-protection systems may block embedded Electron user agents or behave differently from a standard Chrome installation. Do not spoof a user agent to bypass restrictions. A user may explicitly configure a user-agent override for legitimate testing, but PaneFlow must not promise compatibility with every website.

---

## 9. Browser profiles and session isolation

### 9.1 Default profile behavior

Every newly created pane receives a newly generated internal browser profile ID and a unique persistent Electron partition, for example:

`persist:paneflow-profile-<uuid>`

Never derive partition names from user-entered names, URLs, tenant labels, or other untrusted input.

Keep pane IDs and profile IDs separate. A pane may reference a profile; a profile may be explicitly shared by multiple panes.

Two panes may intentionally share a profile only when the user explicitly selects an existing profile. Make shared-profile status visible in the UI so it cannot happen accidentally.

### 9.2 Isolation behavior

Separate profiles must isolate browser data managed by Electron, including:

- Cookies.
- Local storage and IndexedDB.
- Cache.
- Service-worker storage.
- Other session-scoped data managed by Electron.

Each pane has its own `WebContents` and navigation history. `sessionStorage` is scoped to a browsing context; do not promise it survives pane destruction/recreation or application restarts.

This is browser-session isolation, not a guarantee that two panes run in separate operating-system sandboxes or separate Chromium installations.

### 9.3 Profile lifecycle

- Persistent profile data survives normal application restarts.
- Closing a pane destroys its active `WebContentsView` and `webContents`, but retains the profile for later reuse.
- Clearing profile data requires an explicit user action and confirmation.
- Deleting a profile must be blocked while it is in use, or use a clearly confirmed close-and-delete flow.
- Duplicating a pane creates a new profile by default; copy URL and viewport settings, not cookies or authentication.
- Duplicating a workspace creates fresh profiles for its panes by default.
- Reusing an existing profile is an explicit choice.

### 9.4 Profile manager

The MVP must provide a simple profile manager that:

- Lists profiles with a human-readable label and creation metadata.
- Shows whether a profile is currently in use and which panes reference it.
- Allows renaming a profile.
- Allows clearing its browsing data with confirmation.
- Allows deleting an unused profile with confirmation.
- Prevents deleting a profile while active, unless the user confirms a flow that closes all panes using it.

Do not expose raw cookies, tokens, or other secrets in the profile manager.

### 9.5 Session implementation

Use Electron's `session.fromPartition()` with persistent partition names. Confirm the API and lifecycle behavior against the exact Electron version pinned by the project.

Do not manually copy cookies or authentication tokens into PaneFlow's configuration files.

---

## 10. Device and viewport emulation

### 10.1 Supported configurations

Provide sensible presets for common:

- Phones: iPhone 15 Pro/Pro Max/SE, Samsung Galaxy S24/S24 Ultra, Google Pixel 8/8 Pro, and a responsive/generic phone preset.
- Tablets: iPad Pro 12.9″, iPad Air, Samsung Galaxy Tab S9, and a generic tablet preset.
- Laptops and desktops: MacBook Air, laptop, and desktop CSS viewports.

Also support custom width and height.

Preset labels may identify a popular source device, but must always show the CSS viewport dimensions and use “viewport”/“emulation” language. Do not present a preset as physical hardware accuracy.

### 10.2 Per-pane settings

Each pane can have independent:

- Viewport width.
- Viewport height.
- Device scale factor.
- Optional user-agent override.

Fixed viewport presets and custom dimensions always scale the emulated page to fit the available pane content area. Responsive panes use the pane content size directly. There is no actual-size/overflow display mode.

New panes can be created directly with a fixed viewport preset from the **+** device menu. The new pane receives that preset and a fresh browser profile.

### 10.3 Implementation and validation

- Use a supported public Electron device-emulation API for the pinned Electron version.
- Verify all parameters against current official Electron documentation during implementation.
- Confirm actual page values using a local fixture page that displays `window.innerWidth`, `window.innerHeight`, and `window.devicePixelRatio`.
- Confirm that different panes can use different viewport configurations simultaneously.
- Confirm that creating a pane from the **+** device menu applies the selected preset without changing other panes.
- Confirm that the visual fit scale is recalculated after pane and window resizing without changing the intended emulated CSS viewport.

Do not claim a preset reproduces physical hardware, touch sensors, GPS, device-specific APIs, browser-engine differences, or a real device. Do not spoof user agents to bypass identity-provider restrictions.

---

## 11. Workspaces and persistence

### 11.1 Workspace management

Users can:

- Create a workspace.
- Rename a workspace.
- Duplicate a workspace.
- Switch between workspaces.
- Delete a workspace.
- Restore the last active workspace after restarting PaneFlow.

Example workspaces:

- Development.
- Responsive QA.
- Client Websites.
- Staging vs Production.

### 11.2 Workspace data

A workspace stores:

- Stable ID and name.
- Canvas layout marker and world-coordinate pane positions.
- Pane order and pane definitions.
- Pane IDs and browser profile references.
- Per-pane URL and viewport settings.
- Snapping preferences when configurable.
- Relevant pane titles.
- Legacy grid/freeform fields only for older-file migration.

A workspace stores references to profile IDs, not profile contents or authentication data.

### 11.3 Persistence format

Store validated, versioned JSON files in Electron's user-data directory. Suggested structure:

- `app-state.json`: schema version, active workspace ID, safe application window bounds, theme preference.
- `profiles.json`: profile IDs, labels, creation metadata, and non-secret settings.
- One file per workspace: pane definitions and layout settings.

Requirements:

- Validate all data on read and write.
- Use atomic writes (write a temporary file, flush/close it, then rename).
- Implement schema migrations.
- Preserve invalid files with a `.corrupt-<timestamp>` suffix and recover to safe defaults.
- Do not store cookies, credentials, access tokens, session storage, page contents, or browser profile data in workspace JSON.
- Do not persist temporary maximized/focused state.
- Do not store machine-specific absolute paths unless required and documented.

### 11.4 Import/export

Import/export is post-MVP unless implementation is trivial after persistence is stable. If implemented:

- Export workspace configuration only, never cookies or credentials.
- Strip local browser profile IDs from exports.
- Generate fresh isolated profiles during import by default.
- Validate schema, URLs, and layout geometry before accepting an import.
- Never import executable code or arbitrary filesystem paths.

---

## 12. Electron architecture and technology stack

### 12.1 Technology baseline

Use the following baseline unless Phase 0 documents a concrete, verified reason to change it:

- **Desktop shell:** Electron.
- **Window composition:** Electron `BaseWindow`.
- **Browser panes:** Electron `WebContentsView`.
- **Browser sessions:** `session.fromPartition()` with persistent partition IDs.
- **Renderer UI:** Vue 3.
- **Language:** TypeScript with strict checking.
- **Bundler/dev tooling:** Vite with `electron-vite` as the default integration.
- **Renderer state:** Pinia where shared state is needed; do not overuse global state.
- **Unit testing:** Vitest.
- **End-to-end/integration testing:** Playwright where compatible with the selected Electron version, plus local fixture servers.
- **Persistence:** versioned JSON files in Electron's user-data directory for MVP.
- **Package manager:** npm with a committed `package-lock.json`.
- **Runtime:** Node.js 24 as the initial `.nvmrc` baseline; verify compatibility with the selected Electron/electron-vite toolchain during Phase 0.

Use current stable, mutually compatible dependency versions and commit the lockfile. Do not use beta/nightly dependencies for the MVP. Record the exact Electron and Node versions in project documentation.

### 12.2 Required Electron APIs

Use:

- `BaseWindow` to compose multiple views in one desktop window.
- `WebContentsView` for each remote browser pane.
- `session.fromPartition()` for browser profile/session isolation.

Do not use:

- HTML iframes as the primary website renderer.
- Electron `<webview>` as the primary website renderer.
- Deprecated Electron `BrowserView`.

Verify APIs against current official documentation for the exact pinned Electron version. Do not rely only on remembered or outdated examples.

### 12.3 Suggested source layout

```text
src/
  main/       Electron lifecycle, BaseWindow, BrowserManager, IPC, persistence
  preload/    Minimal typed bridge for the trusted shell only
  renderer/   Vue shell, toolbar, pane chrome, workspace UI
  shared/     Pure TypeScript types, layout algorithms, validators, URL helpers

 tests/
  unit/
  integration/
  e2e/
  fixtures/

docs/
  ARCHITECTURE.md
  DECISIONS.md
  MANUAL_CHECKS.md
  PHASE_REPORTS.md
```

Adjust the precise layout if the chosen bundler requires it, but preserve dependency/security boundaries. Shared layout and validation modules must not import Vue or Electron.

### 12.4 Native view composition — Phase 0 decision required

`WebContentsView` is a native view, not a DOM child. Ordinary Vue DOM elements cannot simply be drawn above a native browser view. View stacking, hit testing, transparency, and pointer behavior must be proven in a running application before the full workspace is built.

Phase 0 must build a minimal experiment containing:

- A trusted local application shell.
- At least two independently navigable `WebContentsView` instances.
- Visible and clickable pane controls/address chrome.
- A working way to focus and navigate each pane.
- Correct view stacking and hit testing.
- Resizing and bounds synchronization.
- A tested menus/overlay strategy or an alternative native-view composition.
- Correct destruction of views and `webContents`.

Possible approaches may include a trusted base shell with browser content rectangles, dedicated native chrome/content views, or another composition proven by the spike. Do not assume transparent overlay click-through works. Do not build the full workspace UI until the experiment proves that native panes and app controls can coexist without blocking each other.

Record the chosen approach, rejected alternatives, known limitations, and test evidence in `docs/DECISIONS.md`. Revisit the approach only when new evidence justifies a change.

### 12.5 Bounds synchronization

- The renderer may report intended browser-content rectangles through typed IPC.
- The main process treats all geometry as untrusted input: validate finite coordinates, non-negative dimensions, known pane IDs, minimum size, and canvas/window bounds.
- Coalesce bounds updates; do not send redundant IPC messages for every pointer event.
- Verify coordinate units and Retina behavior on the pinned Electron version and target macOS environment.
- Do not blindly multiply CSS coordinates by `devicePixelRatio`; confirm the required CSS-pixel/DIP conversion empirically.
- Recompute after window resize/maximize/restore, layout changes, pane drag/resize, visibility changes, and relevant zoom changes.
- Record coordinate conversion and layering decisions in `docs/DECISIONS.md`.

### 12.6 BrowserManager and lifecycle

Create a dedicated `BrowserManager` in the main process. It owns active native views and their `webContents`, and exposes narrow, typed operations such as:

- Create and destroy pane view.
- Navigate.
- Go back and forward.
- Reload.
- Set bounds.
- Open DevTools.
- Clear profile data.
- Read safe navigation/loading state.

Requirements:

- Create one remote-content `WebContentsView` per active pane using its selected profile partition.
- Attach event listeners at creation and remove them at destruction.
- Handle renderer crashes and navigation failures without crashing the trusted shell.
- On window/app shutdown, destroy all child views and explicitly close owned `webContents` to avoid leaks.
- Prevent duplicate registrations and stale async events from updating closed panes.
- Keep pane state and native view lifecycle synchronized.

### 12.7 Trusted renderer and IPC

- The local app shell is trusted; remote website views are not.
- Expose only a minimal, typed API through preload to the local shell.
- Never inject the application preload bridge into remote website views.
- Validate IPC sender identity and every payload in the main process.
- Keep Electron APIs out of renderer components where practical.
- Keep pure layout, URL, and validation logic independent of Electron.

---

## 13. Security requirements

Remote websites are untrusted. Follow current official Electron security guidance for the exact pinned version.

### 13.1 Remote browser views

- `nodeIntegration: false`.
- `contextIsolation: true`.
- `sandbox: true` unless a specific, documented compatibility requirement prevents it; do not disable it as a shortcut.
- Keep `webSecurity` enabled.
- Do not enable insecure content or experimental Blink features to make sites work.
- Do not expose the application's preload bridge or IPC methods to remote websites.
- Do not provide remote pages with filesystem, shell, environment-variable, process, or privileged APIs.

### 13.2 Trusted application shell

- Use a restrictive Content Security Policy.
- Prefer a secure custom application protocol over broad `file://` access for packaged shell assets, following current Electron recommendations.
- Keep preload APIs minimal and typed.
- Do not expose generic IPC send/invoke methods to renderer code; expose only specific operations.

### 13.3 IPC and navigation

- Validate the sender frame/origin and every payload in the main process.
- Do not trust renderer-side validation as a security boundary.
- Parse URLs with a standard parser and enforce the scheme policy in the main process.
- Reject dangerous schemes and unknown custom protocols.
- Handle navigation and window creation explicitly.
- Do not pass untrusted URLs directly to `shell.openExternal`.

### 13.4 Permissions

- Configure a permission request handler for every session that loads remote content.
- Deny permissions by default in the MVP (camera, microphone, notifications, geolocation, clipboard access, etc.).
- Do not automatically grant a permission because one pane requested it.
- A future permission prompt must identify the requesting origin and permission and require an explicit user decision.

### 13.5 Data handling

- No credentials, cookies, access tokens, page contents, or secrets in workspace files, exports, logs, screenshots, fixtures, or Git.
- Avoid logging full URLs when they may contain sensitive query parameters.
- Keep browser profile data inside Electron-managed profile storage.
- Never commit local browser profiles or user data.

### 13.6 Packaging hardening

When packaging is introduced, review Electron security fuses and production settings using current official guidance. Do not treat packaging as permission to weaken renderer security.

---

## 14. Performance and resource management

Expected normal workload: approximately 4–10 visible panes, depending on the user's machine and the websites loaded. There is no hardcoded product-level maximum of 10.

Requirements:

- Keep the trusted shell responsive while several panes load.
- Avoid unnecessary Vue re-renders and IPC traffic.
- Batch/coalesce bounds updates.
- Destroy views, listeners, and owned `webContents` when panes close.
- Recover gracefully from individual renderer crashes.
- Measure CPU and memory using representative local fixtures and realistic websites.
- Do not claim unlimited scaling or a fixed safe pane count across all hardware.
- Do not silently freeze, throttle, or alter website behavior to save resources.
- Consider lazy creation or pausing of off-screen panes only after correctness and session behavior are proven and the user experience is documented.
- Provide a restrained resource-pressure warning if it can be implemented reliably.

Performance testing must include several lightweight fixtures and a more realistic set of pages. Record machine, OS, Electron version, pane count, and rough CPU/memory observations in phase reports.

---

## 15. Local development environment and Docker policy

PaneFlow is a native desktop application. **Docker is not required and must not be introduced for normal development, testing, running, or packaging of the macOS application.**

### 15.1 Native development

Run the following directly on the host machine:

- Node.js and npm.
- Electron and Chromium.
- Vue/Vite development server.
- Vitest and Playwright tests.
- Local HTTP fixture servers used by tests.
- macOS application packaging/build tools.

Use the project's `.nvmrc` and npm lockfile to keep the local toolchain consistent.

### 15.2 Docker is not part of the MVP

Do not add speculatively:

- `Dockerfile` for PaneFlow.
- `docker-compose.yml` / `compose.yaml`.
- Containerized Electron or Chromium runtime.
- Containerized browser sessions.
- Docker-dependent test or development commands.

Docker may be introduced later only for a demonstrated, specific infrastructure or build requirement. Any proposed use must explain why native tooling or GitHub Actions runners are insufficient and must not become a requirement for ordinary macOS development.

### 15.3 Cross-platform CI and packaging

Use native GitHub Actions runners for platform-specific builds and tests:

- macOS runner for macOS tests and packaging.
- Windows runner for Windows builds/tests when supported.
- Ubuntu runner for Linux builds/tests when supported.

Do not assume a container can replace a native macOS runner for macOS packaging, signing, or notarization.

---

## 16. Public repository and project hygiene

PaneFlow is developed in a public GitHub repository. Treat all committed files as public.

- Keep the README useful for users and contributors.
- Keep `AGENTS.md` as the durable instruction source for coding agents.
- Keep this `SPEC.md` as the product/engineering source of truth.
- Keep reusable OpenCode agents, skills, and commands under `.opencode/`.
- Keep architecture decisions and phase reports under `docs/`.
- Commit the package lockfile.
- Use GitHub Actions for reproducible CI.
- Use Dependabot or equivalent dependency update automation where appropriate.
- Never commit `.env` files, credentials, tokens, local browser profiles, generated user data, machine-specific paths, or signing keys.
- Keep `.gitignore` aligned with actual outputs and local profile locations.
- Do not select or add an open-source license on the repository owner's behalf. The repository owner must choose the license explicitly.
- Do not commit, push, publish a release, or change GitHub repository settings unless the repository owner explicitly asks.

Suggested documentation files:

- `README.md`: product overview, screenshots when available, install/development instructions, and known limitations.
- `AGENTS.md`: coding-agent workflow, repository rules, UI/security constraints.
- `SPEC.md`: this document.
- `docs/ARCHITECTURE.md`: implemented architecture and subsystem boundaries.
- `docs/DECISIONS.md`: architectural decisions, alternatives, and evidence.
- `docs/MANUAL_CHECKS.md`: manual test scenarios.
- `docs/PHASE_REPORTS.md`: completed work and verification results per phase.

---

## 17. Commands, scripts, and quality gates

Create and maintain these npm scripts as the application is implemented:

- `dev`
- `build`
- `typecheck`
- `lint`
- `test`
- `test:e2e`
- `package:mac`

Do not claim a script exists before implementing it. Do not create placeholder scripts that simply echo success. Document temporarily unavailable scripts and add them when the relevant phase requires them.

Before a phase is considered complete:

1. Run the narrowest relevant tests first.
2. Run typecheck and lint.
3. Run unit tests.
4. Run integration/e2e tests relevant to the phase.
5. Run the production build.
6. Verify phase exit criteria manually where required.
7. Record exact commands and results in `docs/PHASE_REPORTS.md`.

Report failed, skipped, unavailable, and passed checks separately. Never claim an unrun check passed.

---

## 18. Testing strategy

Tests must use local fixture pages/servers wherever possible. Do not make correctness tests depend on third-party websites or unstable public services.

### 18.1 Unit tests

Cover at minimum:

- Canvas frame sizing and default placement.
- World-space snap calculations and thresholds.
- Minimap projection and adaptive panel sizing.
- Pane ordering and maximize/restore geometry.
- Legacy grid/freeform validation and migration.
- Viewport preset/custom validation and fit-scale math.
- URL normalization and scheme rejection.
- Configuration validation and schema migrations.
- Profile registry rules and safe partition-name generation.

### 18.2 Integration tests

Use local fixture pages/servers.

- Set a persistent cookie with `Max-Age` in one profile and verify it is absent in another.
- Set localStorage and IndexedDB in one profile and verify isolation from a second profile.
- Sign into the same fixture origin with two accounts in separate panes and verify sessions remain independent.
- Verify back/forward/reload are pane-specific.
- Verify closing one pane does not affect another pane.
- Verify persistent cookie/localStorage data survives an application restart.
- Verify that panes explicitly sharing a profile share the expected cookie/storage state.
- Verify that new/duplicated panes receive a fresh profile by default.
- Verify denied permissions and popup behavior.
- Document that session-only cookies and `sessionStorage` are not guaranteed to survive pane recreation/restart.

### 18.3 End-to-end and manual checks

- Open at least 8 panes using local test pages.
- Add, close, duplicate, rename, and navigate panes.
- Drag panes with snapping guides, use Fit all, collapse/expand the minimap, and recover partially visible panes.
- Open the + device menu and right-click canvas menu, verify keyboard dismissal, and create a pane from a selected device.
- Resize/maximize/restore the application window and verify native view alignment.
- Test Retina coordinate behavior where available.
- Verify viewport values from inside each page.
- Test invalid URLs, navigation failures, rejected schemes, and popup policy.
- Restart the app and restore workspace configuration and persistent profile state.
- Clear and delete profiles with correct confirmation and in-use protection.
- Close panes repeatedly and check for orphaned views/processes.
- Test recovery from an individual renderer crash.

### 18.4 Visual and accessibility checks

- Review light and dark appearance.
- Test narrow and wide application window sizes.
- Test pane controls at the minimum supported pane size.
- Verify focus order, keyboard access, accessible labels, and contrast.
- Confirm no visible control is inert or misleading.
- Keep the UI consistent with the minimal design direction in Section 6.

---

## 19. Implementation phases

Implement phases in order. Each phase should be completed as a small, verified vertical slice. Do not skip Phase 0.

### Phase 0 — Repository bootstrap and native-view technical spike

- Inspect repository/Git state, Node/npm versions, macOS environment, and available scripts.
- Read `AGENTS.md`, this `SPEC.md`, and relevant OpenCode skills before implementation.
- Verify current official Electron and electron-vite documentation for the versions being selected.
- Initialize the minimal Electron/Vue/TypeScript toolchain using npm and commit-ready lockfile.
- Build the smallest runnable `BaseWindow` + `WebContentsView` experiment.
- Prove at least two independently navigable browser views.
- Prove visible/clickable controls and address chrome with correct z-order and hit testing.
- Prove bounds synchronization, resize behavior, and Retina coordinate handling on the development Mac.
- Prove separate persistent sessions at a basic level.
- Prove correct cleanup of views and `webContents`.
- Establish initial real npm scripts; do not add fake scripts.
- Record chosen composition, rejected alternatives, limitations, and evidence in `docs/DECISIONS.md` and `docs/ARCHITECTURE.md`.
- Update `docs/PHASE_REPORTS.md` with exact commands/results.

**Exit condition:** the app runs locally on macOS; at least two real browser views and their controls work together; native composition and coordinate behavior are documented; basic project checks run.

Do not build the full product UI until this experiment passes.

### Phase 1 — Secure browser/session foundation

- Establish the production app shell and secure preload/IPC boundary.
- Implement BrowserManager and the profile registry.
- Create multiple panes with separate persistent sessions.
- Implement navigation controls and loading/error states.
- Implement navigation, popup, and permission policies.
- Add deterministic profile-isolation integration tests.
- Ensure browser lifecycle cleanup is reliable.

**Exit condition:** at least two panes can authenticate independently on the same local fixture origin and retain the intended persistent profile data after restart.

### Phase 2 — Workspace and layout engine

- Implement the pure TypeScript layout engine and unit tests.
- Build Canvas-only pane management with world-coordinate placement.
- Add header dragging, world-space snapping guides, minimap recovery, and maximize/restore.
- Synchronize native browser bounds with workspace geometry.
- Add keyboard interactions for core pane actions.

**Exit condition:** 8 panes can be added, moved, snapped, zoomed, fit into view, maximized, and interacted with without native view/control misalignment or loss of pane state.

### Phase 3 — Viewport emulation and persistence

- Add device/viewport presets and custom dimensions.
- Verify emulation using local fixture pages.
- Save/restore workspaces and active state.
- Implement profile manager, clear, and delete lifecycle.
- Test restart/recovery behavior.

**Exit condition:** different panes can use different viewport configurations, and workspace/profile state restores reliably after restart.

### Phase 4 — Polish, performance, and macOS packaging

- Refine minimal UI, accessibility, and light/dark themes.
- Add remaining useful keyboard shortcuts.
- Add per-pane DevTools if not already implemented.
- Measure resource usage and fix leaks.
- Complete macOS packaging and development documentation.
- Review security settings and packaging hardening.
- Keep Windows/Linux portability in mind, but do not delay the macOS MVP to package unsupported platforms.

**Exit condition:** Definition of Done is met, required checks pass, known limitations are documented, and the macOS application can be packaged locally.

---

## 20. Definition of Done

The MVP is complete when a user can:

1. Launch PaneFlow on macOS.
2. Create, save, duplicate, switch between, and restore workspaces.
3. Add at least 8 independent browser panes without encountering a hardcoded 8-pane product limit.
4. Open supported HTTP/HTTPS websites, including localhost, LAN, staging, and production sites.
5. Sign into the same website with different accounts in different panes without cookie/localStorage leakage.
6. Navigate each pane independently.
7. Arrange panes on the Canvas and navigate the workspace without losing them.
8. Drag, snap, zoom, fit, maximize, and restore panes.
9. Apply different viewport configurations to different panes and verify actual page viewport values.
10. Restart the app and restore workspace configuration and persistent profile data.
11. Manage, clear, and delete profiles safely.
12. Close panes without orphaned views or destabilizing other panes.
13. Pass applicable typecheck, lint, unit, integration/e2e, and build checks.
14. Use the application with the documented minimal UI and no Docker dependency.

---

## 21. Known limitations to document

- Viewport emulation does not reproduce a physical device, all device APIs, or a different browser engine.
- Browser panes share the application's Chromium runtime; their profiles are isolated, but they are not separate browser installations.
- Some identity providers and websites may block embedded Electron user agents or behave differently from Chrome/Safari.
- Session-only cookies and `sessionStorage` are not guaranteed to survive pane recreation or application restart.
- Browser extensions, DRM, cloud sync, collaboration, automatic updates, code signing, and notarization are outside the MVP.
- Website performance and the practical pane count depend on the user's hardware and loaded pages.
- Docker is not required for normal development or use of PaneFlow.

---

## 22. Official technical references

Use these as starting points and verify the current documentation for the exact pinned Electron release during implementation:

- [Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [Electron WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [electron-vite](https://electron-vite.org/)
- [OpenCode Documentation](https://opencode.ai/docs/)

