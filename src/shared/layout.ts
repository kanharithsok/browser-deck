export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A pane geometry expressed relative to the canvas (0..1). */
export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export const GRID_MIN_COLUMNS = 1
export const GRID_MAX_COLUMNS = 5
export const DEFAULT_GRID_COLUMNS = 2
export const DEFAULT_GRID_PADDING = 10
export const DEFAULT_GRID_GAP = 10
export const DEFAULT_MIN_PANE_WIDTH = 160
export const DEFAULT_MIN_PANE_HEIGHT = 140
export const DEFAULT_SNAP_THRESHOLD = 8

export type LayoutErrorCode =
  | 'invalid-canvas'
  | 'invalid-options'
  | 'invalid-columns'
  | 'invalid-pane-id'
  | 'duplicate-pane-id'
  | 'invalid-rect'

export interface GridLayoutOptions {
  columns: number
  padding?: number
  gap?: number
  minPaneWidth?: number
  minPaneHeight?: number
}

export interface GridPlacement {
  paneId: string
  index: number
  row: number
  column: number
  rect: Rect
}

export interface GridLayout {
  placements: GridPlacement[]
  columns: number
  rows: number
  contentHeight: number
  needsVerticalScroll: boolean
  columnTooNarrow: boolean
}

export type GridLayoutResult =
  | { ok: true; layout: GridLayout }
  | { ok: false; error: LayoutErrorCode }

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface SnapOptions {
  canvas: Size
  neighbors?: readonly Rect[]
  threshold?: number
  snapToCanvas?: boolean
  snapToNeighbors?: boolean
  snapToGrid?: boolean
  gridSize?: number
}

export interface SnapGuides {
  vertical: number[]
  horizontal: number[]
}

export interface SnapResult {
  rect: Rect
  guides: SnapGuides
  snappedX: boolean
  snappedY: boolean
}

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: number): boolean {
  return isFiniteNumber(value) && value > 0
}

function isValidRect(rect: Rect): boolean {
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isPositiveNumber(rect.width) &&
    isPositiveNumber(rect.height)
  )
}

function isValidCanvas(canvas: Size): boolean {
  return isPositiveNumber(canvas.width) && isPositiveNumber(canvas.height)
}

function isValidMinSize(size: Size): boolean {
  return isPositiveNumber(size.width) && isPositiveNumber(size.height)
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function uniqueTargets(values: readonly number[], canvasSize: number): number[] {
  const targets = new Set<number>()
  for (const value of values) {
    const rounded = Math.round(value * 1000) / 1000
    if (rounded >= 0 && rounded <= canvasSize) {
      targets.add(rounded)
    }
  }
  return [...targets].sort((a, b) => a - b)
}

/**
 * Places grid panes in row-major order. Columns share the available width
 * equally; row height respects the minimum and reports when vertical scrolling
 * is required instead of silently dropping panes.
 */
export function layoutGrid(
  paneIds: readonly string[],
  canvas: Size,
  options: GridLayoutOptions
): GridLayoutResult {
  if (!isValidCanvas(canvas)) {
    return { ok: false, error: 'invalid-canvas' }
  }

  const padding = options.padding ?? DEFAULT_GRID_PADDING
  const gap = options.gap ?? DEFAULT_GRID_GAP
  const minPaneWidth = options.minPaneWidth ?? DEFAULT_MIN_PANE_WIDTH
  const minPaneHeight = options.minPaneHeight ?? DEFAULT_MIN_PANE_HEIGHT

  if (
    !Number.isInteger(options.columns) ||
    options.columns < GRID_MIN_COLUMNS ||
    options.columns > GRID_MAX_COLUMNS
  ) {
    return { ok: false, error: 'invalid-columns' }
  }

  if (
    !isFiniteNumber(padding) ||
    padding < 0 ||
    !isFiniteNumber(gap) ||
    gap < 0 ||
    !isPositiveNumber(minPaneWidth) ||
    !isPositiveNumber(minPaneHeight)
  ) {
    return { ok: false, error: 'invalid-options' }
  }

  const seen = new Set<string>()
  for (const paneId of paneIds) {
    if (typeof paneId !== 'string' || paneId.length === 0) {
      return { ok: false, error: 'invalid-pane-id' }
    }
    if (seen.has(paneId)) {
      return { ok: false, error: 'duplicate-pane-id' }
    }
    seen.add(paneId)
  }

  const count = paneIds.length
  const columns = options.columns
  const rows = count === 0 ? 0 : Math.ceil(count / columns)
  const innerWidth = canvas.width - padding * 2 - gap * (columns - 1)
  const cellWidth = Math.max(0, innerWidth / columns)
  const availableRowHeight =
    rows === 0 ? 0 : (canvas.height - padding * 2 - gap * (rows - 1)) / rows
  const rowHeight = rows === 0 ? 0 : Math.max(minPaneHeight, availableRowHeight)
  const contentHeight =
    rows === 0 ? 0 : padding * 2 + rows * rowHeight + gap * (rows - 1)

  const placements: GridPlacement[] = paneIds.map((paneId, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      paneId,
      index,
      row,
      column,
      rect: {
        x: padding + column * (cellWidth + gap),
        y: padding + row * (rowHeight + gap),
        width: cellWidth,
        height: rowHeight
      }
    }
  })

  return {
    ok: true,
    layout: {
      placements,
      columns,
      rows,
      contentHeight,
      needsVerticalScroll: contentHeight > canvas.height + 0.5,
      columnTooNarrow: count > 0 && cellWidth < minPaneWidth
    }
  }
}

