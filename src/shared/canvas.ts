import type { Size } from './layout'
import type { PaneViewport } from './viewports'

export interface CanvasPosition {
  x: number
  y: number
}

export const CANVAS_ORIGIN = 40
export const CANVAS_GAP = 60
export const CANVAS_ROW_WIDTH = 2400
export const CANVAS_HEADER_HEIGHT = 32
export const CANVAS_RESPONSIVE_WIDTH = 560
export const CANVAS_RESPONSIVE_HEIGHT = 700
export const MAX_CANVAS_COORDINATE = 1_000_000

/** Content size of a canvas frame, excluding PaneFlow chrome. */
export function canvasContentSize(viewport: PaneViewport): Size {
  if (viewport.preset === 'responsive') {
    return { width: CANVAS_RESPONSIVE_WIDTH, height: CANVAS_RESPONSIVE_HEIGHT }
  }
  return { width: viewport.width, height: viewport.height }
}

/** Full canvas frame size, including the compact pane label row. */
export function canvasFrameSize(viewport: PaneViewport): Size {
  const content = canvasContentSize(viewport)
  return { width: content.width, height: content.height + CANVAS_HEADER_HEIGHT }
}

export function isValidCanvasPosition(value: unknown): value is CanvasPosition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const position = value as Record<string, unknown>
  return (
    typeof position.x === 'number' &&
    typeof position.y === 'number' &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Math.abs(position.x) <= MAX_CANVAS_COORDINATE &&
    Math.abs(position.y) <= MAX_CANVAS_COORDINATE
  )
}

/**
 * Deterministic row-flow layout for panes that do not have a saved canvas
 * position yet. Existing positions are never moved.
 */
export function defaultCanvasPositions(
  panes: ReadonlyArray<{ id: string; viewport: PaneViewport }>
): Record<string, CanvasPosition> {
  const positions: Record<string, CanvasPosition> = {}
  let x = CANVAS_ORIGIN
  let y = CANVAS_ORIGIN
  let rowHeight = 0

  for (const pane of panes) {
    const size = canvasFrameSize(pane.viewport)
    if (x > CANVAS_ORIGIN && x + size.width > CANVAS_ROW_WIDTH) {
      x = CANVAS_ORIGIN
      y += rowHeight + CANVAS_GAP
      rowHeight = 0
    }
    positions[pane.id] = { x: Math.round(x), y: Math.round(y) }
    x += size.width + CANVAS_GAP
    rowHeight = Math.max(rowHeight, size.height)
  }

  return positions
}
