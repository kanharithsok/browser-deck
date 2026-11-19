# Manual Verification Checklist

Use local fixture pages and test accounts only. Never record real credentials or private page content.

Legend: checked items were verified during Phase 0 (2026-11-18) on macOS 27.2.1, Apple M4, Retina display, Electron 45.3.4 unless a later phase is named inline. Unchecked items belong to later phases or still need a separate check. Phase 4 accessibility items state whether they are automated or still require manual review.

## Native views and interaction

- [x] Two or more browser views load independently. (Two fixture panes; e2e and manual run.)
- [x] Pane controls and address chrome are visible and clickable. (Address, back, close, add exercised with Playwright input.)
- [x] Clicks reach the intended pane or control. (Shell clicks and a real click inside a native fixture page affected only that pane.)
- [x] Native view bounds align with pane content after initial layout and a window resize. (Within 1 CSS pixel; e2e.)
- [ ] Views align after maximize/restore, pane drag, and pane resize. (Pane drag/resize not implemented.)
- [ ] Z-order and overlapping panes behave predictably. (Overlapping panes not implemented; native menu overlay was checked.)
- [x] Menus/dialogs/overlays render above browser content without breaking layout. (Native pane menu rendered above native content; manual check.)
- [x] Closing a pane destroys its view and `webContents`. (E2e checks the closed `webContents` and remaining pane.)
- [x] Retina coordinate behavior. (DPR 2; bounds remained aligned.)
- [x] Hidden-inset macOS title bar. (E2e checks that content bounds fill the window, traffic lights use the custom 16,16 position, the toolbar reports a drag region, and the brand clears the traffic lights; window capture manually reviewed.)

## Browser isolation

