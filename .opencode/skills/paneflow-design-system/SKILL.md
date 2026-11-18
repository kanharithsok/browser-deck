---
name: paneflow-design-system
description: Use before meaningful PaneFlow renderer, layout, CSS, theme, or accessibility work.
---

# PaneFlow design system

Read `AGENTS.md` section “Product and UI direction”, `SPEC.md` section 6, and this file before changing the renderer.

## Direction

PaneFlow is a compact desktop tool, not a marketing page or dashboard. Websites inside panes are the primary content. Chrome should be quiet, predictable, and secondary.

- Use system typography, neutral surfaces, subtle separators, consistent spacing, and one restrained accent.
- Keep the workspace visually dominant. Avoid cards inside cards, gradients, glass, heavy shadows, decorative illustrations, oversized headings, and excessive badges.
- Prefer contextual native menus over permanent sidebars or dense toolbars.
- Never add a visible control that is not implemented. Disabled controls need a clear reason.
- Support light/dark system appearance, keyboard access, visible focus, readable contrast, and reduced motion.

## Implementation tokens

The renderer tokens live in `src/renderer/src/assets/app.css`:

- `--bg`, `--surface`, `--surface-raised`, `--surface-inset`
- `--pane-canvas`
- `--border`, `--border-strong`
- `--text`, `--text-muted`, `--text-faint`
- `--accent`, `--accent-strong`, `--accent-soft`
- `--danger`, `--danger-soft`, `--focus`

Reuse these variables instead of adding one-off colors. Dark mode is selected with `prefers-color-scheme`. Keep `color-scheme: light dark` and reduced-motion handling intact.

## Native-view constraint

`WebContentsView` content is a native rectangle, not DOM. Do not draw DOM controls on top of it. Pane chrome belongs above the native rectangle. Menus that must cover browser content use native `Menu.popup`; empty/error panels require the native view to be hidden first.

See `.opencode/skills/electron-native-views/SKILL.md`.

## Interaction checklist

- Every icon-only button has an accessible name and a tooltip.
- Keyboard focus is visible; controls have a logical tab order.
- Loading, empty, error, disabled, and recovery states are present and truthful.
- Pane chrome remains usable at the minimum pane width; lower-priority metadata drops out before controls collide.
- Dragging, resizing, and overlays have clear hover/active feedback without motion that ignores `prefers-reduced-motion`.
- Light and dark appearance are both checked in the running app.
