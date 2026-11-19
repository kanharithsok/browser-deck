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

- [ ] Add, remove, rename, duplicate, and reorder panes. (Add/remove and drag reorder work; rename/duplicate pending.)
- [x] Drag a pane to change grid order. (E2e drags both directions; native views hide during drag and restore aligned.)
- [x] Keyboard/menu pane and layout actions. (Native Pane menu commands for add, close, reload, maximize, and layout are exercised by e2e; raw key chords remain a follow-up.)
- [x] Next/previous workspace menu shortcuts. (E2e invokes `workspace-next` and `workspace-previous`, verifies accelerator metadata, restored pane/profile identity, wrapping, and disabled state when only one workspace exists.)
- [ ] Keyboard pane reordering. (Pending.)
- [x] Eight-pane grid/freeform alignment stress. (E2e adds to eight panes, drags/resizes, z-orders, maximizes, and checks native alignment.)
- [x] Grid column changes and reflow. (Selector exposes 1–5; e2e verifies 2 → 5 → 1 → 2 and native alignment.)
- [x] Add/remove reflows the grid without losing panes. (E2e checks native alignment after add and close.)
- [x] Grid scrolling when rows exceed the available height. (Workspace scrolls to engine content height.)
- [x] Off-screen/partial native views are hidden and cannot cover chrome. (E2e scrolls an overflowing grid and checks visible bounds stay inside the workspace.)
- [ ] Freeform drag, resize, overlap, z-order, and snap behavior. (Drag/resize, explicit z-order controls, and snapping are wired; overlap/guide checks remain.)
- [x] Freeform pane drag and resize with native alignment. (E2e moves and resizes with native views hidden during manipulation.)
- [x] Explicit freeform z-order controls. (E2e verifies native child order and DOM z-index for bring-front/send-back.)
- [x] Switching grid/freeform preserves both arrangements. (E2e cycles modes and checks geometry.)
- [x] Maximize/restore returns to the prior geometry. (E2e maximizes a grid pane, hides unrelated native views, and restores the prior bounds.)
- [x] Layout restores after app restart. (E2e restores one pane in freeform mode with its saved geometry, mobile viewport, and one-column grid setting; switching back to Grid shows the saved columns.)

## Workspace persistence

- [x] Pane IDs, profile references, URLs, and viewport settings survive restart. (E2e verifies the same pane ID, Alice profile ID, authenticated URL, and mobile 390 × 844 DPR 3 settings.)
- [x] Grid columns and grid/freeform mode survive restart. (E2e restores a freeform workspace with columns set to 1, then returns to Grid.)
- [x] Freeform geometry survives restart. (E2e compares the restored normalized pane rectangle with the persisted value.)
- [x] Closed profile data is retained and isolated. (E2e reads Bob's persistent partition cookies after Bob's pane was closed and the app restarted.)
- [x] Corrupt workspace and app-state files recover safely. (Unit tests verify `.corrupt-<timestamp>` preservation and safe defaults.)
- [x] Invalid workspace pane URLs/viewports are rejected before writing. (Unit tests reject `javascript:` URLs and malformed profiles/panes.)
- [x] Normal window bounds restore safely after restart. (E2e saves a distinctive 1120 × 760 window, verifies app-state, and compares bounds after relaunch.)
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
- [x] Fixed viewport presets always fit the pane content and refit after frame resizing. (E2e asserts fit scale below 1, recomputes the scale when the grid narrows, and restores it when the frame returns to its prior size. Responsive panes remain 1:1.)
- [ ] Add-pane device dropdown creates a pane with the selected preset. (Toolbar control, validation, and the add-pane-with-viewport creation path are automated; selecting the item from the native menu still needs a manual GUI check.)
- [x] Invalid custom viewport values are rejected visibly. (E2e enters a 100 px width, sees the alert, and confirms the previous preset remains active.)
- [x] Pane chrome remains usable at five grid columns. (E2e asserts no horizontal header overflow and a usable address width; controls wrap to a second row.)
- [x] Canvas mode pans an infinite dotted workspace and hides native views during the gesture. (E2e switches to Canvas, pans, verifies all native views hide, and verifies visible bounds realign afterward.)
- [x] Canvas snapshots cover native views during panning. (E2e waits for two `.pane-snapshot` images before panning; the image stays behind native views at rest.)
- [x] Dragging a pane label moves only that pane; dragging empty canvas pans the world. (E2e drags a label and verifies the other frame and canvas background position do not move.)
- [x] Website content stays interactive in Canvas mode while the label remains the drag handle. (Native views are restored when fully visible; content events stay inside the page.)
- [ ] Hand tool pans from over a pane. (E2e verifies the Hand tool hides native views and toggles state; pointer panning from inside a frame needs a manual GUI pass.)
- [ ] Partially visible canvas pane centers and restores live view when clicked. (Implemented; manual visual pass outstanding.)
- [ ] Canvas zoom and device bezels. (Not implemented in the first Canvas slice.)
- [ ] Fill/crop display mode for panes whose aspect ratio differs from the viewport preset. (Not implemented; fixed viewports letterbox to keep the full viewport visible.)
- [ ] Optional per-pane user-agent override. (Not implemented.)

## Accessibility and appearance

Phase 4 automated coverage (`tests/e2e/accessibility.spec.ts`): Playwright role/accessible-name checks, keyboard focus order and focus-visible assertions, dialog focus trapping and focus return, Chromium's CDP accessibility tree, and an axe-core WCAG 2.x/best-practice audit for the shell toolbar, pane cards, profile dialog, and workspace dialog. VoiceOver and other screen-reader behavior still require manual review; axe cannot verify spoken order, announcements, or whether a focus ring is meaningful to a particular user.

- [x] Icon-only controls have accessible names and tooltips. (Automated role/name checks for reload-all, pane actions, maximize/restore, close, and navigation; tooltips are asserted for shell reload-all, maximize, pane actions, close, and reload pane.)
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
- [ ] Pane chrome preview: Quiet bar, Canvas label, and Global bar. (All three render against the same workspace; the native Add pane menu selection itself needs a manual GUI check.)
- [x] Contrast audit across defined light/dark token pairs. (`npm run check:contrast` verifies 13 pairs per theme; full control/state screenshot audit remains.)
- [x] Reduced-motion behavior. (Global media rule disables animations/transitions/smooth scrolling when requested.)
- [x] Narrow-window and minimum-pane-width control usability. (E2e verifies no toolbar overflow at 760 px; pane headers wrap at five columns.)
- [x] No visible control is knowingly inert. (Add, close, back, forward, reload, reload-all, address, retry, menu, dismiss are implemented.)

## Performance and lifecycle

- [x] Repeated workspace switching does not leak `webContents` or native views. (E2e creates a four-pane stress workspace with two loaded fixture pages and compares non-destroyed webContents/view counts after every return; default 3 cycles, configurable via `PANEFLOW_STRESS_CYCLES`.)
- [x] Eight-pane grid/freeform alignment stress. (Existing e2e pass.)
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
