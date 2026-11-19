import { describe, expect, it } from 'vitest'
import {
  CANVAS_MINIMAP_COLLAPSED_HEIGHT,
  CANVAS_MINIMAP_MAX_WIDTH,
  CANVAS_MINIMAP_MIN_WIDTH,
  canvasMinimapSize,
  layoutMinimap,
  parseCanvasMinimapAction,
  parseCanvasMinimapState
} from '../../src/shared/minimap'

describe('canvas minimap layout', () => {
  it('projects panes and the current viewport into the map', () => {
    const layout = layoutMinimap(
      [
        { id: 'a', x: 40, y: 40, width: 560, height: 732, active: true },
        { id: 'b', x: 660, y: 40, width: 560, height: 732 }
      ],
      { x: -100, y: -50, width: 800, height: 600 },
      { width: 520, height: 300 }
    )

    expect(layout).not.toBeNull()
    expect(layout?.frames).toHaveLength(2)
    expect(layout?.frames[0]?.active).toBe(true)
    expect(layout?.frames[0]?.rect.width).toBeGreaterThan(1)
    expect(layout?.frames[1]?.rect.x).toBeGreaterThan(layout?.frames[0]?.rect.x ?? 0)
    expect(layout?.viewport.width).toBeGreaterThan(1)
    expect(layout?.viewport.height).toBeGreaterThan(1)
  })

  it('keeps panes visible when the viewport has moved far away', () => {
    const layout = layoutMinimap(
      [{ id: 'a', x: 0, y: 0, width: 400, height: 300 }],
      { x: 9000, y: 9000, width: 800, height: 600 },
      { width: 400, height: 240 }
    )

    expect(layout).not.toBeNull()
    expect(layout?.frames[0]?.rect.x).toBeGreaterThanOrEqual(0)
    expect(layout?.frames[0]?.rect.x).toBeLessThan(400)
    expect(layout?.viewport.x).toBeLessThan(400)
    expect(layout?.viewport.y).toBeLessThan(240)
  })

  it('returns null without panes or a valid map size', () => {
    expect(layoutMinimap([], null, { width: 520, height: 300 })).toBeNull()
    expect(
      layoutMinimap(
        [{ id: 'a', x: 0, y: 0, width: 400, height: 300 }],
        null,
        { width: 0, height: 300 }
      )
    ).toBeNull()
  })
})

describe('canvas minimap panel sizing', () => {
  it('shrinks with the window and stays within readable bounds', () => {
    expect(canvasMinimapSize({ width: 720, height: 520 }, false)).toEqual({
      width: CANVAS_MINIMAP_MIN_WIDTH,
      height: Math.round(CANVAS_MINIMAP_MIN_WIDTH * 0.64)
    })
    expect(canvasMinimapSize({ width: 1280, height: 860 }, false)).toEqual({
      width: 205,
      height: Math.round(205 * 0.64)
    })
    expect(canvasMinimapSize({ width: 1920, height: 1080 }, false)).toEqual({
      width: CANVAS_MINIMAP_MAX_WIDTH,
      height: Math.round(CANVAS_MINIMAP_MAX_WIDTH * 0.64)
    })
  })

  it('keeps only the header visible when collapsed', () => {
    expect(canvasMinimapSize({ width: 1280, height: 860 }, true).height).toBe(
      CANVAS_MINIMAP_COLLAPSED_HEIGHT
    )
  })
})

describe('canvas minimap state validation', () => {
  const validState = {
    theme: 'dark',
    zoom: 1.25,
    panes: [
      {
        id: 'pane-a',
        title: 'Pane A',
        active: true,
        x: 10,
        y: 20,
        width: 560,
        height: 732
      }
    ],
    viewport: { x: -100, y: -50, width: 800, height: 600 }
  }

  it('accepts a complete trusted state payload', () => {
    expect(parseCanvasMinimapState(validState)).toEqual(validState)
  })

  it('rejects malformed themes, zoom, panes, and viewports', () => {
    expect(parseCanvasMinimapState({ ...validState, theme: 'sepia' })).toBeNull()
    expect(parseCanvasMinimapState({ ...validState, zoom: 0.1 })).toBeNull()
    expect(
      parseCanvasMinimapState({
        ...validState,
        panes: [{ ...validState.panes[0], width: 0 }]
      })
    ).toBeNull()
    expect(
      parseCanvasMinimapState({
        ...validState,
        viewport: { ...validState.viewport, height: 0 }
      })
    ).toBeNull()
  })

  it('validates every minimap action and collapse state', () => {
    expect(parseCanvasMinimapAction({ type: 'focus', paneId: 'pane-a' })).toEqual({
      type: 'focus',
      paneId: 'pane-a'
    })
    expect(parseCanvasMinimapAction({ type: 'recenter', x: 12, y: -8 })).toEqual({
      type: 'recenter',
      x: 12,
      y: -8
    })
    expect(parseCanvasMinimapAction({ type: 'fit' })).toEqual({ type: 'fit' })
    expect(parseCanvasMinimapAction({ type: 'collapse', collapsed: true })).toEqual({
      type: 'collapse',
      collapsed: true
    })
    expect(parseCanvasMinimapAction({ type: 'collapse', collapsed: 'yes' })).toBeNull()
    expect(parseCanvasMinimapAction({ type: 'unknown' })).toBeNull()
  })
})
