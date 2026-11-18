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
  it('exposes common viewport classes without device-brand names', () => {
    expect(VIEWPORT_PRESETS.map((preset) => preset.id)).toEqual([
      'mobile',
      'tablet',
      'laptop',
      'desktop'
    ])
    for (const preset of VIEWPORT_PRESETS) {
      expect(preset.label).not.toMatch(/iphone|ipad|pixel|galaxy/i)
      expect(preset.width).toBeGreaterThanOrEqual(MIN_VIEWPORT_DIMENSION)
      expect(preset.height).toBeGreaterThanOrEqual(MIN_VIEWPORT_DIMENSION)
    }
  })

  it('builds fixed presets with the chosen display scale', () => {
    expect(viewportFromPreset('mobile', 'actual')).toEqual({
      preset: 'mobile',
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      displayScale: 'actual'
    })
    expect(viewportFromPreset('responsive')).toEqual(RESPONSIVE_VIEWPORT)
  })
})

describe('parsePaneViewport', () => {
  it('accepts responsive and named presets', () => {
    expect(parsePaneViewport({ preset: 'responsive', displayScale: 'fit' })).toEqual({
      ok: true,
      viewport: RESPONSIVE_VIEWPORT
    })
    const tablet = parsePaneViewport({ preset: 'tablet', displayScale: 'actual' })
    expect(tablet.ok).toBe(true)
    if (tablet.ok) {
      expect(tablet.viewport).toMatchObject({
        preset: 'tablet',
        width: 820,
        height: 1180,
        deviceScaleFactor: 2,
        displayScale: 'actual'
      })
    }
  })

  it('accepts valid custom dimensions and device scale', () => {
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: 2,
        displayScale: 'fit'
      })
    ).toEqual({
      ok: true,
      viewport: {
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: 2,
        displayScale: 'fit'
      }
    })
  })

  it('rejects bad presets, scales, dimensions, and device factors', () => {
    expect(parsePaneViewport(null).ok).toBe(false)
    expect(parsePaneViewport({ preset: 'watch', displayScale: 'fit' }).ok).toBe(false)
    expect(parsePaneViewport({ preset: 'mobile', displayScale: 'zoom' }).ok).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: MIN_VIEWPORT_DIMENSION - 1,
        height: 700,
        deviceScaleFactor: 2,
        displayScale: 'fit'
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: MAX_VIEWPORT_DIMENSION + 1,
        height: 700,
        deviceScaleFactor: 2,
        displayScale: 'fit'
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: MAX_DEVICE_SCALE_FACTOR + 1,
        displayScale: 'fit'
      }).ok
    ).toBe(false)
    expect(
      parsePaneViewport({
        preset: 'custom',
        width: 500,
        height: 700,
        deviceScaleFactor: MIN_DEVICE_SCALE_FACTOR - 1,
        displayScale: 'fit'
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

  it('uses actual scale for actual mode and responsive panes', () => {
    const mobile = viewportFromPreset('mobile', 'actual')
    expect(viewportDisplayScale(mobile, { width: 100, height: 100 })).toBe(1)
    expect(viewportDisplayScale(RESPONSIVE_VIEWPORT, { width: 100, height: 100 })).toBe(1)
  })

  it('handles invalid available space safely', () => {
    expect(viewportDisplayScale(viewportFromPreset('desktop'), { width: 0, height: 0 })).toBe(1)
  })
})