- [x] Separate profiles do not share cookies. (`alice` and `bob` cookies, including HttpOnly session cookies, read independently.)
- [x] Separate profiles do not share localStorage. (Fixture click wrote only one pane; the other stayed empty.)
- [x] Separate profiles do not share IndexedDB. (E2e writes and reads a probe store in each profile.)
- [x] The same fixture origin supports two independently authenticated accounts. (Form sign-in as Alice and Bob in separate panes.)
- [x] Signing out of one profile does not sign out the other. (E2e logs Bob out and verifies Alice remains authenticated.)
- [x] Persistent cookie, localStorage, and authenticated session data survive app restart. (E2e relaunches with the same user data; profile IDs, cookies, localStorage, and both account sessions persisted.)
- [x] Closing one pane does not sign out or navigate another. (Remaining pane's session and account stay active; e2e.)
- [x] New panes receive a fresh profile by default. (New-pane profile ID checked.)
- [x] Duplicated panes receive a fresh profile by default. (E2e duplicates Alice, verifies a fresh profile and matching URL/viewport, then closes the duplicate.)
- [x] Explicitly shared profiles share expected cookie/storage state. (E2e opens two panes from one profile, verifies shared localStorage, shared-count labels, and close-and-delete lifecycle.)
- [x] Profile manager lists usage, renames, clears, and deletes profiles safely. (E2e verifies rename persistence, cookie clearing, metadata deletion, and native-view hiding while the dialog is open.)
- [x] Clear/delete a profile while its panes are open via a close-and-delete flow. (E2e confirms Close panes & delete, verifies both panes close, the profile is removed, and the remaining pane aligns.)
- [x] Assign an existing profile to a new pane. (Profile manager Open pane creates a shared-profile pane; the toolbar Add pane remains fresh-profile only.)
- [x] Session-only cookie and `sessionStorage` limitations are documented. (`SPEC.md`, `README.md`, and architecture docs state the limits.)

## Workspace

- [x] Add, remove, rename, and duplicate panes. (E2e covers add/close/rename/duplicate and active-pane state.)
- [x] Drag a pane header to move only that pane. (E2e drags a header; the canvas and other panes stay put, native views hide during the gesture, and positions restore aligned.)
- [x] World-space snapping shows alignment guides while dragging. (E2e drags near a neighboring edge, verifies a guide appears, verifies guides clear on release, and asserts flushed edges.)
- [x] Keyboard/menu pane actions. (Native Pane menu commands for add, close, reload, and maximize are exercised by e2e; raw key chords remain a follow-up.)
- [x] Next/previous workspace menu shortcuts. (E2e invokes `workspace-next` and `workspace-previous`, verifies accelerator metadata, restored pane/profile identity, wrapping, and disabled state when only one workspace exists.)
- [x] Canvas-only layout. (E2e asserts Canvas startup and no Grid/Freeform or grid-column controls.)
- [x] Eight-pane Canvas stress. (E2e grows to eight panes, verifies cards/native views remain present, and closes back to the original two without leaks.)
- [x] Maximize/restore returns to the prior Canvas geometry. (E2e maximizes a pane, hides unrelated native views, and restores the prior bounds.)
- [x] Canvas positions restore after app restart. (E2e moves a pane, verifies the saved world position, and compares the restored Canvas layout state after relaunch.)

## Workspace persistence

- [x] Pane IDs, profile references, URLs, and viewport settings survive restart. (E2e verifies the same pane ID, Alice profile ID, authenticated URL, and mobile 390 × 844 DPR 3 settings.)
- [x] Legacy grid/freeform workspaces normalize to Canvas. (Unit tests assert Canvas normalization; old fields remain readable.)
- [x] Canvas positions and viewport settings survive restart. (E2e compares the persisted Canvas position and restores the iPhone SE viewport.)
- [x] Closed profile data is retained and isolated. (E2e reads Bob's persistent partition cookies after Bob's pane was closed and the app restarted.)
- [x] Corrupt workspace and app-state files recover safely. (Unit tests verify `.corrupt-<timestamp>` preservation and safe defaults.)
- [x] Invalid workspace pane URLs/viewports are rejected before writing. (Unit tests reject `javascript:` URLs and malformed profiles/panes.)
- [x] Normal window bounds restore safely after restart. (E2e saves a distinctive 1120 × 820 window, verifies app-state, and compares bounds after relaunch.)
- [x] Maximized/full-screen window state restores. (E2e maximizes, verifies app-state, relaunches, confirms maximized state, then unmaximizes; a focused full-screen relaunch script verified the full-screen path and clearing.)
- [x] Theme preference restores. (E2e selects Dark, verifies dark tokens and app-state, relaunches, confirms Dark restores, then resets to System.)
- [ ] Theme preference is stored per workspace. (Theme is application-wide.)
- [ ] Pane maximize state restores. (Pane maximize remains intentionally temporary; application-window maximize now restores.)
- [x] Workspace create/rename/duplicate/switch/delete. (E2e creates a second workspace, switches, adds a pane, renames, duplicates with fresh profiles, switches back to the authenticated original, verifies active-state persistence, and deletes the extras.)
- [x] Workspace export/import serialization excludes profiles and restores fresh identities. (Unit tests cover round-trip, profile stripping, fresh IDs, unsafe URLs/viewports, and invalid layout.)
- [ ] Native workspace import/export dialogs. (Pure logic is unit-tested; the Save/Open dialog path is not automated or manually re-run in this slice.)
- [ ] Workspace switching keeps background pages warm. (Switching destroys and recreates native views; pages reload.)
- [x] Explicit profile assignment/sharing across panes. (Profile manager Open pane; shared count shown in pane headers and usage.)

## Viewport emulation

- [x] Each pane can use a different viewport. (E2e sets Alice to mobile 390 × 844 and Bob to tablet 820 × 1180 at the same time.)
- [x] Fixture `window.innerWidth` matches configured width. (E2e: mobile 390, tablet 820, custom 500.)
- [x] Fixture `window.innerHeight` matches configured height. (E2e: mobile 844, tablet 1180, custom 700.)
- [x] Device scale factor behavior documented and verified for emulation. (E2e: mobile DPR 3, tablet DPR 2, custom DPR 2; see ADR-010.)
- [x] Fixed viewport presets use their declared CSS dimensions and scale with Canvas zoom. (E2e checks mobile/tablet/custom/Pixel dimensions and responsive emulation at 100%.)
- [x] The **+** add menu creates a pane with the selected device preset. (E2e opens the custom menu, selects iPhone 15 Pro, and verifies the new pane's viewport.)
- [x] The right-click Canvas menu exposes Add pane, view, hand, manage, and appearance actions. (E2e uses Add pane, toggles Hand, and switches Light/System.)
- [x] Invalid custom viewport values are rejected visibly. (E2e enters a 100 px width, sees the alert, and confirms the previous preset remains active.)
- [x] Pane chrome and the embedded top toolbar remain usable at narrow widths. (Manual review at 720 × 560; the toolbar collapses the active-pane context and keeps the address/viewport/reload/add controls.)
- [x] Canvas pans an infinite dotted workspace and hides native views during the gesture. (E2e pans, verifies all native views hide, and verifies visible bounds realign afterward.)
- [x] Canvas snapshots cover native views during panning. (E2e waits for two `.pane-snapshot` images before panning; the image stays behind native views at rest.)
- [x] Dragging a pane header moves only that pane; dragging empty canvas pans the world. (E2e drags a label and verifies the other frame and canvas background position do not move.)
- [x] Website content stays interactive in Canvas mode while the header remains the drag handle. (Native views are restored when fully visible; content events stay inside the page.)
- [x] Holding Space temporarily enables the Hand tool and hides native views. (E2e holds Space, verifies the workspace Hand class and hidden native views, then releases it.)
- [x] Hand-mode wheel zoom scales the canvas while preserving the page CSS viewport. (E2e wheel-zooms out, checks the 560 × 700 page metrics, verifies responsive pane emulation is enabled below 100%, resets zoom from the bottom bar, and verifies it disables.)
- [x] Wheel panning realigns native views after the gesture. (E2e wheel-pans and verifies visible native bounds match the DOM at the new positions.)
- [x] Canvas opens fitted to all panes. (E2e verifies both pane cards start inside the workspace; the same ready/retry path runs after a workspace switch.)
- [x] Bottom canvas bar Hand, zoom steps, presets, Fit all, Reset, and appearance work. (E2e checks the native bar at bottom center, toggles Hand, zooms out, opens the 7-preset menu, selects 50%, resets to 100%, and opens the appearance menu. The bar and minimap stay visible while its menus are open.)
- [x] The top toolbar embeds the active-pane URL/navigation/viewport controls and keeps Reload/Add on the right. (E2e verifies the single-row toolbar, the embedded address controls, and the absence of Workspace/Profiles/Hand/Appearance toolbar buttons.)
- [x] Workspace and profile management live in the native menu bar. (E2e triggers `workspace-manage` and `profiles-manage` menu items, opens both dialogs, and verifies focus returns to the active address input.)
- [x] Clicking empty canvas clears the active pane and interacting with a pane restores it. (E2e clicks empty canvas, verifies no active card and an empty "No device selected" toolbar state, then clicks a pane title and verifies the address input returns.)
- [x] The top toolbar does not shift the canvas. (E2e captures the workspace rectangle before deselection, after deselection, and after reselection; all three are identical. The toolbar stays 42 px with an empty state.)
- [x] All top-toolbar buttons are borderless. (E2e computes 0 px borders for every button in the toolbar.)
- [x] Device actions stay visible at every Canvas zoom. (E2e sets 430 × 932 and 393 × 852 devices, zooms to 80% so their widths straddle the old 340 px breakpoint, and verifies back, forward, reload, actions, and close on both.)
- [x] Canvas zoom scales the whole pane while the viewport stays fixed. (Measured a 560 × 700 viewport at 100%, 50%, and 200%: the card/header scale to 560 × 732/32, 280 × 366/16, and 1120 × 1464/64 while `window.innerWidth/Height` stays 560 × 700.)
- [ ] Hand tool pans from over a pane. (E2e verifies the Hand tool hides native views and toggles state; pointer panning from inside a frame needs a manual GUI pass.)
- [x] Canvas overview is always visible in Canvas, shows every pane and the current viewport, and Fit all brings all panes back. (E2e enters Canvas without opening anything, verifies the native panel at the bottom-right, both frame buttons and the viewport outline, clicks Fit all, and asserts both cards fit inside the workspace with native bounds aligned.)
- [x] Canvas overview collapses and expands, recenters from empty map space, and hides while a custom menu or dialog is open. (E2e checks the native view height changes, the map hides/restores, the workspace background recenters, and the panel hides during menus.)
- [x] Canvas overview frame selection and focus return. (E2e clicks a minimap frame, verifies the pane centers and becomes active, and checks the shell regains keyboard focus; the panel was also exercised visually at desktop and minimum-window widths.)
- [ ] Canvas zoom at levels where frames no longer fit. (Implemented as snapshot preview; visual review of very high zoom and partially visible frames remains manual.)
- [ ] Spacebar while a website page has focus. (Intentionally not intercepted to preserve typing/scrolling; expected to work only when shell chrome has focus.)
- [ ] Partially visible canvas pane centers and restores live view when clicked. (Implemented; manual visual pass outstanding.)
- [ ] Device bezels. (Not implemented.)
- [ ] Fill/crop display mode for panes whose aspect ratio differs from the viewport preset. (Not implemented; fixed viewports letterbox to keep the full viewport visible.)
- [ ] Optional per-pane user-agent override. (Not implemented.)

## Accessibility and appearance

Phase 4 automated coverage (`tests/e2e/accessibility.spec.ts`): Playwright role/accessible-name checks, keyboard focus order and focus-visible assertions, dialog focus trapping and dialog focus return to the active address, Chromium's CDP accessibility tree, and an axe-core WCAG 2.x/best-practice audit for the shell toolbar, pane cards, profile dialog, workspace dialog, and bottom canvas bar. VoiceOver and other screen-reader behavior still require manual review; axe cannot verify spoken order, announcements, or whether a focus ring is meaningful to a particular user.

- [x] Icon-only controls have accessible names and tooltips. (Automated role/name checks for reload-all, device actions, close, header navigation, and the bottom Hand/zoom/appearance controls; tooltips are asserted for shell reload-all, device actions, close, and reload device.)
- [x] Keyboard focus is visible on shell controls. (Automated Tab/Shift+Tab assertions verify `:focus-visible` and a 2 px accent outline; the dialog container shows the same ring when opened from the keyboard.)
- [x] Focus moves to the new pane after add and recovers to an address control after close. (Existing e2e assertions.)
- [x] Tab order crosses the toolbar, pane controls, address, and viewport controls in DOM order without entering native content. (Automated forward/reverse focus assertions; disabled Back/Forward are skipped.)
- [x] The active pane is visible and announced. (Exactly one accent-bordered card with `aria-current="true"`; focus moves the active card.)
- [x] Dialog triggers expose `aria-haspopup`/`aria-expanded` and named workspace state. (Automated before/after open assertions.)
- [x] Profile and workspace dialogs expose names/descriptions, focus the dialog on open, trap Tab/Shift+Tab, close on Escape, and return focus to the trigger. (Automated keyboard-only test.)
- [x] Repeated profile/workspace row actions have unique contextual accessible names. (Open pane, Rename, Clear, Delete, Switch, Duplicate now include the profile/workspace label.)
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

- [x] Repeated workspace switching does not leak `webContents` or native views. (E2e creates a four-pane stress workspace, cycles back to the original, and compares non-destroyed webContents/view counts; default 3 cycles, configurable via `PANEFLOW_STRESS_CYCLES`.)
- [x] Eight-pane Canvas add/close stress. (E2e grows to eight panes, verifies cards and native views, then closes back to two.)
- [x] Short loaded-page soak with memory sampling. (8 cycles: 2 webContents, 575 MB → 515 MB; 25 cycles: 2 webContents, 573 MB → 643 MB; final `main` 50 cycles: 2 webContents, 589 MB → 684 MB; earlier runs: 577 MB → 577 MB, 581 MB → 677 MB, and 588 MB → 682 MB.)
- [x] Accessibility suite starts and closes a separate Electron app cleanly without affecting the main integration run. (Two Playwright tests pass in one worker.)
- [ ] Multi-hour memory/CPU profiling with loaded third-party pages. (Not run. Working set is sampled before/after, not peak, and 50 cycles take ≈20 s.)
- [ ] CPU/frame measurement during drag, resize, and scrolling. (Not run.)

## Packaging

- [x] `npm run package:mac` builds an arm64 DMG, ZIP, and `.app`. (Artifacts produced under `dist/`.)
- [x] Bundle ID, version, icon, and category are correct. (`com.kanharithsok.paneflow`, `0.1.0`, `icon.icns`, developer tools.)
- [x] Packaged app launches and renders the shell and panes. (Manual launch and screenshot.)
- [x] Electron fuses are applied to the packaged app. (`npx electron-fuses read --app dist/mac-arm64/PaneFlow.app`; RunAsNode/Node-options/inspector/file-protocol privileges disabled, ASAR integrity and only-load-from-ASAR enabled.)
- [ ] Developer ID signing and notarization. (Post-MVP; blocked on Apple Developer credentials. The supported distribution is the unsigned/ad-hoc local arm64 build.)
- [ ] Intel/universal packaging. (Current build is arm64-only by owner decision.)
- [ ] Auto-update and release publishing. (Not implemented.)

## Security and failure handling

- [x] Dangerous URL schemes are rejected. (Main-process navigation test rejects `javascript:`; unit tests cover `data:`, `file:`, `chrome:`, embedded credentials, and oversized URLs.)
- [x] Remote pages cannot access the app preload bridge or Node APIs. (E2e checks `window.paneflow`, `require`, and `process` are undefined.)
- [x] Unsupported top-level navigation from a remote page is blocked. (E2e attempts `file:` and `data:` locations and verifies the pane URL is unchanged.)
- [x] IPC rejects malformed payloads. (Unknown pane IDs and malformed bounds rejected in e2e/unit tests.)
- [x] IPC rejects an invalid sender. (E2e creates a separate node-enabled `BrowserWindow` and verifies empty state plus `Unauthorized sender.`.)
- [x] The shell loads from the secure internal protocol with an enforced CSP. (E2e observes `paneflow://shell/index.html`, inline script blocked, and cross-origin fixture fetch blocked.)
- [x] Popups and permissions follow the documented policy. (Popup and notification request denied in e2e; display/device/Bluetooth handlers deny by default.)
- [x] A page that destroys its own `webContents` removes the pane cleanly. (E2e invokes `window.close()` in a pane; the other pane remains.)
- [ ] Renderer crash/navigation failure does not crash the app shell. (Failure UI exists; crash recovery needs a dedicated check.)
- [x] No secrets appear in logs, exports, fixtures, or repository files. (Repository review; fixtures contain only synthetic identities; credential-bearing URLs are rejected and export profiles are stripped.)
- [ ] Window shutdown leaves no orphaned views/processes. (Teardown implemented and e2e closes panes/windows; repeat after Phase 2.)

- [x] Device rotation swaps the emulated viewport and canvas frame. (E2e rotates a custom 500 × 1000 viewport through the validated IPC path, verifies a 1000 × 500 page and rotated frame, then restores it.)
- [x] Screenshot capture writes a PNG. (E2e patches the native save dialog, captures the selected device through the validated IPC path, and verifies the PNG signature.)
- [x] Delete closes the selected device from shell focus, and text-entry focus is protected. (E2e presses Backspace in the address field without closing, then Delete to close the duplicate. Cmd+D is a native Device-menu accelerator and routing is tested; OS-level chord delivery is manual.)
