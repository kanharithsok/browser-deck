---
name: BrowserDeck UX Design
description: Design and review BrowserDeck user flows, workspace interactions, pane behavior, navigation, feedback, accessibility, and edge states. Use when changing how the app works, not only how it looks.
---

# BrowserDeck UX Design

Use this skill when designing or changing workspace behavior, navigation, browser-pane controls, menus, dialogs, onboarding, keyboard shortcuts, accessibility, or interaction states. Pair it with `browserdeck-design-system` for visual styling.

## Product context

BrowserDeck is a native desktop workspace for multiple independent, interactive browser sessions. Users arrange browser panes to compare websites, environments, accounts, and viewport sizes.

Keep these concepts distinct and use their names consistently:

- **Workspace:** a saved arrangement and collection of panes.
- **Pane:** one visible browser view with its own navigation and viewport.
- **Browser profile:** the persistent browser session (cookies, storage, cache, and related data) assigned to a pane.
- **Viewport preset:** a size and emulation configuration; it is not a promise of physical-device accuracy.

Do not use “tenant” as a core product concept. BrowserDeck serves many workflows beyond multi-tenant SaaS.

## UX principles

1. **Quiet, useful interface.** The websites are the primary content. Keep application chrome compact and unobtrusive.
2. **Direct manipulation.** Dragging, resizing, snapping, reordering, and maximizing should behave predictably and provide immediate feedback.
3. **Visible state.** Make the active pane, current layout mode, snap status, loading state, and selected viewport understandable without opening developer tools.
4. **Progressive disclosure.** Keep frequent actions visible. Put rare or advanced actions in a clearly named menu. Do not hide essential actions behind hover-only controls.
5. **Keyboard is a first-class path.** Important actions must have keyboard access. Dragging must not be the only way to move or arrange a pane.
6. **Consistent language.** Use plain, stable terms and sentence case. Prefer verbs that explain the result: “Add browser”, “Reload pane”, “Save workspace”.
7. **Recoverable behavior.** Avoid silent data loss. Preserve profiles when panes close unless the user explicitly deletes or clears a profile.
8. **Density without clutter.** Support many panes while keeping minimum-size controls legible and operable. Remove decoration before reducing useful functionality.

## Before implementation

For any meaningful UX change:

1. Read the relevant product requirements in `SPEC.md` and current decisions in `docs/DECISIONS.md`.
2. Identify the user goal and the shortest sensible flow.
3. Identify affected states, keyboard paths, focus changes, and failure cases.
4. Check whether the behavior conflicts with native `WebContentsView` layering or focus constraints. Read `electron-native-views` when relevant.
5. Prefer a small change that fits existing interaction patterns. Do not add a new panel, wizard, dialog, or settings section unless it solves a real problem.

For non-trivial flows, write concise acceptance scenarios before coding. Do not create a separate design document for trivial changes.

## Core interaction guidance

### Workspace and panes

- Make “Add browser” easy to find, especially in the empty workspace.
- When a pane is added, establish a clear result: the new pane appears, receives appropriate focus, and presents an obvious address/navigation affordance.
- Keep pane actions close to the pane they affect. Label pane-specific actions so users do not confuse them with workspace-wide actions.
- Distinguish pane actions from workspace actions. “Reload pane” and “Reload all” must never be ambiguous.
- Provide a clear active/focused pane treatment without heavy borders or distracting color fills.
- Reordering and layout changes should preserve pane identity, URL, and assigned browser profile.
- Closing a pane should close its view, but should not silently delete its browser profile or stored session data.

### Grid, freeform, drag, and resize

- Make the current layout mode and snap state visible.
- In grid mode, communicate where a pane will land before dropping it.
- In freeform mode, show restrained alignment guides and a clear snap preview.
- Use usable resize hit areas, even when the visible handle is subtle.
- Enforce minimum pane dimensions so headers and essential controls do not collapse into unusable fragments.
- Avoid accidental drags when users intend to click a control or select text. Drag from a deliberate handle/header region.
- Provide a non-drag alternative for moving panes, such as a “Move to…” or position menu, where practical.
- Do not change grid and freeform layouts destructively when switching modes. Preserve each mode's saved arrangement if specified by the product model.
- During resize and drag, prioritize responsiveness. Avoid excessive animation and avoid delaying pointer feedback.

