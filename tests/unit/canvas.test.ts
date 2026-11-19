import { describe, expect, it } from 'vitest'
import {
  CANVAS_GAP,
  CANVAS_HEADER_HEIGHT,
  CANVAS_ORIGIN,
  canvasContentSize,
  canvasFrameSize,
  defaultCanvasPositions,
  isValidCanvasPosition,
  snapCanvasRect
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

  it('snaps a dragged frame to neighboring edges and centers', () => {
    const target = { x: 600, y: 40, width: 400, height: 800 }

    expect(
      snapCanvasRect({ x: 596, y: 100, width: 300, height: 500 }, [target], 8)
    ).toMatchObject({
      x: 600,
      y: 100,
      snappedX: true,
      snappedY: false,
      guides: { vertical: [600], horizontal: [] }
    })

    expect(
      snapCanvasRect({ x: 720, y: 836, width: 100, height: 500 }, [target], 8)
    ).toMatchObject({
      x: 720,
      y: 840,
      snappedX: false,
      snappedY: true,
      guides: { vertical: [], horizontal: [840] }
    })
  })

  it('snaps centers without moving beyond the threshold', () => {
    const target = { x: 100, y: 100, width: 400, height: 300 }
    const snapped = snapCanvasRect(
      { x: 700, y: 208, width: 100, height: 80 },
      [target],
      4
    )
    expect(snapped.x).toBe(700)
    expect(snapped.y).toBe(210)
    expect(snapped.guides).toEqual({ vertical: [], horizontal: [250] })

    expect(
      snapCanvasRect({ x: 700, y: 700, width: 100, height: 80 }, [target], 8)
    ).toEqual({
      x: 700,
      y: 700,
      guides: { vertical: [], horizontal: [] },
      snappedX: false,
      snappedY: false
    })
  })

  it('returns the original frame for invalid input', () => {
    expect(
      snapCanvasRect({ x: 10, y: 20, width: 0, height: 100 }, [], 8)
    ).toEqual({
      x: 10,
      y: 20,
      guides: { vertical: [], horizontal: [] },
      snappedX: false,
      snappedY: false
    })
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
