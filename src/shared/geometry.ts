import type { PaneBoundsUpdate, PaneViewRect } from './ipc'

export interface CanvasSize {
  width: number
  height: number
}

export const MIN_PANE_VIEW_WIDTH = 80
export const MIN_PANE_VIEW_HEIGHT = 60
const MAX_PANE_COUNT = 200

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
 * Validates pane rectangles reported by the trusted shell before they are
 * applied to native views. Unknown pane IDs, duplicates, non-finite values, and
 * rectangles outside the reported canvas are rejected. Valid rectangles are
 * clamped to the canvas.
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
    return { ok: false, error: 'Invalid pane bounds payload.' }
  }

  const seen = new Set<string>()
  const updates: PaneBoundsUpdate[] = []

  for (const item of input) {
    if (!isRecord(item) || typeof item.paneId !== 'string' || !isRecord(item.rect)) {
      return { ok: false, error: 'Invalid pane bounds entry.' }
    }

    const paneId = item.paneId
    if (!knownPaneIds.has(paneId) || seen.has(paneId)) {
      return { ok: false, error: 'Unknown or duplicate pane ID.' }
    }
    seen.add(paneId)

    const rect = sanitizeRect(
      {
        x: item.rect.x as number,
        y: item.rect.y as number,
        width: item.rect.width as number,
        height: item.rect.height as number
      },
      canvas
    )

    if (!rect) {
      return { ok: false, error: 'Invalid pane bounds rectangle.' }
    }

    if (rect.width < MIN_PANE_VIEW_WIDTH || rect.height < MIN_PANE_VIEW_HEIGHT) {
      return { ok: false, error: 'Pane view is below the minimum size.' }
    }

    updates.push({ paneId, rect })
  }

  return { ok: true, updates }
}
