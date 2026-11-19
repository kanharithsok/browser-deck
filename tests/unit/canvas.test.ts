import { describe, expect, it } from 'vitest'
import {
  CANVAS_GAP,
  CANVAS_HEADER_HEIGHT,
  CANVAS_ORIGIN,
  canvasContentSize,
  canvasFrameSize,
  defaultCanvasPositions,
  isValidCanvasPosition
} from '../../src/shared/canvas'
import { normalizeWorkspaceLayout } from '../../src/shared/workspace'

const PANE_A = '11111111-1111-4111-8111-111111111111'
const PANE_B = '22222222-2222-4222-8222-222222222222'

describe('canvas layout helpers', () => {
  it('uses the declared responsive canvas size and adds header height', () => {
    expect(canvasContentSize({ preset: 'responsive', width: 0, height: 0, deviceScaleFactor: 1 })).toEqual({
      width: 560,
      height: 700
    })
    expect(canvasFrameSize({ preset: 'mobile', width: 390, height: 844, deviceScaleFactor: 3 })).toEqual({
      width: 390,
      height: 844 + CANVAS_HEADER_HEIGHT
    })
  })

  it('arranges missing panes in a deterministic row', () => {
    const positions = defaultCanvasPositions([
      { id: PANE_A, viewport: { preset: 'responsive', width: 0, height: 0, deviceScaleFactor: 1 } },
      { id: PANE_B, viewport: { preset: 'mobile', width: 390, height: 844, deviceScaleFactor: 3 } }
    ])
    expect(positions[PANE_A]).toEqual({ x: CANVAS_ORIGIN, y: CANVAS_ORIGIN })
    expect(positions[PANE_B]).toEqual({
      x: CANVAS_ORIGIN + 560 + CANVAS_GAP,
      y: CANVAS_ORIGIN
    })
  })

  it('accepts finite canvas coordinates only', () => {
    expect(isValidCanvasPosition({ x: -10, y: 40 })).toBe(true)
    expect(isValidCanvasPosition({ x: 0, y: 0 })).toBe(true)
    expect(isValidCanvasPosition({ x: Number.NaN, y: 0 })).toBe(false)
    expect(isValidCanvasPosition({ x: 0 })).toBe(false)
    expect(isValidCanvasPosition(null)).toBe(false)
  })

  it('normalizes canvas mode and drops unknown or invalid positions', () => {
    const layout = normalizeWorkspaceLayout(
      {
        mode: 'canvas',
        columns: 2,
        gridOrder: [PANE_A],
        freeformOrder: [PANE_A],
        freeform: {},
        canvas: {
          [PANE_A]: { x: 120, y: 80 },
          unknown: { x: 10, y: 10 },
          [PANE_B]: { x: 'nope', y: 10 }
        }
      },
      [PANE_A, PANE_B]
    )

    expect(layout.mode).toBe('canvas')
    expect(layout.canvas).toEqual({ [PANE_A]: { x: 120, y: 80 } })
    expect(layout.gridOrder).toEqual([PANE_A, PANE_B])
  })
})