/**
 * Moves an item within an array. Returns null rather than mutating or silently
 * accepting out-of-range indices.
 */
export function moveItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] | null {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return null
  }

  if (fromIndex === toIndex) {
    return [...items]
  }

  const copy = [...items]
  const [item] = copy.splice(fromIndex, 1)
  if (item === undefined) {
    return null
  }
  copy.splice(toIndex, 0, item)
  return copy
}

export function reorderPaneIds(
  paneIds: readonly string[],
  paneId: string,
  targetIndex: number
): string[] | null {
  const currentIndex = paneIds.indexOf(paneId)
  if (currentIndex < 0) {
    return null
  }
  return moveItem(paneIds, currentIndex, targetIndex)
}

export function bringToFront<T>(items: readonly T[], item: T): T[] | null {
  const index = items.indexOf(item)
  if (index < 0) {
    return null
  }
  return moveItem(items, index, items.length - 1)
}

export function sendToBack<T>(items: readonly T[], item: T): T[] | null {
  const index = items.indexOf(item)
  if (index < 0) {
    return null
  }
  return moveItem(items, index, 0)
}

/**
 * Clamps a pane rectangle into the canvas while enforcing a minimum size.
 * When the canvas is smaller than the minimum, the canvas wins.
 */
export function clampRect(rect: Rect, canvas: Size, minSize: Size): Rect | null {
  if (!isValidRect(rect) || !isValidCanvas(canvas) || !isValidMinSize(minSize)) {
    return null
  }

  const width = Math.min(canvas.width, Math.max(minSize.width, rect.width))
  const height = Math.min(canvas.height, Math.max(minSize.height, rect.height))
  const x = clampNumber(rect.x, 0, canvas.width - width)
  const y = clampNumber(rect.y, 0, canvas.height - height)

  return { x, y, width, height }
}

export function moveRect(
  rect: Rect,
  deltaX: number,
  deltaY: number,
  canvas: Size,
  minSize: Size
): Rect | null {
  if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) {
    return null
  }

  return clampRect(
    { ...rect, x: rect.x + deltaX, y: rect.y + deltaY },
    canvas,
    minSize
  )
}

export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  canvas: Size,
  minSize: Size
): Rect | null {
  if (!isValidRect(rect) || !isValidCanvas(canvas) || !isValidMinSize(minSize)) {
    return null
  }

  if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) {
    return null
  }

  const base = clampRect(rect, canvas, minSize)
  if (!base) {
    return null
  }

  const minWidth = Math.min(minSize.width, canvas.width)
  const minHeight = Math.min(minSize.height, canvas.height)
  let left = base.x
  let top = base.y
  let right = base.x + base.width
  let bottom = base.y + base.height

  if (handle.includes('w')) {
    left = clampNumber(left + deltaX, 0, right - minWidth)
  }
  if (handle.includes('e')) {
    right = clampNumber(right + deltaX, left + minWidth, canvas.width)
  }
  if (handle.includes('n')) {
    top = clampNumber(top + deltaY, 0, bottom - minHeight)
  }
  if (handle.includes('s')) {
    bottom = clampNumber(bottom + deltaY, top + minHeight, canvas.height)
  }

  return clampRect(
    { x: left, y: top, width: right - left, height: bottom - top },
    canvas,
    minSize
  )
}

export function rectToNormalized(rect: Rect, canvas: Size): NormalizedRect | null {
  if (!isValidRect(rect) || !isValidCanvas(canvas)) {
    return null
  }

  return {
    x: rect.x / canvas.width,
    y: rect.y / canvas.height,
    width: rect.width / canvas.width,
    height: rect.height / canvas.height
  }
}

