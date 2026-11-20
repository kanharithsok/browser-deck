# Manual Verification Checklist

Use local fixture pages and test accounts only. Never record real credentials or private page content.

Legend: checked items were verified during Phase 0 (2026-11-18) on macOS 27.2.1, Apple M4, Retina display, Electron 45.3.4 unless a later phase is named inline. Unchecked items belong to later phases or still need a separate check. Phase 4 accessibility items state whether they are automated or still require manual review.

## Native views and interaction

- [x] Two or more browser views load independently. (Two fixture panes; e2e and manual run.)
- [x] Pane controls and address chrome are visible and clickable. (Address, back, close, add exercised with Playwright input.)
- [x] Clicks reach the intended pane or control. (Shell clicks and a real click inside a native fixture page affected only that pane.)
- [x] Native view bounds align with pane content after initial layout and a window resize. (Within 1 CSS pixel; e2e.)
- [ ] Views align after pane drag and pane resize. (Pane resize not implemented.)
- [ ] Z-order and overlapping panes behave predictably. (Overlapping panes not implemented; native menu overlay was checked.)
- [x] Menus/dialogs/overlays render above browser content without breaking layout. (Custom pane menu, Canvas menus, dialogs, and native overlays render above browser content; e2e verifies menu hiding and visual checks confirm the custom menu surface.)
- [x] Closing a pane destroys its view and `webContents`. (E2e checks the closed `webContents` and remaining pane.)
- [x] Retina coordinate behavior. (DPR 2; bounds remained aligned.)
- [x] Hidden-inset macOS title bar. (E2e checks that content bounds fill the window, traffic lights use the custom 16,16 position, the toolbar reports a drag region, and the active-pane controls clear the traffic lights; window capture manually reviewed.)
- [x] Development and packaged app identity. (`make start` launches the packaged BrowserDeck bundle; development runs use `build/icon.png` for the Dock icon. The shared Electron dev runtime may still be labelled Electron in the Dock.)

## Browser isolation

