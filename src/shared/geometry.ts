import type { PaneBoundsUpdate, PaneViewRect } from './ipc'

export interface CanvasSize {
  width: number
  height: number
}

export const MIN_PANE_VIEW_WIDTH = 80
export const MIN_PANE_VIEW_HEIGHT = 60
const MAX_PANE_COUNT = 200
const MAX_LIVE_PANE_VIEW_DIMENSION = 16384

export type PaneBoundsResult =
  | { ok: true; updates: PaneBoundsUpdate[] }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function sanitizeRect(rect: PaneViewRect, canvas: CanvasSize): PaneViewRect | null {
  if (
    !finiteNumber(rect.x) ||
    !finiteNumber(rect.y) ||
    !finiteNumber(rect.width) ||
    !finiteNumber(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null
  }

  const x = Math.round(Math.max(0, rect.x))
  const y = Math.round(Math.max(0, rect.y))
  const width = Math.round(Math.min(rect.width, canvas.width - x))
  const height = Math.round(Math.min(rect.height, canvas.height - y))

  if (width < 1 || height < 1) {
    return null
  }

  return { x, y, width, height }
}

/**
 * Validates a live pane rectangle that may extend past the window edges. The
 * full rectangle is preserved so the page viewport does not reflow; the OS and
 * native Canvas overlays handle clipping on the allowed sides. The rectangle
 * must still intersect the canvas and stay within a sane maximum size.
 */
export function sanitizeLiveRect(
  rect: PaneViewRect,
  canvas: CanvasSize
): PaneViewRect | null {
  if (
    !finiteNumber(rect.x) ||
    !finiteNumber(rect.y) ||
    !finiteNumber(rect.width) ||
    !finiteNumber(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null
  }

  const rounded = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
  if (
    rounded.width > MAX_LIVE_PANE_VIEW_DIMENSION ||
    rounded.height > MAX_LIVE_PANE_VIEW_DIMENSION
  ) {
    return null
  }
  if (
    rounded.x >= canvas.width ||
    rounded.y >= canvas.height ||
    rounded.x + rounded.width <= 0 ||
    rounded.y + rounded.height <= 0
  ) {
    return null
  }

  return rounded
}

/**
 * Validates pane rectangles reported by the trusted shell before they are
 * applied to native views. Unknown pane IDs, duplicates, non-finite values, and
 * rectangles that miss the reported canvas are rejected. Live rectangles may
 * extend past the canvas edges so the OS can clip them without reflowing the
 * page; hidden rectangles keep their full off-canvas geometry.
 */
export function parsePaneBounds(
  input: unknown,
  knownPaneIds: ReadonlySet<string>,
  canvas: CanvasSize
): PaneBoundsResult {
  if (!finiteNumber(canvas.width) || !finiteNumber(canvas.height) || canvas.width < 1 || canvas.height < 1) {
    return { ok: false, error: 'Invalid canvas size.' }
  }

  if (!Array.isArray(input) || input.length > MAX_PANE_COUNT) {
    return { ok: false, error: 'Invalid browser bounds payload.' }
  }

  const seen = new Set<string>()
  const updates: PaneBoundsUpdate[] = []

  for (const item of input) {
    if (!isRecord(item) || typeof item.paneId !== 'string' || !isRecord(item.rect)) {
      return { ok: false, error: 'Invalid browser bounds entry.' }
    }
    if (typeof item.visible !== 'boolean') {
      return { ok: false, error: 'Invalid browser visibility.' }
    }

    const paneId = item.paneId
    if (!knownPaneIds.has(paneId) || seen.has(paneId)) {
      return { ok: false, error: 'Unknown or duplicate browser ID.' }
    }
    seen.add(paneId)

    const rawRect = {
      x: item.rect.x as number,
      y: item.rect.y as number,
      width: item.rect.width as number,
      height: item.rect.height as number
    }

    if (item.visible) {
      const rect = sanitizeLiveRect(rawRect, canvas)
      if (!rect) {
        return { ok: false, error: 'Invalid browser bounds rectangle.' }
      }
      if (rect.width < MIN_PANE_VIEW_WIDTH || rect.height < MIN_PANE_VIEW_HEIGHT) {
        return { ok: false, error: 'Browser view is below the minimum size.' }
      }
      updates.push({ paneId, rect, visible: true })
      continue
    }

    if (
      !finiteNumber(rawRect.x) ||
      !finiteNumber(rawRect.y) ||
      !finiteNumber(rawRect.width) ||
      !finiteNumber(rawRect.height) ||
      rawRect.width <= 0 ||
      rawRect.height <= 0
    ) {
      return { ok: false, error: 'Invalid browser bounds rectangle.' }
    }

    const hiddenRect = {
      x: Math.round(rawRect.x),
      y: Math.round(rawRect.y),
      width: Math.round(rawRect.width),
      height: Math.round(rawRect.height)
    }
    if (hiddenRect.width < MIN_PANE_VIEW_WIDTH || hiddenRect.height < MIN_PANE_VIEW_HEIGHT) {
      return { ok: false, error: 'Browser view is below the minimum size.' }
    }
    updates.push({ paneId, rect: hiddenRect, visible: false })
  }

  return { ok: true, updates }
}
