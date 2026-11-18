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
- [x] Theme preference restores. (E2e selects Dark, verifies dark tokens and app-state, relaunches, confirms Dark restores, then resets to System.)
- [ ] Theme preference is stored per workspace. (Theme is application-wide.)
- [ ] Maximized/fullscreen window state restores. (Intentionally not persisted.)
- [ ] Maximized/focused state restores. (Intentionally not persisted.)
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
- [x] Fit and actual display modes behave as specified. (E2e asserts fit scale below 1, actual scale 1, and unchanged CSS viewport values. Manual macOS capture shows fit scaled inside the pane and actual at 1:1; actual clips a viewport taller than the pane.)
- [x] Invalid custom viewport values are rejected visibly. (E2e enters a 100 px width, sees the alert, and confirms the previous preset remains active.)
- [x] Pane chrome remains usable at five grid columns. (E2e asserts no horizontal header overflow and a usable address width; controls wrap to a second row.)
- [ ] Pane-level scrolling/panning for an actual-mode viewport larger than the pane. (Not implemented; the oversized surface is clipped.)
- [ ] Optional per-pane user-agent override. (Not implemented.)

## Accessibility and appearance

- [x] Icon-only controls have accessible names and tooltips. (Code review and Playwright role-based clicks.)
- [x] Keyboard focus is visible on shell controls. (Focus ring improved to use the accent color; address error is linked with `aria-describedby`.)
- [x] Focus moves to the new pane after add and recovers to an address control after close. (E2e assertions.)
- [ ] Keyboard focus can enter native browser content and return to chrome. (Native pane focus handoff is Phase 2.)
- [ ] Full screen-reader pass across toolbar, pane chrome, and status announcements. (Not run.)
- [x] System light/dark tokens resolve correctly. (E2e emulates both color schemes; dark appearance manually reviewed.)
- [ ] Contrast audit across every control and state. (Small-text tokens were improved during review; full audit remains.)
- [x] Reduced-motion behavior. (Global media rule disables animations/transitions/smooth scrolling when requested.)
- [x] Active pane is visible and announced. (E2e verifies one accent-bordered `aria-current` card and updates it from focus.)
- [x] Narrow-window and minimum-pane-width control usability. (E2e verifies no toolbar overflow at 760 px; pane headers wrap at five columns.)
- [x] Dialog triggers expose `aria-haspopup`/`aria-expanded` and named workspace state. (E2e assertions.)
- [x] No visible control is knowingly inert. (Add, close, back, forward, reload, reload-all, address, retry, menu, dismiss are implemented.)

## Performance and lifecycle

- [x] Repeated workspace switching does not leak `webContents` or native views. (E2e performs four round trips with a four-pane stress workspace, two loaded fixture pages, and compares non-destroyed webContents/view counts after every return.)
- [x] Eight-pane grid/freeform alignment stress. (Existing e2e pass.)
- [ ] Long-duration memory profiling with loaded third-party pages. (Not run.)
- [ ] CPU/frame measurement during drag, resize, and scrolling. (Not run.)

## Packaging

- [x] `npm run package:mac` builds an arm64 DMG, ZIP, and `.app`. (Artifacts produced under `dist/`.)
- [x] Bundle ID, version, icon, and category are correct. (`com.kanharithsok.paneflow`, `0.1.0`, `icon.icns`, developer tools.)
- [x] Packaged app launches and renders the shell and panes. (Manual launch and screenshot.)
- [ ] Developer ID signing and notarization. (Blocked on Apple Developer credentials; current build is unsigned/ad-hoc.)
- [ ] Intel/universal packaging. (Current build is arm64-only by owner decision.)
- [ ] Auto-update and release publishing. (Not implemented.)

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
