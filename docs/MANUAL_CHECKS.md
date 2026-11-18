# Manual Verification Checklist

Use local fixture pages and test accounts only. Never record real credentials or private page content.

Legend: checked items were verified during Phase 0 (2026-11-18) on macOS 27.2.1, Apple M4, Retina display, Electron 45.3.4. Unchecked items belong to later phases or still need a separate check.

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

## Browser isolation

- [x] Separate profiles do not share cookies. (`alice` and `bob` cookies, including HttpOnly session cookies, read independently.)
- [x] Separate profiles do not share localStorage. (Fixture click wrote only one pane; the other stayed empty.)
- [x] Separate profiles do not share IndexedDB. (E2e writes and reads a probe store in each profile.)
- [x] The same fixture origin supports two independently authenticated accounts. (Form sign-in as Alice and Bob in separate panes.)
- [x] Signing out of one profile does not sign out the other. (E2e logs Bob out and verifies Alice remains authenticated.)
- [x] Persistent cookie, localStorage, and authenticated session data survive app restart. (E2e relaunches with the same user data; profile IDs, cookies, localStorage, and both account sessions persisted.)
- [x] Closing one pane does not sign out or navigate another. (Remaining pane's session and account stay active; e2e.)
- [x] New panes receive a fresh profile by default. (New-pane profile ID checked.)
- [ ] Duplicated panes receive a fresh profile by default. (Pane duplication is not implemented yet.)
- [ ] Explicitly shared profiles share expected cookie/storage state. (Sharing UI is Phase 3.)
- [x] Session-only cookie and `sessionStorage` limitations are documented. (`SPEC.md`, `README.md`, and architecture docs state the limits.)

## Workspace

- [ ] Add, remove, rename, duplicate, and reorder panes. (Add/remove and drag reorder work; rename/duplicate pending.)
- [x] Drag a pane to change grid order. (E2e drags both directions; native views hide during drag and restore aligned.)
- [ ] Keyboard pane reordering and other keyboard layout interactions. (Pending.)
- [x] Grid column changes and reflow. (Selector exposes 1–5; e2e verifies 2 → 5 → 1 → 2 and native alignment.)
- [x] Add/remove reflows the grid without losing panes. (E2e checks native alignment after add and close.)
- [x] Grid scrolling when rows exceed the available height. (Workspace scrolls to engine content height.)
- [x] Off-screen/partial native views are hidden and cannot cover chrome. (E2e scrolls an overflowing grid and checks visible bounds stay inside the workspace.)
- [ ] Freeform drag, resize, overlap, z-order, and snap behavior. (Drag/resize, z-order raising, and snapping are wired; explicit send-to-back and guide checks remain.)
- [x] Freeform pane drag and resize with native alignment. (E2e moves and resizes with native views hidden during manipulation.)
- [x] Switching grid/freeform preserves both arrangements. (E2e cycles modes and checks geometry.)
- [x] Maximize/restore returns to the prior geometry. (E2e maximizes a grid pane, hides unrelated native views, and restores the prior bounds.)
- [ ] Layout restores after app restart. (Selected columns are not persisted yet.)

## Viewport emulation

- [ ] Each pane can use a different viewport. (Pending.)
- [ ] Fixture `window.innerWidth` matches configured width. (Pending; native pages report viewport for future checks.)
- [ ] Fixture `window.innerHeight` matches configured height. (Pending.)
- [ ] Device scale factor behavior documented and verified for emulation. (Pending; physical Retina DPR behavior verified.)
- [ ] Fit and actual display modes behave as specified. (Pending.)

## Accessibility and appearance

- [x] Icon-only controls have accessible names and tooltips. (Code review and Playwright role-based clicks.)
- [x] Keyboard focus is visible on shell controls. (Focus ring improved to use the accent color; address error is linked with `aria-describedby`.)
- [x] Focus moves to the new pane after add and recovers to an address control after close. (E2e assertions.)
- [ ] Keyboard focus can enter native browser content and return to chrome. (Native pane focus handoff is Phase 2.)
- [ ] Full screen-reader pass across toolbar, pane chrome, and status announcements. (Not run.)
- [x] System light/dark tokens resolve correctly. (E2e emulates both color schemes; dark appearance manually reviewed.)
- [ ] Contrast audit across every control and state. (Small-text tokens were improved during review; full audit remains.)
- [ ] Reduced-motion behavior. (CSS preference handling exists; no dedicated manual check.)
- [ ] Narrow-window and minimum-pane-width control usability. (Container query exists; dedicated check pending.)
- [x] No visible control is knowingly inert. (Add, close, back, forward, reload, reload-all, address, retry, menu, dismiss are implemented.)

## Security and failure handling

- [x] Dangerous URL schemes are rejected. (Main-process navigation test rejects `javascript:`; unit tests cover `data:`, `file:`, `chrome:`.)
- [x] Remote pages cannot access the app preload bridge or Node APIs. (E2e checks `window.paneflow`, `require`, and `process` are undefined.)
- [x] IPC rejects malformed payloads. (Unknown pane IDs and malformed bounds rejected in e2e/unit tests.)
- [ ] IPC rejects an invalid sender. (Sender identity and shell-main-frame checks are implemented; a dedicated cross-webContents test is still pending.)
- [x] Popups and permissions follow the documented policy. (Popup and notification request denied in e2e.)
- [x] A page that destroys its own `webContents` removes the pane cleanly. (E2e invokes `window.close()` in a pane; the other pane remains.)
- [ ] Renderer crash/navigation failure does not crash the app shell. (Failure UI exists; crash recovery needs a dedicated check.)
- [x] No secrets appear in logs, exports, fixtures, or repository files. (Repository review; fixtures contain only synthetic identities.)
- [ ] Window shutdown leaves no orphaned views/processes. (Teardown implemented and e2e closes panes/windows; repeat after Phase 2.)
