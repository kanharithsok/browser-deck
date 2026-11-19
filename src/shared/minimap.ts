import type { Size } from './layout'

export type CanvasMinimapTheme = 'light' | 'dark'

export interface CanvasMinimapPane {
  id: string
  title: string
  active: boolean
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasMinimapState {
  theme: CanvasMinimapTheme
  zoom: number
  panes: CanvasMinimapPane[]
  viewport: MinimapViewport
}

export type CanvasMinimapAction =
  | { type: 'focus'; paneId: string }
  | { type: 'recenter'; x: number; y: number }
  | { type: 'fit' }
  | { type: 'collapse'; collapsed: boolean }

export const CANVAS_MINIMAP_MIN_WIDTH = 168
export const CANVAS_MINIMAP_MAX_WIDTH = 208
export const CANVAS_MINIMAP_COLLAPSED_HEIGHT = 28
export const CANVAS_MINIMAP_MARGIN = 12

/**
 * Keeps the minimap compact and out of the way on small windows while still
 * leaving enough map area to target panes on a desktop-sized window.
 */
export function canvasMinimapSize(
  workspace: Size,
  collapsed: boolean
): Size {
  const availableWidth = Number.isFinite(workspace.width) ? workspace.width : 0
  const width = Math.round(
    Math.min(
      CANVAS_MINIMAP_MAX_WIDTH,
      Math.max(CANVAS_MINIMAP_MIN_WIDTH, availableWidth * 0.16)
    )
  )
  return {
    width,
    height: collapsed ? CANVAS_MINIMAP_COLLAPSED_HEIGHT : Math.round(width * 0.64)
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validRect(value: unknown): value is MinimapViewport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const rect = value as Record<string, unknown>
  return (
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

export function parseCanvasMinimapState(value: unknown): CanvasMinimapState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.theme !== 'light' && record.theme !== 'dark') {
    return null
  }
  if (!finite(record.zoom) || record.zoom < 0.25 || record.zoom > 4) {
    return null
  }
  if (!validRect(record.viewport)) {
    return null
  }
  if (!Array.isArray(record.panes) || record.panes.length > 512) {
    return null
  }

  const panes: CanvasMinimapPane[] = []
  for (const entry of record.panes) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return null
    }
    const pane = entry as Record<string, unknown>
    if (
      typeof pane.id !== 'string' ||
      !pane.id ||
      pane.id.length > 100 ||
      typeof pane.title !== 'string' ||
      pane.title.length > 200 ||
      typeof pane.active !== 'boolean' ||
      !finite(pane.x) ||
      !finite(pane.y) ||
      !finite(pane.width) ||
      !finite(pane.height) ||
      pane.width <= 0 ||
      pane.height <= 0
    ) {
      return null
    }
    panes.push({
      id: pane.id,
      title: pane.title,
      active: pane.active,
      x: pane.x,
      y: pane.y,
      width: pane.width,
      height: pane.height
    })
  }

  return {
    theme: record.theme,
    zoom: record.zoom,
    panes,
    viewport: {
      x: record.viewport.x,
      y: record.viewport.y,
      width: record.viewport.width,
      height: record.viewport.height
    }
  }
}

export function parseCanvasMinimapAction(value: unknown): CanvasMinimapAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.type === 'focus') {
    return typeof record.paneId === 'string' && record.paneId.length > 0 && record.paneId.length <= 100
      ? { type: 'focus', paneId: record.paneId }
      : null
  }
  if (record.type === 'recenter') {
    return finite(record.x) && finite(record.y) && Math.abs(record.x) <= 1_000_000 && Math.abs(record.y) <= 1_000_000
      ? { type: 'recenter', x: record.x, y: record.y }
      : null
  }
  if (record.type === 'fit') {
    return { type: 'fit' }
  }
  if (record.type === 'collapse') {
    return typeof record.collapsed === 'boolean'
      ? { type: 'collapse', collapsed: record.collapsed }
      : null
  }
  return null
}

export interface MinimapFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
  active?: boolean
}

export interface MinimapViewport {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapLayout {
  scale: number
  offsetX: number
  offsetY: number
  frames: Array<{ id: string; active: boolean; rect: MinimapRect }>
  viewport: MinimapRect
}

function positiveSize(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Projects world-space canvas frames and the visible viewport into a fixed
 * overview map. Both the panes and the current viewport are included in the
 * bounds so the map remains useful after panning far away from every pane.
 */
export function layoutMinimap(
  frames: readonly MinimapFrame[],
  viewport: MinimapViewport | null,
  map: Size,
  padding = 8
): MinimapLayout | null {
  if (!positiveSize(map.width) || !positiveSize(map.height) || frames.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const frame of frames) {
    if (!positiveSize(frame.width) || !positiveSize(frame.height)) {
      continue
    }
    minX = Math.min(minX, frame.x)
    minY = Math.min(minY, frame.y)
    maxX = Math.max(maxX, frame.x + frame.width)
    maxY = Math.max(maxY, frame.y + frame.height)
  }

  if (viewport && positiveSize(viewport.width) && positiveSize(viewport.height)) {
    minX = Math.min(minX, viewport.x)
    minY = Math.min(minY, viewport.y)
    maxX = Math.max(maxX, viewport.x + viewport.width)
    maxY = Math.max(maxY, viewport.y + viewport.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null
  }

  const worldWidth = Math.max(1, maxX - minX)
  const worldHeight = Math.max(1, maxY - minY)
  const innerWidth = Math.max(1, map.width - padding * 2)
  const innerHeight = Math.max(1, map.height - padding * 2)
  const scale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight, 4)
  const offsetX = (map.width - worldWidth * scale) / 2 - minX * scale
  const offsetY = (map.height - worldHeight * scale) / 2 - minY * scale

  const project = (x: number, y: number, width: number, height: number): MinimapRect => ({
    x: offsetX + x * scale,
    y: offsetY + y * scale,
    width: Math.max(2, width * scale),
    height: Math.max(2, height * scale)
  })

  return {
    scale,
    offsetX,
    offsetY,
    frames: frames
      .filter((frame) => positiveSize(frame.width) && positiveSize(frame.height))
      .map((frame) => ({
        id: frame.id,
        active: frame.active === true,
        rect: project(frame.x, frame.y, frame.width, frame.height)
      })),
    viewport: viewport
      ? project(viewport.x, viewport.y, viewport.width, viewport.height)
      : { x: offsetX, y: offsetY, width: 0, height: 0 }
  }
}
