import { describe, expect, it } from 'vitest'
import {
  CANVAS_GAP,
  CANVAS_HEADER_HEIGHT,
  CANVAS_ORIGIN,
  CANVAS_SHOWCASE_GAP,
  arrangeCanvasFrames,
  canvasContentSize,
  canvasFrameSize,
  canvasPaneIdsInRect,
  defaultCanvasPositions,
  duplicateCanvasPosition,
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
    expect(
      canvasFrameSize({
        preset: 'mobile',
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        rotated: true
      })
    ).toEqual({
      width: 844,
      height: 390 + CANVAS_HEADER_HEIGHT
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
      guides: { vertical: [600], horizontal: [] },
      proximity: { vertical: [], horizontal: [40] }
    })

    expect(
      snapCanvasRect({ x: 720, y: 836, width: 100, height: 500 }, [target], 8)
    ).toMatchObject({
      x: 720,
      y: 840,
      snappedX: false,
      snappedY: true,
      guides: { vertical: [], horizontal: [840] },
      proximity: { vertical: [800], horizontal: [] }
    })
  })

  it('shows a proximity guide before the near-gap snap', () => {
    const target = { x: 0, y: 0, width: 400, height: 800 }
    const preview = snapCanvasRect({ x: 450, y: 1000, width: 300, height: 500 }, [target], {
      threshold: 8,
      nearThreshold: 24,
      nearGap: 16,
      proximityThreshold: 64
    })
    expect(preview.x).toBe(450)
    expect(preview.snappedX).toBe(false)
    expect(preview.guides).toEqual({ vertical: [], horizontal: [] })
    expect(preview.proximity).toEqual({ vertical: [400], horizontal: [] })
  })

  it('snaps to a near gap before the flush snap', () => {
    const target = { x: 0, y: 0, width: 400, height: 800 }
    const options = {
      threshold: 8,
      nearThreshold: 24,
      nearGap: 16,
      proximityThreshold: 64
    }

    const near = snapCanvasRect({ x: 420, y: 1000, width: 300, height: 500 }, [target], options)
    expect(near.x).toBe(416)
    expect(near.snappedX).toBe(true)
    expect(near.guides.vertical).toEqual([400])
    expect(near.proximity).toEqual({ vertical: [], horizontal: [] })

    const flush = snapCanvasRect({ x: 396, y: 1000, width: 300, height: 500 }, [target], options)
    expect(flush.x).toBe(400)
    expect(flush.snappedX).toBe(true)
    expect(flush.guides.vertical).toEqual([400])
    expect(flush.proximity).toEqual({ vertical: [], horizontal: [] })
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
      proximity: { vertical: [], horizontal: [] },
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
      proximity: { vertical: [], horizontal: [] },
      snappedX: false,
      snappedY: false
    })
  })

  it('places a duplicate beside its source and skips occupied slots', () => {
    const source = { x: 100, y: 50, width: 300, height: 500 }

    expect(duplicateCanvasPosition(source, [])).toEqual({
      x: 460,
      y: 50
    })

    expect(
      duplicateCanvasPosition(source, [
        { x: 460, y: 50, width: 300, height: 500 }
      ])
    ).toEqual({ x: 100, y: 610 })

    expect(
      duplicateCanvasPosition(source, [
        { x: 460, y: 50, width: 300, height: 500 },
        { x: 100, y: 610, width: 300, height: 500 }
      ])
    ).toEqual({ x: 100, y: 1170 })

    expect(
      duplicateCanvasPosition(source, [
        { x: 460, y: 600, width: 300, height: 500 }
      ])
    ).toEqual({ x: 460, y: 50 })
  })

  it('arranges frames in a horizontal row and vertical stack', () => {
    const frames = [
      { id: PANE_A, width: 300, height: 500 },
      { id: PANE_B, width: 200, height: 400 },
      { id: '33333333-3333-4333-8333-333333333333', width: 400, height: 300 }
    ]

    expect(arrangeCanvasFrames(frames, 'row')).toEqual({
      [PANE_A]: { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN },
      [PANE_B]: { x: CANVAS_ORIGIN + 300 + CANVAS_GAP, y: CANVAS_ORIGIN },
      '33333333-3333-4333-8333-333333333333': {
        x: CANVAS_ORIGIN + 300 + CANVAS_GAP + 200 + CANVAS_GAP,
        y: CANVAS_ORIGIN
      }
    })

    expect(arrangeCanvasFrames(frames, 'stack')).toEqual({
      [PANE_A]: { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN },
      [PANE_B]: { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN + 500 + CANVAS_GAP },
      '33333333-3333-4333-8333-333333333333': {
        x: CANVAS_ORIGIN,
        y: CANVAS_ORIGIN + 500 + CANVAS_GAP + 400 + CANVAS_GAP
      }
    })
  })

  it('arranges frames in a two-column grid with aligned columns and rows', () => {
    const frames = [
      { id: PANE_A, width: 300, height: 500 },
      { id: PANE_B, width: 200, height: 400 },
      { id: '33333333-3333-4333-8333-333333333333', width: 400, height: 300 }
    ]

    expect(arrangeCanvasFrames(frames, 'grid')).toEqual({
      [PANE_A]: { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN },
      [PANE_B]: { x: CANVAS_ORIGIN + 400 + CANVAS_GAP, y: CANVAS_ORIGIN },
      '33333333-3333-4333-8333-333333333333': {
        x: CANVAS_ORIGIN,
        y: CANVAS_ORIGIN + 500 + CANVAS_GAP
      }
    })
  })

  it('packs showcase rows tightly and centers shorter rows', () => {
    const frames = [
      { id: PANE_A, width: 1000, height: 700 },
      { id: PANE_B, width: 1000, height: 700 },
      { id: '33333333-3333-4333-8333-333333333333', width: 1000, height: 700 }
    ]

    expect(arrangeCanvasFrames(frames, 'showcase')).toEqual({
      [PANE_A]: { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN },
      [PANE_B]: {
        x: CANVAS_ORIGIN + 1000 + CANVAS_SHOWCASE_GAP,
        y: CANVAS_ORIGIN
      },
      '33333333-3333-4333-8333-333333333333': {
        x: CANVAS_ORIGIN + (1000 + CANVAS_SHOWCASE_GAP) / 2,
        y: CANVAS_ORIGIN + 700 + CANVAS_SHOWCASE_GAP
      }
    })
  })

  it('selects frames overlapping a marquee rectangle', () => {
    const frames = [
      { id: PANE_A, x: 40, y: 40, width: 300, height: 500 },
      { id: PANE_B, x: 400, y: 40, width: 300, height: 500 },
      { id: '33333333-3333-4333-8333-333333333333', x: 40, y: 600, width: 300, height: 500 }
    ]

    expect(canvasPaneIdsInRect(frames, { x: 20, y: 20, width: 350, height: 550 })).toEqual([
      PANE_A
    ])
    expect(canvasPaneIdsInRect(frames, { x: 20, y: 20, width: 720, height: 550 })).toEqual([
      PANE_A,
      PANE_B
    ])
    expect(canvasPaneIdsInRect(frames, { x: 340, y: 0, width: 60, height: 40 })).toEqual([])
    expect(canvasPaneIdsInRect(frames, { x: 0, y: 0, width: 0, height: 10 })).toEqual([])
  })

  it('returns no positions for an empty or invalid arrangement', () => {
    expect(arrangeCanvasFrames([], 'row')).toEqual({})
    expect(
      arrangeCanvasFrames([{ id: PANE_A, width: 0, height: 500 }], 'row')
    ).toEqual({})
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
