import type { ThemePreference } from './workspace'

export type CanvasZoomTheme = 'light' | 'dark'

export interface CanvasZoomState {
  theme: CanvasZoomTheme
  themePreference: ThemePreference
  zoom: number
  handMode: boolean
  selectMode: boolean
}

export type CanvasZoomAction =
  | { type: 'step'; direction: 'in' | 'out' }
  | { type: 'set'; zoom: number }
  | { type: 'fit' }
  | { type: 'reset' }
  | { type: 'menu' }
  | { type: 'toggle-hand' }
  | { type: 'toggle-select' }
  | { type: 'appearance' }
  | { type: 'arrange' }
  | { type: 'find-device' }
  | { type: 'reload-all' }

export const CANVAS_MIN_ZOOM = 0.25
export const CANVAS_MAX_ZOOM = 2
export const CANVAS_ZOOM_STEP = 0.1
export const CANVAS_ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const
export const CANVAS_ZOOM_BAR_WIDTH = 422
export const CANVAS_ZOOM_BAR_HEIGHT = 40
export const CANVAS_ZOOM_MARGIN = 12
export const CANVAS_ZOOM_MENU_WIDTH = 224

export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
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
    record.zoom > CANVAS_MAX_ZOOM ||
    typeof record.handMode !== 'boolean' ||
    typeof record.selectMode !== 'boolean' ||
    !isThemePreference(record.themePreference)
  ) {
    return null
  }
  return {
    theme: record.theme,
    themePreference: record.themePreference,
    zoom: record.zoom,
    handMode: record.handMode,
    selectMode: record.selectMode
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
  if (record.type === 'toggle-hand') {
    return { type: 'toggle-hand' }
  }
  if (record.type === 'toggle-select') {
    return { type: 'toggle-select' }
  }
  if (record.type === 'appearance') {
    return { type: 'appearance' }
  }
  if (record.type === 'arrange') {
    return { type: 'arrange' }
  }
  if (record.type === 'find-device') {
    return { type: 'find-device' }
  }
  if (record.type === 'reload-all') {
    return { type: 'reload-all' }
  }
  return null
}
