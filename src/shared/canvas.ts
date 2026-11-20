import type { Rect, Size } from './layout'
import { viewportContentSize, type PaneViewport } from './viewports'

export interface CanvasPosition {
  x: number
  y: number
}

export const CANVAS_ORIGIN = 40
export const CANVAS_GAP = 60
export const CANVAS_ROW_WIDTH = 2400
export const CANVAS_HEADER_HEIGHT = 64
export const CANVAS_RESPONSIVE_WIDTH = 560
export const CANVAS_RESPONSIVE_HEIGHT = 700
export const CANVAS_SNAP_THRESHOLD = 8
export const CANVAS_NEAR_THRESHOLD = 24
export const CANVAS_NEAR_GAP = 16
export const CANVAS_PROXIMITY_THRESHOLD = 64
export const CANVAS_SHOWCASE_GAP = 24
export const MAX_CANVAS_COORDINATE = 1_000_000

export type CanvasArrangeMode = 'showcase' | 'row' | 'grid' | 'stack'

export interface CanvasArrangeFrame {
  id: string
  width: number
  height: number
}

export interface CanvasScreenFrame extends CanvasSnapTarget {
  id: string
}

/** IDs of frames that overlap a marquee rectangle in the same coordinate space. */
export function canvasPaneIdsInRect(
  frames: ReadonlyArray<CanvasScreenFrame>,
  rect: Rect
): string[] {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return []
  }

  return frames.flatMap((frame) => {
    if (
      frame.id.length === 0 ||
      !Number.isFinite(frame.x) ||
      !Number.isFinite(frame.y) ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      return []
    }
    const overlaps =
      frame.x < rect.x + rect.width &&
      frame.x + frame.width > rect.x &&
      frame.y < rect.y + rect.height &&
      frame.y + frame.height > rect.y
    return overlaps ? [frame.id] : []
  })
}

