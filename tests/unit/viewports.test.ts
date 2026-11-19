import { describe, expect, it } from 'vitest'
import {
  MAX_DEVICE_SCALE_FACTOR,
  MAX_VIEWPORT_DIMENSION,
  MIN_DEVICE_SCALE_FACTOR,
  MIN_VIEWPORT_DIMENSION,
  RESPONSIVE_VIEWPORT,
  VIEWPORT_PRESETS,
  parsePaneViewport,
  viewportDisplayScale,
  viewportFromPreset
} from '../../src/shared/viewports'

describe('viewport presets', () => {
  it('exposes popular phone, tablet, and desktop presets', () => {
    expect(VIEWPORT_PRESETS.map((preset) => preset.id)).toEqual([
      'mobile',
      'iphone-15-pro',
      'iphone-15-pro-max',
      'iphone-se',
      'galaxy-s24',
      'galaxy-s24-ultra',
      'pixel-8',
      'pixel-8-pro',
      'tablet',
      'ipad-pro-12-9',
      'ipad-air',
      'galaxy-tab-s9',
      'laptop',
      'macbook-air',
      'desktop'
    ])
    expect(
      VIEWPORT_PRESETS.filter((preset) => preset.category === 'phone').map((preset) => preset.label)
    ).toEqual(expect.arrayContaining([expect.stringContaining('iPhone 15 Pro')]))
    expect(
      VIEWPORT_PRESETS.filter((preset) => preset.category === 'phone').map((preset) => preset.label)
    ).toEqual(expect.arrayContaining([expect.stringContaining('Samsung Galaxy S24')]))
    expect(
      VIEWPORT_PRESETS.filter((preset) => preset.category === 'phone').map((preset) => preset.label)
    ).toEqual(expect.arrayContaining([expect.stringContaining('Google Pixel 8')]))
    expect(
      VIEWPORT_PRESETS.filter((preset) => preset.category === 'tablet').map((preset) => preset.label)
    ).toEqual(expect.arrayContaining([expect.stringContaining('iPad Pro')]))
    expect(
      VIEWPORT_PRESETS.filter((preset) => preset.category === 'tablet').map((preset) => preset.label)
    ).toEqual(expect.arrayContaining([expect.stringContaining('Galaxy Tab S9')]))
    for (const preset of VIEWPORT_PRESETS) {
      expect(preset.width).toBeGreaterThanOrEqual(MIN_VIEWPORT_DIMENSION)
      expect(preset.height).toBeGreaterThanOrEqual(MIN_VIEWPORT_DIMENSION)
      expect(preset.deviceScaleFactor).toBeGreaterThanOrEqual(MIN_DEVICE_SCALE_FACTOR)
      expect(preset.deviceScaleFactor).toBeLessThanOrEqual(MAX_DEVICE_SCALE_FACTOR)
    }
  })

  it('builds fixed presets and responsive panes without a display scale mode', () => {
    expect(viewportFromPreset('mobile')).toEqual({
      preset: 'mobile',
      width: 390,
      height: 844,
      deviceScaleFactor: 3
    })
    expect(viewportFromPreset('pixel-8')).toEqual({
      preset: 'pixel-8',
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625
    })
    expect(viewportFromPreset('responsive')).toEqual(RESPONSIVE_VIEWPORT)
  })
})

describe('parsePaneViewport', () => {
  it('accepts responsive and named presets', () => {
    expect(parsePaneViewport({ preset: 'responsive' })).toEqual({
      ok: true,
      viewport: RESPONSIVE_VIEWPORT
    })
    const tablet = parsePaneViewport({ preset: 'tablet' })
    expect(tablet.ok).toBe(true)
    if (tablet.ok) {
      expect(tablet.viewport).toMatchObject({
        preset: 'tablet',
        width: 820,
        height: 1180,
        deviceScaleFactor: 2
      })
    }
    expect(parsePaneViewport({ preset: 'iphone-15-pro' })).toEqual({
      ok: true,
      viewport: {
        preset: 'iphone-15-pro',
        width: 393,
        height: 852,
        deviceScaleFactor: 3
      }
    })
  })

  it('ignores legacy display scale values and always uses fit', () => {
    const legacyActual = parsePaneViewport({ preset: 'tablet', displayScale: 'actual' })
    expect(legacyActual.ok).toBe(true)
    if (legacyActual.ok) {
      expect(legacyActual.viewport).toEqual({
        preset: 'tablet',
        width: 820,
        height: 1180,
        deviceScaleFactor: 2
      })
    }

    expect(parsePaneViewport({ preset: 'mobile', displayScale: 'zoom' }).ok).toBe(true)
  })

  it('accepts valid custom dimensions and device scale', () => {
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: 2
      })
    ).toEqual({
      ok: true,
      viewport: {
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: 2
      }
    })
  })

  it('rejects bad presets, dimensions, and device factors', () => {
    expect(parsePaneViewport(null).ok).toBe(false)
    expect(parsePaneViewport({ preset: 'watch' }).ok).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: MIN_VIEWPORT_DIMENSION - 1,
        height: 700,
        deviceScaleFactor: 2
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: MAX_VIEWPORT_DIMENSION + 1,
        height: 700,
        deviceScaleFactor: 2
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: MAX_DEVICE_SCALE_FACTOR + 1
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: MIN_DEVICE_SCALE_FACTOR - 1
      }).ok
    ).toBe(false)
  })
})

describe('viewportDisplayScale', () => {
  it('fits a fixed viewport into the pane content', () => {
    const mobile = viewportFromPreset('mobile')
    const scale = viewportDisplayScale(mobile, { width: 780, height: 600 })
    expect(scale).toBeCloseTo(0.711, 2)
  })

  it('recomputes the fit scale when the pane content changes size', () => {
    const mobile = viewportFromPreset('mobile')
    const wide = viewportDisplayScale(mobile, { width: 780, height: 600 })
    const narrow = viewportDisplayScale(mobile, { width: 300, height: 300 })

    expect(wide).toBeCloseTo(0.711, 2)
    expect(narrow).toBeCloseTo(0.355, 2)
    expect(narrow).toBeLessThan(wide)
  })

  it('uses actual scale for responsive panes', () => {
    expect(viewportDisplayScale(RESPONSIVE_VIEWPORT, { width: 100, height: 100 })).toBe(1)
  })

  it('handles invalid available space safely', () => {
    expect(viewportDisplayScale(viewportFromPreset('desktop'), { width: 0, height: 0 })).toBe(1)
  })
})
