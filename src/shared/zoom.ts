export type CanvasZoomTheme = 'light' | 'dark'

export interface CanvasZoomState {
  theme: CanvasZoomTheme
  zoom: number
}

export type CanvasZoomAction =
  | { type: 'step'; direction: 'in' | 'out' }
  | { type: 'set'; zoom: number }
  | { type: 'fit' }
  | { type: 'reset' }
  | { type: 'menu' }

export const CANVAS_MIN_ZOOM = 0.25
export const CANVAS_MAX_ZOOM = 2
export const CANVAS_ZOOM_STEP = 0.1
export const CANVAS_ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const
export const CANVAS_ZOOM_BAR_WIDTH = 204
export const CANVAS_ZOOM_BAR_HEIGHT = 40
export const CANVAS_ZOOM_MARGIN = 12
export const CANVAS_ZOOM_MENU_WIDTH = 224

export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseCanvasZoomState(value: unknown): CanvasZoomState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.theme !== 'light' && record.theme !== 'dark') {
    return null
  }
  if (
    !finite(record.zoom) ||
    record.zoom < CANVAS_MIN_ZOOM ||
    record.zoom > CANVAS_MAX_ZOOM
  ) {
    return null
  }
  return {
    theme: record.theme,
    zoom: record.zoom
  }
}

export function parseCanvasZoomAction(value: unknown): CanvasZoomAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.type === 'step') {
    return record.direction === 'in' || record.direction === 'out'
      ? { type: 'step', direction: record.direction }
      : null
  }
  if (record.type === 'set') {
    return finite(record.zoom) &&
      record.zoom >= CANVAS_MIN_ZOOM &&
      record.zoom <= CANVAS_MAX_ZOOM
      ? { type: 'set', zoom: record.zoom }
      : null
  }
  if (record.type === 'fit') {
    return { type: 'fit' }
  }
  if (record.type === 'reset') {
    return { type: 'reset' }
  }
  if (record.type === 'menu') {
    return { type: 'menu' }
  }
  return null
}