### Browser navigation and profiles

- Keep each pane's URL and navigation controls visibly associated with that pane.
- URL entry must explain or safely normalize missing schemes according to the URL policy in `SPEC.md`.
- Make profile identity understandable without exposing cookies, tokens, or other secrets.
- Clearly distinguish clearing browsing data from closing a pane or deleting a profile. Destructive profile actions need explicit, specific confirmation.
- Never imply that clearing one profile affects another.
- Avoid showing full sensitive query strings or credentials in diagnostics, toasts, or logs.

### Viewport emulation

- Distinguish the pane's on-screen size from the website's emulated viewport size.
- Show the selected preset or custom dimensions in a compact, understandable way.
- Make it clear when a custom setting is active.
- Avoid claiming exact simulation of a physical device. Use “viewport” or “emulation”, not “real device”.
- Preserve a user's custom dimensions unless they explicitly select another preset.

## Design the states, not only the happy path

For each interactive component or workflow, consider applicable states:

- Empty / first use.
- Creating / opening.
- Loading / navigating.
- Ready / idle.
- Focused / selected.
- Hover / pressed / disabled.
- Resizing / dragging / snapping.
- Recoverable error.
- Browser renderer crash / reload required.
- Closing / removed.
- Saving / saved / save failure.

Use clear, actionable messages. Say what happened and what the user can do next. Do not use vague errors such as “Something went wrong” when a useful cause or action is known.

Do not show a spinner indefinitely. Provide a recovery action for failed navigation or crashed browser content where technically possible.

Do not invent unsaved-page detection or claim a page is safe to close unless the implementation can establish that fact.

## Keyboard, focus, and accessibility

- Ensure every toolbar action and pane action is keyboard reachable.
- Use visible focus indicators that fit the visual system.
- Define and document shortcuts; avoid collisions with common browser shortcuts and OS shortcuts.
- Do not capture keystrokes intended for the active website. Scope workspace shortcuts carefully and explain when the application has focus.
- Manage focus when opening/closing menus, dialogs, and panes. Return focus to a sensible control when an overlay closes.
- Do not communicate state by color alone.
- Respect system text sizing where practical, sufficient contrast, and reduced-motion preferences.
- Ensure controls have accessible names and tooltips for icon-only actions.
- Prefer native menu, keyboard, and platform conventions when they improve usability without creating inconsistent cross-platform behavior.

## Native browser-view constraints

The Electron browser views are native views, not DOM elements. Never design an interaction that assumes Vue DOM elements can automatically overlay website content, receive clicks above it, or share its focus behavior.

For menus, tooltips, dialogs, drag feedback, selection, and pane chrome:

- Verify the actual Phase 0 composition decision in `docs/DECISIONS.md`.
- Test z-order, hit testing, focus, and pointer behavior in the running application.
- Do not assume transparent overlays or click-through behavior without a working test.
- Keep the browser content rectangle and its controls coordinated during resize and layout changes.

## UX review checklist

Before marking a meaningful UI feature complete, verify:

- Can a first-time user understand what to do next?
- Is the primary action obvious without making the interface noisy?
- Are pane-level and workspace-level actions clearly separated?
- Does the interaction work with mouse and keyboard?
- Are hover, focus, disabled, loading, empty, error, and recovery states handled where relevant?
- Does the layout remain usable with 1, 4, 8, and 10 panes?
- Do minimum pane sizes preserve essential controls?
- Does changing layouts preserve pane identity and browser profiles?
- Are labels concise, consistent, and written in plain language?
- Does the interface remain calm in both light and dark appearance?
- Is any visual element decorative rather than useful? Remove it.

For a meaningful completed UI slice, use the `/review` command with this skill and `browserdeck-design-system` loaded. Provide screenshots or a runnable build when available. The review must distinguish concrete usability/accessibility problems from subjective taste.
