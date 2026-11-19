import type { Rect, Size } from './layout'
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
export const CANVAS_SNAP_THRESHOLD = 8
export const MAX_CANVAS_COORDINATE = 1_000_000

export interface CanvasSnapTarget {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasSnapResult {
  x: number
  y: number
  guides: {
    vertical: number[]
    horizontal: number[]
  }
  snappedX: boolean
  snappedY: boolean
}

interface AxisSnap {
  value: number
  guide: number | null
}

function snapAxis(
  start: number,
  size: number,
  targets: readonly number[],
  threshold: number
): AxisSnap {
  const sources = [start, start + size / 2, start + size]
  let best: { delta: number; guide: number } | null = null

  for (const target of targets) {
    for (const source of sources) {
      const delta = target - source
      if (Math.abs(delta) > threshold) {
        continue
      }
      if (!best || Math.abs(delta) < Math.abs(best.delta) - 0.0001) {
        best = { delta, guide: target }
      }
    }
  }

  return best
    ? { value: start + best.delta, guide: best.guide }
    : { value: start, guide: null }
}

/**
 * Snaps a dragged canvas frame to the edges and centers of neighboring frames.
 * The threshold is expressed in world units; callers should divide a screen
 * threshold by the current zoom so snapping feels consistent at every scale.
 */
export function snapCanvasRect(
  rect: Rect,
  targets: readonly CanvasSnapTarget[],
  threshold = CANVAS_SNAP_THRESHOLD
): CanvasSnapResult {
  const fallback: CanvasSnapResult = {
    x: rect.x,
    y: rect.y,
    guides: { vertical: [], horizontal: [] },
    snappedX: false,
    snappedY: false
  }

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    return fallback
  }

  const xTargets: number[] = []
  const yTargets: number[] = []
  for (const target of targets) {
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.width) ||
      !Number.isFinite(target.height) ||
      target.width <= 0 ||
      target.height <= 0
    ) {
      continue
    }
    xTargets.push(target.x, target.x + target.width / 2, target.x + target.width)
    yTargets.push(target.y, target.y + target.height / 2, target.y + target.height)
  }

  const xSnap = snapAxis(rect.x, rect.width, xTargets, threshold)
  const ySnap = snapAxis(rect.y, rect.height, yTargets, threshold)

  return {
    x: Math.round(xSnap.value),
    y: Math.round(ySnap.value),
    guides: {
      vertical: xSnap.guide === null ? [] : [xSnap.guide],
      horizontal: ySnap.guide === null ? [] : [ySnap.guide]
    },
    snappedX: xSnap.guide !== null,
    snappedY: ySnap.guide !== null
  }
}

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
