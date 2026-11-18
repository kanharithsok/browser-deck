import type { Size } from './layout'

export type ViewportPresetId = 'responsive' | 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'custom'
export type ViewportDisplayScale = 'fit' | 'actual'

export interface PaneViewport {
  preset: ViewportPresetId
  width: number
  height: number
  deviceScaleFactor: number
  displayScale: ViewportDisplayScale
}

export interface ViewportPreset {
  id: Exclude<ViewportPresetId, 'responsive' | 'custom'>
  label: string
  width: number
  height: number
  deviceScaleFactor: number
}

export const MIN_VIEWPORT_DIMENSION = 200
export const MAX_VIEWPORT_DIMENSION = 7680
export const MIN_DEVICE_SCALE_FACTOR = 0.5
export const MAX_DEVICE_SCALE_FACTOR = 4

export const RESPONSIVE_VIEWPORT: PaneViewport = {
  preset: 'responsive',
  width: 0,
  height: 0,
  deviceScaleFactor: 1,
  displayScale: 'fit'
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'mobile', label: 'Mobile 390 × 844', width: 390, height: 844, deviceScaleFactor: 3 },
  { id: 'tablet', label: 'Tablet 820 × 1180', width: 820, height: 1180, deviceScaleFactor: 2 },
  { id: 'laptop', label: 'Laptop 1280 × 800', width: 1280, height: 800, deviceScaleFactor: 1 },
  { id: 'desktop', label: 'Desktop 1440 × 900', width: 1440, height: 900, deviceScaleFactor: 1 }
]

export function findViewportPreset(id: string): ViewportPreset | undefined {
  return VIEWPORT_PRESETS.find((preset) => preset.id === id)
}

export function isViewportPresetId(value: unknown): value is ViewportPresetId {
  return (
    value === 'responsive' ||
    value === 'mobile' ||
    value === 'tablet' ||
    value === 'laptop' ||
    value === 'desktop' ||
    value === 'custom'
  )
}

export function viewportFromPreset(
  preset: ViewportPresetId,
  displayScale: ViewportDisplayScale = 'fit'
): PaneViewport {
  if (preset === 'responsive') {
    return { ...RESPONSIVE_VIEWPORT, displayScale }
  }
  if (preset === 'custom') {
    return { ...RESPONSIVE_VIEWPORT, preset: 'custom', width: 800, height: 600, displayScale }
  }

  const definition = findViewportPreset(preset)
  if (!definition) {
    return { ...RESPONSIVE_VIEWPORT, displayScale }
  }

  return {
    preset,
    width: definition.width,
    height: definition.height,
    deviceScaleFactor: definition.deviceScaleFactor,
    displayScale
  }
}

function isValidDimension(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_VIEWPORT_DIMENSION &&
    value <= MAX_VIEWPORT_DIMENSION
  )
}

function isValidDeviceScaleFactor(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_DEVICE_SCALE_FACTOR &&
    value <= MAX_DEVICE_SCALE_FACTOR
  )
}

export function parsePaneViewport(
  input: unknown
): { ok: true; viewport: PaneViewport } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Invalid viewport settings.' }
  }

  const record = input as Record<string, unknown>
  if (!isViewportPresetId(record.preset)) {
    return { ok: false, error: 'Unknown viewport preset.' }
  }
  if (record.displayScale !== 'fit' && record.displayScale !== 'actual') {
    return { ok: false, error: 'Unknown display scale mode.' }
  }

  if (record.preset === 'responsive') {
    return { ok: true, viewport: { ...RESPONSIVE_VIEWPORT, displayScale: record.displayScale } }
  }

  if (record.preset !== 'custom') {
    const preset = viewportFromPreset(record.preset, record.displayScale)
    return { ok: true, viewport: preset }
  }

  const width = record.width
  const height = record.height
  const deviceScaleFactor = record.deviceScaleFactor

  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !isValidDimension(width) ||
    !isValidDimension(height)
  ) {
    return {
      ok: false,
      error: `Custom viewport must be between ${MIN_VIEWPORT_DIMENSION} and ${MAX_VIEWPORT_DIMENSION} pixels.`
    }
  }
  if (
    typeof deviceScaleFactor !== 'number' ||
    !isValidDeviceScaleFactor(deviceScaleFactor)
  ) {
    return {
      ok: false,
      error: `Device scale factor must be between ${MIN_DEVICE_SCALE_FACTOR} and ${MAX_DEVICE_SCALE_FACTOR}.`
    }
  }

  return {
    ok: true,
    viewport: {
      preset: 'custom',
      width,
      height,
      deviceScaleFactor,
      displayScale: record.displayScale
    }
  }
}

/**
 * Visual scale for a fixed emulated viewport inside the available pane content.
 * Responsive panes never call this; actual mode uses 1.
 */
export function viewportDisplayScale(viewport: PaneViewport, available: Size): number {
  if (viewport.preset === 'responsive' || viewport.displayScale === 'actual') {
    return 1
  }
  if (available.width < 1 || available.height < 1) {
    return 1
  }

  const scale = Math.min(available.width / viewport.width, available.height / viewport.height)
  return Math.max(0.1, Math.min(4, Math.round(scale * 1000) / 1000))
}