export function normalizedToRect(
  normalized: NormalizedRect,
  canvas: Size,
  minSize: Size
): Rect | null {
  if (
    !isFiniteNumber(normalized.x) ||
    !isFiniteNumber(normalized.y) ||
    !isPositiveNumber(normalized.width) ||
    !isPositiveNumber(normalized.height) ||
    !isValidCanvas(canvas)
  ) {
    return null
  }

  return clampRect(
    {
      x: normalized.x * canvas.width,
      y: normalized.y * canvas.height,
      width: normalized.width * canvas.width,
      height: normalized.height * canvas.height
    },
    canvas,
    minSize
  )
}

function bestSnap(
  edges: readonly number[],
  targets: readonly number[],
  threshold: number
): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null

  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge
      if (
        Math.abs(delta) <= threshold &&
        (best === null || Math.abs(delta) < Math.abs(best.delta))
      ) {
        best = { delta, target }
      }
    }
  }

  return best
}

/**
 * Snaps a pane rectangle to canvas edges/centers, neighboring pane edges/centers,
 * and optionally a grid. The returned guides are the target coordinates that
 * were aligned.
 */
export function snapRect(rect: Rect, options: SnapOptions): SnapResult | null {
  if (!isValidRect(rect) || !isValidCanvas(options.canvas)) {
    return null
  }

  const threshold = options.threshold ?? DEFAULT_SNAP_THRESHOLD
  if (!isFiniteNumber(threshold) || threshold < 0) {
    return null
  }

  const snapToCanvas = options.snapToCanvas ?? true
  const snapToNeighbors = options.snapToNeighbors ?? true
  const snapToGrid = options.snapToGrid ?? false
  const gridSize = options.gridSize ?? 0

  if (snapToGrid && !isPositiveNumber(gridSize)) {
    return null
  }

  const neighbors = options.neighbors ?? []
  if (neighbors.some((neighbor) => !isValidRect(neighbor))) {
    return null
  }

  const xTargets: number[] = []
  const yTargets: number[] = []

  if (snapToCanvas) {
    xTargets.push(0, options.canvas.width / 2, options.canvas.width)
    yTargets.push(0, options.canvas.height / 2, options.canvas.height)
  }

  if (snapToNeighbors) {
    for (const neighbor of neighbors) {
      xTargets.push(neighbor.x, neighbor.x + neighbor.width / 2, neighbor.x + neighbor.width)
      yTargets.push(neighbor.y, neighbor.y + neighbor.height / 2, neighbor.y + neighbor.height)
    }
  }

  if (snapToGrid) {
    for (let x = 0; x <= options.canvas.width; x += gridSize) {
      xTargets.push(x)
    }
    for (let y = 0; y <= options.canvas.height; y += gridSize) {
      yTargets.push(y)
    }
  }

  const uniqueX = uniqueTargets(xTargets, options.canvas.width)
  const uniqueY = uniqueTargets(yTargets, options.canvas.height)
  const xSnap = bestSnap(
    [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    uniqueX,
    threshold
  )
  const ySnap = bestSnap(
    [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
    uniqueY,
    threshold
  )

  const snapped: Rect = {
    ...rect,
    x: rect.x + (xSnap?.delta ?? 0),
    y: rect.y + (ySnap?.delta ?? 0)
  }
  const bounded = clampRect(snapped, options.canvas, { width: 1, height: 1 })
  if (!bounded) {
    return null
  }

  return {
    rect: bounded,
    guides: {
      vertical: xSnap ? [xSnap.target] : [],
      horizontal: ySnap ? [ySnap.target] : []
    },
    snappedX: xSnap !== null && Math.abs(xSnap.delta) > 0.0001,
    snappedY: ySnap !== null && Math.abs(ySnap.delta) > 0.0001
  }
}

export function isRectFullyVisible(
  rect: Rect,
  viewport: Rect,
  tolerance = 0.5
): boolean {
  if (
    !isValidRect(rect) ||
    !isValidRect(viewport) ||
    !isFiniteNumber(tolerance) ||
    tolerance < 0
  ) {
    return false
  }

  return (
    rect.x >= viewport.x - tolerance &&
    rect.y >= viewport.y - tolerance &&
    rect.x + rect.width <= viewport.x + viewport.width + tolerance &&
    rect.y + rect.height <= viewport.y + viewport.height + tolerance
  )
}
