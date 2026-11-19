import { describe, expect, it } from 'vitest'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_PRESETS,
  CANVAS_ZOOM_STEP,
  clampCanvasZoom,
  parseCanvasZoomAction,
  parseCanvasZoomState
} from '../../src/shared/zoom'

describe('canvas zoom', () => {
  it('clamps zoom to the supported range and exposes presets', () => {
    expect(clampCanvasZoom(0.1)).toBe(CANVAS_MIN_ZOOM)
    expect(clampCanvasZoom(3)).toBe(CANVAS_MAX_ZOOM)
    expect(clampCanvasZoom(1.25)).toBe(1.25)
    expect(CANVAS_ZOOM_STEP).toBeGreaterThan(0)
    expect(CANVAS_ZOOM_PRESETS[0]).toBe(CANVAS_MIN_ZOOM)
    expect(CANVAS_ZOOM_PRESETS[CANVAS_ZOOM_PRESETS.length - 1]).toBe(CANVAS_MAX_ZOOM)
  })

  it('validates the zoom bar state', () => {
    expect(
      parseCanvasZoomState({
        theme: 'dark',
        themePreference: 'system',
        zoom: 0.5,
        handMode: false
      })
    ).toEqual({
      theme: 'dark',
      themePreference: 'system',
      zoom: 0.5,
      handMode: false
    })
    expect(
      parseCanvasZoomState({
        theme: 'sepia',
        themePreference: 'system',
        zoom: 1,
        handMode: false
      })
    ).toBeNull()
    expect(
      parseCanvasZoomState({
        theme: 'light',
        themePreference: 'system',
        zoom: 0.1,
        handMode: false
      })
    ).toBeNull()
    expect(
      parseCanvasZoomState({
        theme: 'light',
        themePreference: 'sepia',
        zoom: 1,
        handMode: false
      })
    ).toBeNull()
  })

  it('validates every action', () => {
    expect(parseCanvasZoomAction({ type: 'step', direction: 'in' })).toEqual({
      type: 'step',
      direction: 'in'
    })
    expect(parseCanvasZoomAction({ type: 'set', zoom: 1.5 })).toEqual({
      type: 'set',
      zoom: 1.5
    })
    expect(parseCanvasZoomAction({ type: 'fit' })).toEqual({ type: 'fit' })
    expect(parseCanvasZoomAction({ type: 'reset' })).toEqual({ type: 'reset' })
    expect(parseCanvasZoomAction({ type: 'menu' })).toEqual({ type: 'menu' })
    expect(parseCanvasZoomAction({ type: 'toggle-hand' })).toEqual({
      type: 'toggle-hand'
    })
    expect(parseCanvasZoomAction({ type: 'appearance' })).toEqual({
      type: 'appearance'
    })
    expect(parseCanvasZoomAction({ type: 'set', zoom: 3 })).toBeNull()
    expect(parseCanvasZoomAction({ type: 'step', direction: 'left' })).toBeNull()
    expect(parseCanvasZoomAction(null)).toBeNull()
  })
})