export interface CanvasSnapTarget {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasSnapOptions {
  threshold?: number
  nearThreshold?: number
  nearGap?: number
  proximityThreshold?: number
}

export interface CanvasSnapResult {
  x: number
  y: number
  guides: {
    vertical: number[]
    horizontal: number[]
  }
  /** Lighter guides for nearby targets that are not close enough to snap. */
  proximity: {
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

interface AxisEdges {
  start: number
  end: number
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
 * First snap stage: leave a small gap to the nearest neighboring edge. Only
 * opposite edges participate, so panes never gap-snap into an overlap.
 */
function gapSnapAxis(
  start: number,
  size: number,
  targets: readonly AxisEdges[],
  gap: number,
  threshold: number
): AxisSnap {
  let best: { delta: number; guide: number } | null = null

  for (const target of targets) {
    const candidates = [
      { delta: target.end + gap - start, guide: target.end },
      { delta: target.start - gap - (start + size), guide: target.start }
    ]
    for (const candidate of candidates) {
      if (Math.abs(candidate.delta) > threshold) {
        continue
      }
      if (!best || Math.abs(candidate.delta) < Math.abs(best.delta) - 0.0001) {
        best = candidate
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
  options: number | CanvasSnapOptions = {}
): CanvasSnapResult {
  const tuning = typeof options === 'number' ? { threshold: options } : options
  const fallback: CanvasSnapResult = {
    x: rect.x,
    y: rect.y,
    guides: { vertical: [], horizontal: [] },
    proximity: { vertical: [], horizontal: [] },
    snappedX: false,
    snappedY: false
  }

  const safeNumber = (value: number | undefined, fallbackValue: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : fallbackValue

  const threshold = safeNumber(tuning.threshold, CANVAS_SNAP_THRESHOLD)
  const nearThreshold = Math.max(
    threshold,
    safeNumber(tuning.nearThreshold, CANVAS_NEAR_THRESHOLD)
  )
  const nearGap = safeNumber(tuning.nearGap, CANVAS_NEAR_GAP)
  const proximityThreshold = Math.max(
    nearThreshold,
    safeNumber(tuning.proximityThreshold, CANVAS_PROXIMITY_THRESHOLD)
  )

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return fallback
  }

  const xTargets: number[] = []
  const yTargets: number[] = []
  const xEdges: AxisEdges[] = []
  const yEdges: AxisEdges[] = []
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
    xEdges.push({ start: target.x, end: target.x + target.width })
    yEdges.push({ start: target.y, end: target.y + target.height })
  }

  const flushX = snapAxis(rect.x, rect.width, xTargets, threshold)
  const flushY = snapAxis(rect.y, rect.height, yTargets, threshold)
  const gapX =
    flushX.guide === null
      ? gapSnapAxis(rect.x, rect.width, xEdges, nearGap, nearThreshold)
      : null
  const gapY =
    flushY.guide === null
      ? gapSnapAxis(rect.y, rect.height, yEdges, nearGap, nearThreshold)
      : null
  const xSnap = flushX.guide !== null ? flushX : (gapX ?? flushX)
  const ySnap = flushY.guide !== null ? flushY : (gapY ?? flushY)
  const xProximity =
    xSnap.guide === null
      ? snapAxis(rect.x, rect.width, xTargets, proximityThreshold).guide
      : null
  const yProximity =
    ySnap.guide === null
      ? snapAxis(rect.y, rect.height, yTargets, proximityThreshold).guide
      : null

  return {
    x: Math.round(xSnap.value),
    y: Math.round(ySnap.value),
    guides: {
      vertical: xSnap.guide === null ? [] : [xSnap.guide],
      horizontal: ySnap.guide === null ? [] : [ySnap.guide]
    },
    proximity: {
      vertical: xProximity === null ? [] : [xProximity],
      horizontal: yProximity === null ? [] : [yProximity]
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
  return viewportContentSize(viewport)
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

function framesOverlapVertically(a: CanvasSnapTarget, b: CanvasSnapTarget): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height
}

function framesOverlapHorizontally(a: CanvasSnapTarget, b: CanvasSnapTarget): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
}

function blocksHorizontalSlot(
  candidate: CanvasSnapTarget,
  target: CanvasSnapTarget,
  gap: number
): boolean {
  if (!framesOverlapVertically(candidate, target)) {
    return false
  }
  return !(
    candidate.x + candidate.width + gap <= target.x ||
    target.x + target.width + gap <= candidate.x
  )
}

function blocksVerticalSlot(
  candidate: CanvasSnapTarget,
  target: CanvasSnapTarget,
  gap: number
): boolean {
  if (!framesOverlapHorizontally(candidate, target)) {
    return false
  }
  return !(
    candidate.y + candidate.height + gap <= target.y ||
    target.y + target.height + gap <= candidate.y
  )
}

function validCanvasSnapTarget(target: CanvasSnapTarget): boolean {
  return (
    Number.isFinite(target.x) &&
    Number.isFinite(target.y) &&
    Number.isFinite(target.width) &&
    Number.isFinite(target.height) &&
    target.width > 0 &&
    target.height > 0
  )
}

/**
 * Places a duplicate immediately to the right of its source, top-aligned with
 * it. If that slot is occupied, the duplicate goes directly below the source
 * at the same left edge, scanning down until it finds a clean gap.
 */
export function duplicateCanvasPosition(
  source: CanvasSnapTarget,
  targets: ReadonlyArray<CanvasSnapTarget>,
  gap = CANVAS_GAP
): CanvasPosition {
  const safeGap = Number.isFinite(gap) && gap >= 0 ? gap : CANVAS_GAP
  const validTargets = targets.filter(validCanvasSnapTarget)
  const rightCandidate: CanvasSnapTarget = {
    x: source.x + source.width + safeGap,
    y: source.y,
    width: source.width,
    height: source.height
  }
  const rightBlocked = validTargets.some((target) =>
    blocksHorizontalSlot(rightCandidate, target, safeGap)
  )
  if (!rightBlocked) {
    return {
      x: Math.round(rightCandidate.x),
      y: Math.round(rightCandidate.y)
    }
  }

  let y = source.y + source.height + safeGap
  for (let pass = 0; pass <= validTargets.length; pass += 1) {
    const candidate: CanvasSnapTarget = {
      x: source.x,
      y,
      width: source.width,
      height: source.height
    }
    const blockers = validTargets.filter((target) =>
      blocksVerticalSlot(candidate, target, safeGap)
    )
    if (blockers.length === 0) {
      break
    }
    const nextY = Math.max(...blockers.map((target) => target.y + target.height + safeGap))
    if (nextY <= y) {
      break
    }
    y = nextY
  }

  return { x: Math.round(source.x), y: Math.round(y) }
}

function arrangeableFrames(
  frames: ReadonlyArray<CanvasArrangeFrame>
): CanvasArrangeFrame[] {
  return frames.filter(
    (frame) =>
      frame.id.length > 0 &&
      Number.isFinite(frame.width) &&
      Number.isFinite(frame.height) &&
      frame.width > 0 &&
      frame.height > 0
  )
}

/**
 * Arranges pane frames from scratch in a deterministic layout. Pane order is
 * preserved. Showcase uses compact rows and centers shorter rows; the other
 * modes use the standard canvas gap.
 */
export function arrangeCanvasFrames(
  frames: ReadonlyArray<CanvasArrangeFrame>,
  mode: CanvasArrangeMode
): Record<string, CanvasPosition> {
  const items = arrangeableFrames(frames)
  const positions: Record<string, CanvasPosition> = {}

  if (mode === 'row') {
    let x = CANVAS_ORIGIN
    for (const frame of items) {
      positions[frame.id] = { x: Math.round(x), y: CANVAS_ORIGIN }
      x += frame.width + CANVAS_GAP
    }
    return positions
  }

  if (mode === 'stack') {
    let y = CANVAS_ORIGIN
    for (const frame of items) {
      positions[frame.id] = { x: CANVAS_ORIGIN, y: Math.round(y) }
      y += frame.height + CANVAS_GAP
    }
    return positions
  }

  if (mode === 'grid') {
    const columns = 2
    const columnWidths = Array.from({ length: columns }, () => 0)
    for (const [index, frame] of items.entries()) {
      const column = index % columns
      columnWidths[column] = Math.max(columnWidths[column] ?? 0, frame.width)
    }

    const columnX = [CANVAS_ORIGIN]
    for (let column = 1; column < columns; column += 1) {
      columnX[column] =
        (columnX[column - 1] ?? CANVAS_ORIGIN) +
        (columnWidths[column - 1] ?? 0) +
        CANVAS_GAP
    }

    const rowHeights: number[] = []
    for (const [index, frame] of items.entries()) {
      const row = Math.floor(index / columns)
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, frame.height)
    }

    const rowY = [CANVAS_ORIGIN]
    for (let row = 1; row < rowHeights.length; row += 1) {
      rowY[row] =
        (rowY[row - 1] ?? CANVAS_ORIGIN) +
        (rowHeights[row - 1] ?? 0) +
        CANVAS_GAP
    }

    for (const [index, frame] of items.entries()) {
      positions[frame.id] = {
        x: Math.round(columnX[index % columns] ?? CANVAS_ORIGIN),
        y: Math.round(rowY[Math.floor(index / columns)] ?? CANVAS_ORIGIN)
      }
    }
    return positions
  }

  // Showcase: pack into compact rows, then center every row against the
  // widest row so the result reads as one intentional presentation.
  const rows: CanvasArrangeFrame[][] = []
  let row: CanvasArrangeFrame[] = []
  let rowWidth = 0
  for (const frame of items) {
    const nextWidth =
      row.length === 0
        ? frame.width
        : rowWidth + CANVAS_SHOWCASE_GAP + frame.width
    if (row.length > 0 && nextWidth > CANVAS_ROW_WIDTH) {
      rows.push(row)
      row = []
      rowWidth = 0
    }
    rowWidth =
      row.length === 0
        ? frame.width
        : rowWidth + CANVAS_SHOWCASE_GAP + frame.width
    row.push(frame)
  }
  if (row.length > 0) {
    rows.push(row)
  }

  const rowWidths = rows.map(
    (entry) =>
      entry.reduce((total, frame) => total + frame.width, 0) +
      Math.max(0, entry.length - 1) * CANVAS_SHOWCASE_GAP
  )
  const widestRow = Math.max(0, ...rowWidths)
  let y = CANVAS_ORIGIN

  rows.forEach((entry, rowIndex) => {
    let x = CANVAS_ORIGIN + (widestRow - (rowWidths[rowIndex] ?? 0)) / 2
    let rowHeight = 0
    for (const frame of entry) {
      positions[frame.id] = { x: Math.round(x), y: Math.round(y) }
      x += frame.width + CANVAS_SHOWCASE_GAP
      rowHeight = Math.max(rowHeight, frame.height)
    }
    y += rowHeight + CANVAS_SHOWCASE_GAP
  })

  return positions
}