- [x] Separate profiles do not share cookies. (`alice` and `bob` cookies, including HttpOnly session cookies, read independently.)
- [x] Separate profiles do not share localStorage. (Fixture click wrote only one pane; the other stayed empty.)
- [x] Separate profiles do not share IndexedDB. (E2e writes and reads a probe store in each profile.)
- [x] The same fixture origin supports two independently authenticated accounts. (Form sign-in as Alice and Bob in separate panes.)
- [x] Signing out of one profile does not sign out the other. (E2e logs Bob out and verifies Alice remains authenticated.)
- [x] Persistent cookie, localStorage, and authenticated session data survive app restart. (E2e relaunches with the same user data; profile IDs, cookies, localStorage, and both account sessions persisted.)
- [x] Closing one pane does not sign out or navigate another. (Remaining pane's session and account stay active; e2e.)
- [x] New panes receive an independent session. (New-pane profile ID checked.)
- [x] Duplicated panes receive an independent session. (E2e duplicates Alice, verifies a fresh profile and matching URL/viewport, then closes the duplicate.)
- [x] No profile manager, sharing, or profile labels are exposed. (E2e asserts the native `profiles-manage` item is absent.)
- [x] Clear Site Data is confirmed per pane. (E2e cancels once, confirms once, verifies localStorage is cleared, the pane reloads, and Alice's session is untouched.)
- [x] Session-only cookie and `sessionStorage` limitations are documented. (`SPEC.md`, `README.md`, and architecture docs state the limits.)

## Workspace

- [x] Add, remove, rename, and duplicate panes. (E2e covers add/close/rename/duplicate and active-pane state.)
- [x] Drag a pane header to move only that pane. (E2e drags a header; the canvas and other panes stay put, native views hide during the gesture, and positions restore aligned. Unit tests verify the top clamp keeps the header at least 24 px below the workspace top.)
- [x] World-space snapping shows alignment guides while dragging. (E2e drags near a neighboring edge, verifies a guide appears, verifies guides clear on release, and asserts flushed edges.)
- [x] Keyboard/menu pane actions. (Native Pane menu commands for add, close, and reload are exercised by e2e; raw key chords remain a follow-up.)
- [x] Next/previous workspace menu shortcuts. (E2e invokes `workspace-next` and `workspace-previous`, verifies accelerator metadata, restored pane/profile identity, wrapping, and disabled state when only one workspace exists.)
- [x] Canvas-only layout. (E2e asserts Canvas startup and no Grid/Freeform or grid-column controls.)
- [x] Eight-pane Canvas stress. (E2e grows to eight panes, verifies cards/native views remain present, and closes back to the original two without leaks.)
- [x] Pane maximize is removed from the product. (No pane maximize control, menu item, accelerator, or renderer state remains; application-window maximize still restores normally.)
- [x] Canvas positions restore after app restart. (E2e moves a pane, verifies the saved world position, and compares the restored Canvas layout state after relaunch.)

## Workspace persistence

- [x] Pane IDs, profile references, URLs, and viewport settings survive restart. (E2e verifies the same pane ID, Alice profile ID, authenticated URL, and mobile 390 × 844 DPR 3 settings.)
- [x] Legacy grid/freeform workspaces normalize to Canvas. (Unit tests assert Canvas normalization; old fields remain readable.)
- [x] Canvas positions and viewport settings survive restart. (E2e compares the persisted Canvas position and restores the iPhone SE viewport.)
- [x] Closing the last pane using a profile releases its data. (E2e closes Bob, verifies his profile disappears from `profiles.json`, and confirms his partition has no cookies after restart. Self-closed panes release their profiles too.)
- [x] Corrupt workspace and app-state files recover safely. (Unit tests verify `.corrupt-<timestamp>` preservation and safe defaults.)
- [x] Invalid workspace pane URLs/viewports are rejected before writing. (Unit tests reject `javascript:` URLs and malformed profiles/panes.)
- [x] Normal window bounds restore safely after restart. (E2e saves a distinctive 1120 × 820 window, verifies app-state, and compares bounds after relaunch.)
- [x] Maximized/full-screen window state restores. (E2e maximizes, verifies app-state, relaunches, confirms maximized state, then unmaximizes; a focused full-screen relaunch script verified the full-screen path and clearing.)
- [x] Theme preference restores. (E2e selects Dark, verifies dark tokens and app-state, relaunches, confirms Dark restores, then resets to System.)
- [ ] Theme preference is stored per workspace. (Theme is application-wide.)
- [x] Workspace create/rename/duplicate/switch/delete. (E2e creates a second workspace, switches, adds a pane, renames, duplicates with independent sessions, switches back to the authenticated original, verifies active-state persistence, and deletes the extras.)
- [x] Workspace export/import serialization excludes profiles and restores fresh identities. (Unit tests cover round-trip, profile stripping, fresh IDs, unsafe URLs/viewports, and invalid layout.)
- [ ] Native workspace import/export dialogs. (Pure logic is unit-tested; the Save/Open dialog path is not automated or manually re-run in this slice.)
- [ ] Workspace switching keeps background pages warm. (Switching destroys and recreates native views; pages reload.)

## Viewport emulation

- [x] Each pane can use a different viewport. (E2e sets Alice to mobile 390 × 844 and Bob to tablet 820 × 1180 at the same time.)
- [x] Fixture `window.innerWidth` matches configured width. (E2e: mobile 390, tablet 820, custom 500.)
- [x] Fixture `window.innerHeight` matches configured height. (E2e: mobile 844, tablet 1180, custom 700.)
- [x] Device scale factor behavior documented and verified for emulation. (E2e: mobile DPR 3, tablet DPR 2, custom DPR 2; see ADR-010.)
- [x] Fixed viewport presets use their declared CSS dimensions and scale with Canvas zoom. (E2e checks mobile/tablet/custom/Pixel dimensions and responsive emulation at 100%.)
- [x] Phone/tablet presets use mobile browser behavior. (A running-app probe at iPhone SE reports 375 × 667, no classic scrollbar, 5 touch points, `hover: none`, and `pointer: coarse`; switching back to Responsive clears the override.)
- [x] The pane header shows viewport class and resolution. (E2e verifies `Phone` and `390 × 844` in the second header row; the side labels hide when the custom viewport editor opens.)
- [x] The **+** add menu creates a pane with the selected browser preset. (E2e opens the custom menu, selects iPhone 15 Pro, and verifies the new pane's viewport.)
- [x] Multiple URLs can be opened at once with a shared viewport. (E2e opens the empty-state bulk dialog, enters three fixture URLs, selects iPhone SE, verifies three distinct profiles all using that viewport, and cleans up two browsers.)
- [x] Selected browsers expose common topbar actions and clear from empty canvas. (E2e exercises both the persistent Select tool and Cmd/Ctrl Select, checks that no X close action remains in the selection UI, applies iPhone SE through the selection viewport menu, clicks empty canvas to clear the active browser and rings, and closes the selected set with Delete.)
- [x] Native page pointer interactions remain browser-native. (E2e drag-selects heading text inside a live pane and verifies the DOM selection.)
- [x] The right-click Canvas menu exposes Add pane, view, hand, manage, and appearance actions. (E2e uses Add pane, toggles Hand, and switches Light/System.)
- [x] Invalid custom viewport values are rejected visibly. (E2e enters a 100 px width, sees the alert, and confirms the previous preset remains active.)
- [x] Two-row pane chrome remains usable at narrow widths. (E2e sets a 390 × 844 viewport and verifies every header control stays inside the frame; the address bar uses the full second row.)
- [x] Canvas pans an infinite dotted workspace and hides native views during the gesture. (E2e pans, verifies all native views hide, and verifies visible bounds realign afterward.)
- [x] Canvas snapshots cover native views during panning. (E2e waits for two `.pane-snapshot` images before panning; the image stays behind native views at rest.)
- [x] Dragging a pane header moves only that pane; dragging empty canvas pans the world. (E2e drags a label and verifies the other frame and canvas background position do not move.)
- [x] Website content stays interactive in Canvas mode while the header remains the drag handle. (Native views are restored when fully visible; content events stay inside the page.)
- [x] Holding Space temporarily enables the Hand tool and hides native views. (E2e holds Space, verifies the workspace Hand class and hidden native views, then releases it.)
- [x] Hand-mode wheel zoom scales the canvas while preserving the page CSS viewport. (E2e wheel-zooms out, checks the 560 × 700 page metrics, verifies responsive pane emulation is enabled below 100%, resets zoom from the bottom bar, and verifies it disables.)
- [x] Wheel panning realigns native views after the gesture. (E2e wheel-pans and verifies visible native bounds match the DOM at the new positions.)
- [x] Canvas restores the last camera and selected browser per workspace; new workspaces fit. (E2e sets 50%/75% zoom, pans, selects a browser, closes immediately, relaunches, and verifies the final zoom, pan, selected browser, and that a partially offscreen restored pane still loads. Saved views restore on workspace switches; only workspaces without a view run the fit path.)
- [x] Bottom canvas bar Hand, zoom steps, presets, Fit all, Reset, find-device, reload-all, and appearance work. (E2e checks the native bar at bottom center, toggles Hand, zooms out, opens the 7-preset menu, selects 50%, resets to 100%, and opens the appearance menu. The bar and minimap stay visible while its menus are open.)
- [x] The top toolbar is minimal and each pane owns its address bar. (E2e verifies the Add-only toolbar, per-pane second-row address inputs, the absence of Workspace/Profiles/Hand/Appearance toolbar buttons, and a workspace-owned dot backdrop below the opaque toolbar.)
- [x] The viewport menu and Add menu expose the same fixed preset catalog. (E2e checks 17 viewport items including Custom and 16 Add items, the same category groups and dimensions, and the previously missing Generic phone, iPhone 15 Pro Max, Samsung Galaxy S24 Ultra, Google Pixel 8 Pro, Generic tablet, and Laptop. Menu names are left-aligned and dimensions right-aligned.)
- [x] Workspace management lives in the native menu bar; Profiles does not. (E2e opens `workspace-manage`, verifies focus returns to the active pane address, and asserts `profiles-manage` is absent.)
- [x] Clicking empty canvas clears the active pane and interacting with a pane restores it. (E2e clicks empty canvas, verifies no active card and a stable Add-only toolbar, then clicks a pane title and verifies its address input returns.)
- [x] The top toolbar does not shift the canvas. (E2e captures the workspace rectangle before deselection, after deselection, and after reselection; all three are identical. The toolbar stays 42 px with only Add above the dotted Canvas backdrop.)
- [x] All top-toolbar buttons are borderless. (E2e computes 0 px borders for every button in the toolbar.)
- [x] Browser actions stay visible at every Canvas zoom. (E2e sets 430 × 932 and 393 × 852 viewports, zooms to 80% so their widths straddle the old 340 px breakpoint, and verifies back, forward, reload, actions, and close on both.)
- [x] Canvas zoom scales the whole pane while the viewport stays fixed. (Measured a 560 × 700 viewport at 100%, 50%, and 200%: the card/header scale to 560 × 732/32, 280 × 366/16, and 1120 × 1464/64 while `window.innerWidth/Height` stays 560 × 700.)
- [ ] Hand tool pans from over a pane. (E2e verifies the Hand tool hides native views and toggles state; pointer panning from inside a frame needs a manual GUI pass.)
- [x] Canvas overview is always visible in Canvas, shows every pane and the current viewport, and Fit all brings all panes back. (E2e enters Canvas without opening anything, verifies the native panel at the bottom-right, both frame buttons and the viewport outline, clicks Fit all, and asserts both cards fit inside the workspace, keep clearance above the native bottom bar, and align their native bounds.)
- [x] Canvas overview collapses and expands, recenters from empty map space, and hides while a custom menu or dialog is open. (E2e checks the native view height changes, the map hides/restores, the workspace background recenters, and the panel hides during menus.)
- [x] Canvas overview frame selection and focus return. (E2e clicks a minimap frame, verifies the pane centers and becomes active, and checks the shell regains keyboard focus; the panel was also exercised visually at desktop and minimum-window widths.)
- [ ] Canvas zoom at levels where frames no longer fit. (Implemented as snapshot preview; visual review of very high zoom and partially visible frames remains manual.)
- [ ] Spacebar while a website page has focus. (Intentionally not intercepted to preserve typing/scrolling; expected to work only when shell chrome has focus.)
- [ ] Partially visible canvas pane centers and restores live view when clicked. (Implemented; manual visual pass outstanding.)
- [ ] Device bezels. (Not implemented.)
- [ ] Fill/crop display mode for panes whose aspect ratio differs from the viewport preset. (Not implemented; fixed viewports letterbox to keep the full viewport visible.)
- [ ] Optional per-pane user-agent override. (Not implemented.)

## Accessibility and appearance

Phase 4 automated coverage (`tests/e2e/accessibility.spec.ts`): Playwright role/accessible-name checks, keyboard focus order and focus-visible assertions, dialog focus trapping and dialog focus return to the active address, Chromium's CDP accessibility tree, and an axe-core WCAG 2.x/best-practice audit for the shell toolbar, pane cards, workspace dialog, and bottom canvas bar. VoiceOver and other screen-reader behavior still require manual review; axe cannot verify spoken order, announcements, or whether a focus ring is meaningful to a particular user.

- [x] Icon-only controls have accessible names and tooltips. (Automated role/name checks for reload-all, browser actions, close, header navigation, the viewport menu button, and the bottom Hand/zoom/find/reload/appearance controls; tooltips are asserted for shell reload-all, browser actions, close, and reload device.)
- [x] Keyboard focus is visible on shell controls. (Automated Tab/Shift+Tab assertions verify `:focus-visible` and a 2 px accent outline; the dialog container shows the same ring when opened from the keyboard.)
- [x] Focus moves to the new pane after add and recovers to an address control after close. (Existing e2e assertions.)
- [x] Tab order crosses the toolbar, pane controls, address, and viewport controls in DOM order without entering native content. (Automated forward/reverse focus assertions; disabled Back/Forward are skipped.)
- [x] The active pane is visible and announced. (Exactly one accent-bordered card with `aria-current="true"`; focus moves the active card.)
- [x] Dialog triggers expose `aria-haspopup`/`aria-expanded` and named workspace state. (Automated before/after open assertions.)
- [x] The compact Workspaces panel exposes names/descriptions, focuses on open, traps Tab/Shift+Tab, closes on Escape/header X, and returns focus to the trigger. (Automated keyboard-only test; rows switch in one click and expose a menu-style actions popover. Escape closes an open row menu before the panel.)
- [x] Repeated workspace and device controls have unique contextual accessible names. (Workspace selection and row menus include the workspace label; pane actions include the browser label.)
- [x] The shell has one level-1 heading and dialogs do not create duplicate banner landmarks. (Axe best-practice/landmark audit; dialog header wrappers changed from `<header>` to `<div>`.)
- [x] Automated axe WCAG 2.0/2.1/2.2 A/AA plus best-practice audit passes for the shell and both dialogs. (axe-core 4.11.0 injected through CDP `Runtime.evaluate`, because the shell CSP blocks inline script injection.)
- [ ] Keyboard focus can enter native browser content and return to chrome. (Native pane focus handoff is Phase 2; not automated.)
- [ ] Full screen-reader pass across toolbar, pane chrome, status announcements, and dialogs. (VoiceOver was not run; automated accessibility-tree checks do not replace it.)
- [x] System light/dark tokens resolve correctly. (Main now sends a resolved theme; e2e verifies `data-theme` and tokens. Dark appearance manually reviewed.)
- [ ] The appearance menu changes System/Light/Dark and keeps the native View menu in sync. (Shell and persisted-state behavior automated; selecting from the native toolbar menu still needs a manual GUI check.)
- [x] Loaded website panes receive the appearance change as `prefers-color-scheme` without reloading. (E2e checks a loaded pane before and after the Dark menu command, and after restart.)
- [x] Custom menu keyboard behavior. (Accessibility e2e opens the **+** menu, uses ArrowDown to focus Responsive, and closes with Escape.)
- [x] Contrast audit across defined light/dark token pairs. (`npm run check:contrast` verifies 13 pairs per theme; full control/state screenshot audit remains.)
- [x] Reduced-motion behavior. (Global media rule disables animations/transitions/smooth scrolling when requested.)
- [ ] Narrow-window and minimum-pane-width control usability. (Manual review at the 720 px minimum window.)
- [x] No visible control is knowingly inert. (Add, close, back, forward, reload, reload-all, address, retry, menu, dismiss are implemented.)

## Performance and lifecycle

- [x] Repeated workspace switching does not leak `webContents` or native views. (E2e creates a four-pane stress workspace, cycles back to the original, and compares non-destroyed webContents/view counts; default 3 cycles, configurable via `BROWSERDECK_STRESS_CYCLES`.)
- [x] Eight-pane Canvas add/close stress. (E2e grows to eight panes, verifies cards and native views, then closes back to two.)
- [x] Short loaded-page soak with memory sampling. (8 cycles: 2 webContents, 575 MB → 515 MB; 25 cycles: 2 webContents, 573 MB → 643 MB; final `main` 50 cycles: 2 webContents, 589 MB → 684 MB; earlier runs: 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB.)
- [x] Accessibility suite starts and closes a separate Electron app cleanly without affecting the main integration run. (Two Playwright tests pass in one worker.)
- [ ] Multi-hour memory/CPU profiling with loaded third-party pages. (Not run. Working set is sampled before/after, not peak, and 50 cycles take ≈20 s.)
- [ ] CPU/frame measurement during drag, resize, and scrolling. (Not run.)

## Packaging

- [x] `npm run package:mac` builds an arm64 DMG, ZIP, and `.app`. (Artifacts produced under `dist/`.)
- [x] Bundle ID, version, icon, and category are correct. (`com.kanharithsok.browser-deck`, `1.2.0`, `icon.icns`, developer tools.)
- [x] Packaged app launches and renders the shell and panes. (Manual launch and screenshot.)
- [x] Packaged app exposes the BrowserDeck name and icon. (`CFBundleDisplayName`/`CFBundleName` are BrowserDeck, the packaged icon hash matches `build/icon.icns`, `lsappinfo` reports `BrowserDeck`, and `make start` launches the packaged executable.)
- [x] Homebrew cask installs the published release. (`brew info --cask kanharithsok/tap/browser-deck` resolves 1.1.0; `brew fetch` verifies the pinned SHA-256; `brew install --cask` installed `/Applications/BrowserDeck.app`, and the quarantine attribute was removed.)
- [x] Electron fuses are applied to the packaged app. (`npx electron-fuses read --app dist/mac-arm64/BrowserDeck.app`; RunAsNode/Node-options/inspector/file-protocol privileges disabled, ASAR integrity and only-load-from-ASAR enabled.)
- [ ] Developer ID signing and notarization. (Post-MVP; blocked on Apple Developer credentials. The supported distribution is the unsigned/ad-hoc local arm64 build.)
- [ ] Intel/universal packaging. (Current build is arm64-only by owner decision.)
- [ ] Auto-update and release publishing. (Not implemented.)

## Security and failure handling

- [x] Dangerous URL schemes are rejected. (Main-process navigation test rejects `javascript:`; unit tests cover `data:`, `file:`, `chrome:`, embedded credentials, and oversized URLs.)
- [x] Remote pages cannot access the app preload bridge or Node APIs. (E2e checks `window.browserdeck`, `require`, and `process` are undefined.)
- [x] Unsupported top-level navigation from a remote page is blocked. (E2e attempts `file:` and `data:` locations and verifies the pane URL is unchanged.)
- [x] IPC rejects malformed payloads. (Unknown pane IDs and malformed bounds rejected in e2e/unit tests.)
- [x] IPC rejects an invalid sender. (E2e creates a separate node-enabled `BrowserWindow` and verifies empty state plus `Unauthorized sender.`.)
- [x] The shell loads from the secure internal protocol with an enforced CSP. (E2e observes `browserdeck://shell/index.html`, inline script blocked, and cross-origin fixture fetch blocked.)
- [x] Popups and permissions follow the documented policy. (Popup and notification request denied in e2e; display/device/Bluetooth handlers deny by default.)
- [x] A page that destroys its own `webContents` removes the pane cleanly. (E2e invokes `window.close()` in a pane; the other pane remains.)
- [ ] Renderer crash/navigation failure does not crash the app shell. (Failure UI exists; crash recovery needs a dedicated check.)
- [x] No secrets appear in logs, exports, fixtures, or repository files. (Repository review; fixtures contain only synthetic identities; credential-bearing URLs are rejected and export profiles are stripped.)
- [ ] Window shutdown leaves no orphaned views/processes. (Teardown implemented and e2e closes panes/windows; repeat after Phase 2.)

- [x] Device rotation swaps the emulated viewport and canvas frame. (E2e rotates a custom 500 × 1000 viewport through the validated IPC path, verifies a 1000 × 500 page and rotated frame, then restores it.)
- [x] Screenshot capture writes a PNG. (E2e patches the native save dialog, captures the selected browser through the validated IPC path, and verifies the PNG signature.)
- [x] Delete closes the selected browser from shell focus, and text-entry focus is protected. (E2e presses Backspace in the address field without closing, then Delete to close the duplicate. Cmd+D is a native Browser-menu accelerator and routing is tested; OS-level chord delivery is manual.)

## Post-MVP — Toolbar clarity and shortcut semantics

- [x] Address validation errors are visible in the pane header. (E2e enters a rejected `javascript:` address, asserts the visible `.address-error` text and live status in the active pane, and verifies Escape restores the URL.)
- [x] `Cmd/Ctrl+R` reloads the selected browser and `Cmd/Ctrl+L` focuses its address. (Menu accelerators are asserted in e2e; Focus Address is invoked through the native menu command and its resulting DOM focus is checked.)
- [x] `Cmd/Ctrl+=`, `Cmd/Ctrl+-`, and `Cmd/Ctrl+0` zoom the Canvas in, out, and reset. (Native View-menu accelerators are asserted in e2e, and the command routing updates the bottom-bar percentage.)
- [x] Copy URL is present in the in-shell browser actions menu. (E2e opens the menu, checks the items, and verifies Copy URL through the clipboard.)
- [x] Add-menu copy distinguishes browsers from viewport presets. (E2e checks `Start with viewport`, `Phone viewports`, `Tablet viewports`, and `Desktop viewports`.)
- [x] Blocked popups, downloads, and permission requests are visible. (E2e clicks the fixture popup and notification actions and triggers a blob download; each pane header shows the matching notice.)
- [x] `Cmd/Ctrl+K` opens a searchable browser palette. (E2e opens it from the native Browser menu, verifies the overlay hides native views/minimap/zoom bar, filters by title, selects with Enter, centers the browser, and returns focus. Escape and the no-match state are also covered.)
- [x] The bottom bar exposes the palette and search matches are highlighted. (E2e checks the Find browser toolbar button, viewport badges, title/query highlighting, and the no-match state.)
- [x] Reloading at a non-100% Canvas zoom preserves the zoom and the declared viewport. (E2e sets 80%, reloads the pane through its header, and verifies emulation is re-enabled at 0.8 with the page still 560 × 700. Emulated views stay hidden until the scale is reapplied, showing the snapshot/loader instead of flashing.)
- [x] Browser actions use the same custom menu component as the + menu. (E2e opens the pane `…` menu, verifies `.app-menu`, section headings, 11 menu items, native-view hiding, Escape focus return, and Copy URL.)
- [x] The selected pane ring surrounds the whole frame. (Visual check at 1280 × 860; the outline is drawn on the pane slot outside native bounds so the website cannot cover it.)
- [x] Find browser and Reload all live in the bottom canvas bar. (E2e verifies their bottom-bar accessible names and actions; the top right contains only Add.)

## Post-MVP — Canvas placement, Arrange, and per-browser header controls

- [x] `Cmd/Ctrl+N` opens the Add Browser picker. (E2e invokes the native `pane-add` command, verifies the menu opens without changing pane count, selects Responsive, and confirms a fresh-profile pane is created.)
- [x] `Cmd/Ctrl+D` places the duplicate beside the selected browser, or directly below it when the adjacent slot is occupied. (E2e verifies the persisted Canvas coordinates against the source frame.)
- [x] The bottom-bar Arrange menu offers Showcase, Horizontal row, 2 × 2 grid, and Vertical stack. (E2e verifies all four items and the resulting horizontal-row coordinates. Unit tests cover every arrangement, Showcase wrapping/centering, and empty input.)
- [x] Each browser header carries its own viewport preset trigger. (E2e opens the 17-item preset menu, selects fixed and custom presets, and verifies the trigger's `data-preset`, label, dimensions, tooltip, and `aria-expanded`.)
- [x] The main top toolbar carries no viewport or address control. (E2e uses the per-browser controls; custom viewport editing happens in that pane's address row.)
- [x] Pane headers expose a visible drag grip. (Visual/structural check; the whole header remains the drag surface.)
- [x] Open in Browser hands the current page to the system browser. (E2e stubs `shell.openExternal`, clicks the header control, and verifies the exact validated URL. Blank browsers disable the action.)
- [x] Mobile-width pane headers keep every action inside the frame. (E2e sets a 390 × 844 viewport and asserts every header button stays within the header bounds.)
- [x] Browser actions include Open in Browser. (E2e verifies the 11-item menu, including the new action.)

## Post-MVP — Marquee multi-select

- [x] The bottom canvas bar has a Select tool with a pressed state. (E2e verifies its accessible name, tooltip, `aria-pressed` transition, and the `canvas-select` workspace cursor state.)
- [x] Dragging a marquee selects every intersecting pane. (E2e creates four stress panes, fits them, drags around two, and verifies two selected rings plus a `2 selected` toolbar chip.)
- [x] Delete closes the selected set. (E2e presses Delete and verifies only the two selected pane IDs disappear; the remaining workspace and later leak cycles stay intact.)
- [x] The marquee is visible and native pages do not cover it. (Native views are hidden during the gesture by the existing visibility path; selected rings are drawn on pane slots outside native bounds.)
- [x] Escape clears the selection and a second press exits the tool. (Implemented in the trusted shell key handler; covered by the marquee flow and manual check.)
- [x] Select and Hand are mutually exclusive. (Toolbar state is validated through `browserdeck:set-canvas-select-mode`; activating one clears the other.)

## Post-MVP — Preset user agents

- [x] Phone presets send a mobile UA. (E2e selects Generic phone and verifies `navigator.userAgent` contains `iPhone`; Galaxy/Pixel presets use Android Chrome.)
- [x] Tablet presets send a tablet UA. (E2e selects Generic tablet and verifies `navigator.userAgent` contains `iPad`; Galaxy Tab uses Android tablet Chrome.)
- [x] Desktop presets send a desktop Chrome UA. (Unit tests verify Macintosh/Chrome strings and the absence of Electron/Mobile tokens.)
- [x] Responsive and custom viewports keep the default Electron UA. (E2e switches back to Responsive and verifies the UA is no longer iPhone.)
- [x] A UA-category change reloads the current page. (BrowserManager applies the UA and reloads only when the mapped UA changes; same-category preset changes do not reload.)
- [x] Google fits an iPhone SE viewport on the 1× Dell display. (Manual probe: before UA, `scrollWidth 400` vs `innerWidth 375`; after UA, `scrollWidth 360` with no horizontal overflow while the viewport stays `375 × 667 @ DPR 2`.)

## Post-MVP — Proximity guides and bottom-bar icons

- [x] A dashed guide appears before the first magnetic stop. (E2e drags a pane to a 50 screen-pixel gap and asserts `.alignment-guide.proximity` exists.)
- [x] The first magnetic stop leaves a 16px gap. (E2e moves to a 30px pointer gap, verifies a solid guide, and asserts the final pane gap is 16px ±1.)
- [x] The second stop snaps flush when the pane keeps moving. (The existing snap drag asserts `.alignment-guide:not(.proximity)` and verifies flush edges.)
- [x] Dashed and solid guides clear on release. (E2e asserts `.alignment-guide` count returns to zero after both drags.)
- [x] Proximity uses the same 24px gap-stop and 64px preview thresholds at every zoom. (Thresholds are divided by Canvas zoom in the shared helper; unit tests cover the world-space behavior.)
- [x] Hand and Select use palm and pointer icons. (Bottom-bar markup changed; accessible names, tooltips, pressed state, and behavior are unchanged.)
- [x] Menus leave the bottom bar and minimap visible unless they cover them. (E2e opens the upper-left canvas menu and verifies both overlays stay visible; each overlay now hides independently only on intersection.)
