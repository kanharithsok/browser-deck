import type { Size } from './layout'

export type ViewportPresetId =
  | 'responsive'
  | 'mobile'
  | 'iphone-15-pro'
  | 'iphone-15-pro-max'
  | 'iphone-se'
  | 'galaxy-s24'
  | 'galaxy-s24-ultra'
  | 'pixel-8'
  | 'pixel-8-pro'
  | 'tablet'
  | 'ipad-pro-12-9'
  | 'ipad-air'
  | 'galaxy-tab-s9'
  | 'laptop'
  | 'macbook-air'
  | 'desktop'
  | 'custom'

export type ViewportPresetCategory = 'phone' | 'tablet' | 'desktop'

export interface PaneViewport {
  preset: ViewportPresetId
  width: number
  height: number
  deviceScaleFactor: number
  /** Fixed viewports can be shown in the opposite orientation. */
  rotated?: boolean
}

export interface ViewportPreset {
  id: Exclude<ViewportPresetId, 'responsive' | 'custom'>
  label: string
  category: ViewportPresetCategory
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
  deviceScaleFactor: 1
}

export const VIEWPORT_CATEGORY_LABELS: Record<ViewportPresetCategory, string> = {
  phone: 'Phone viewports',
  tablet: 'Tablet viewports',
  desktop: 'Desktop viewports'
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  {
    id: 'mobile',
    label: 'Generic phone — 390 × 844',
    category: 'phone',
    width: 390,
    height: 844,
    deviceScaleFactor: 3
  },
  {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro — 393 × 852',
    category: 'phone',
    width: 393,
    height: 852,
    deviceScaleFactor: 3
  },
  {
    id: 'iphone-15-pro-max',
    label: 'iPhone 15 Pro Max — 430 × 932',
    category: 'phone',
    width: 430,
    height: 932,
    deviceScaleFactor: 3
  },
  {
    id: 'iphone-se',
    label: 'iPhone SE — 375 × 667',
    category: 'phone',
    width: 375,
    height: 667,
    deviceScaleFactor: 2
  },
  {
    id: 'galaxy-s24',
    label: 'Samsung Galaxy S24 — 360 × 780',
    category: 'phone',
    width: 360,
    height: 780,
    deviceScaleFactor: 3
  },
  {
    id: 'galaxy-s24-ultra',
    label: 'Samsung Galaxy S24 Ultra — 412 × 915',
    category: 'phone',
    width: 412,
    height: 915,
    deviceScaleFactor: 3.5
  },
  {
    id: 'pixel-8',
    label: 'Google Pixel 8 — 412 × 915',
    category: 'phone',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625
  },
  {
    id: 'pixel-8-pro',
    label: 'Google Pixel 8 Pro — 448 × 998',
    category: 'phone',
    width: 448,
    height: 998,
    deviceScaleFactor: 2.625
  },
  {
    id: 'tablet',
    label: 'Generic tablet — 820 × 1180',
    category: 'tablet',
    width: 820,
    height: 1180,
    deviceScaleFactor: 2
  },
  {
    id: 'ipad-pro-12-9',
    label: 'iPad Pro 12.9″ — 1024 × 1366',
    category: 'tablet',
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2
  },
  {
    id: 'ipad-air',
    label: 'iPad Air — 820 × 1180',
    category: 'tablet',
    width: 820,
    height: 1180,
    deviceScaleFactor: 2
  },
  {
    id: 'galaxy-tab-s9',
    label: 'Samsung Galaxy Tab S9 — 800 × 1280',
    category: 'tablet',
    width: 800,
    height: 1280,
    deviceScaleFactor: 2
  },
  {
    id: 'laptop',
    label: 'Laptop — 1280 × 800',
    category: 'desktop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1
  },
  {
    id: 'macbook-air',
    label: 'MacBook Air — 1280 × 832',
    category: 'desktop',
    width: 1280,
    height: 832,
    deviceScaleFactor: 2
  },
  {
    id: 'desktop',
    label: 'Desktop — 1440 × 900',
    category: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1
  }
]

const VIEWPORT_PRESET_IDS = new Set<string>(VIEWPORT_PRESETS.map((preset) => preset.id))

export function findViewportPreset(id: string): ViewportPreset | undefined {
  return VIEWPORT_PRESETS.find((preset) => preset.id === id)
}

/** Phone/tablet presets use mobile viewport behavior and touch input. */
export function usesMobileViewportBehavior(viewport: PaneViewport): boolean {
  const preset = findViewportPreset(viewport.preset)
  return preset !== undefined && preset.category !== 'desktop'
}

export function viewportPresetsInCategory(
  category: ViewportPresetCategory
): readonly ViewportPreset[] {
  return VIEWPORT_PRESETS.filter((preset) => preset.category === category)
}

export function isViewportPresetId(value: unknown): value is ViewportPresetId {
  return (
    value === 'responsive' ||
    value === 'custom' ||
    (typeof value === 'string' && VIEWPORT_PRESET_IDS.has(value))
  )
}

export function viewportFromPreset(preset: ViewportPresetId): PaneViewport {
  if (preset === 'responsive') {
    return { ...RESPONSIVE_VIEWPORT }
  }
  if (preset === 'custom') {
    return { ...RESPONSIVE_VIEWPORT, preset: 'custom', width: 800, height: 600 }
  }

  const definition = findViewportPreset(preset)
  if (!definition) {
    return { ...RESPONSIVE_VIEWPORT }
  }

  return {
    preset,
    width: definition.width,
    height: definition.height,
    deviceScaleFactor: definition.deviceScaleFactor
  }
}

function withRotation(viewport: PaneViewport, rotated: boolean): PaneViewport {
  const upright = {
    preset: viewport.preset,
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor
  }
  return rotated ? { ...upright, rotated: true } : upright
}

/** Effective emulated width and height after applying the orientation toggle. */
export function viewportContentSize(viewport: PaneViewport): {
  width: number
  height: number
} {
  if (viewport.preset === 'responsive') {
    return { width: 0, height: 0 }
  }
  return viewport.rotated
    ? { width: viewport.height, height: viewport.width }
    : { width: viewport.width, height: viewport.height }
}

/** Rotates a fixed viewport, or returns null when there is nothing to rotate. */
export function toggleViewportRotation(viewport: PaneViewport): PaneViewport | null {
  if (viewport.preset === 'responsive') {
    return null
  }
  return withRotation(viewport, viewport.rotated !== true)
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
  if (record.rotated !== undefined && typeof record.rotated !== 'boolean') {
    return { ok: false, error: 'Invalid viewport rotation.' }
  }
  const rotated = record.rotated === true

  if (record.preset === 'responsive') {
    return { ok: true, viewport: { ...RESPONSIVE_VIEWPORT } }
  }

  if (record.preset !== 'custom') {
    const preset = viewportFromPreset(record.preset)
    return { ok: true, viewport: withRotation(preset, rotated) }
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
      ...(rotated ? { rotated: true } : {})
    }
  }
}

/**
 * Visual scale for a fixed emulated viewport inside the available pane content.
 * Fixed viewports always fit; responsive panes use the pane size directly.
 * Legacy `displayScale` values are intentionally ignored so older workspaces
 * migrate to the current always-fit behavior.
 */
export function viewportDisplayScale(viewport: PaneViewport, available: Size): number {
  if (viewport.preset === 'responsive') {
    return 1
  }
  if (available.width < 1 || available.height < 1) {
    return 1
  }

  const size = viewportContentSize(viewport)
  const scale = Math.min(available.width / size.width, available.height / size.height)
  return Math.max(0.1, Math.min(4, Math.round(scale * 1000) / 1000))
}
