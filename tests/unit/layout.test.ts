import { describe, expect, it } from 'vitest'
import {
  bringToFront,
  clampRect,
  isRectFullyVisible,
  layoutGrid,
  moveItem,
  moveRect,
  normalizedToRect,
  rectToNormalized,
  reorderPaneIds,
  resizeRect,
  sendToBack,
  snapRect
} from '../../src/shared/layout'

const canvas = { width: 1000, height: 800 }
const minimum = { width: 160, height: 120 }

describe('layoutGrid', () => {
  it('places panes in equal columns and one row when they fit', () => {
    const result = layoutGrid(['a', 'b'], canvas, {
      columns: 2,
      padding: 10,
      gap: 10
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.layout.rows).toBe(1)
    expect(result.layout.contentHeight).toBe(800)
    expect(result.layout.needsVerticalScroll).toBe(false)
    expect(result.layout.columnTooNarrow).toBe(false)
    expect(result.layout.placements).toEqual([
      { paneId: 'a', index: 0, row: 0, column: 0, rect: { x: 10, y: 10, width: 485, height: 780 } },
      { paneId: 'b', index: 1, row: 0, column: 1, rect: { x: 505, y: 10, width: 485, height: 780 } }
    ])
  })

  it('wraps rows in order and leaves the final row left-aligned', () => {
    const result = layoutGrid(['a', 'b', 'c', 'd', 'e'], canvas, {
      columns: 3,
      padding: 10,
      gap: 10
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.layout.rows).toBe(2)
    expect(result.layout.placements.map((placement) => placement.rect)).toEqual([
      { x: 10, y: 10, width: 320, height: 385 },
      { x: 340, y: 10, width: 320, height: 385 },
      { x: 670, y: 10, width: 320, height: 385 },
      { x: 10, y: 405, width: 320, height: 385 },
      { x: 340, y: 405, width: 320, height: 385 }
    ])
  })

  it('supports all column counts from 1 through 5', () => {
    for (let columns = 1; columns <= 5; columns += 1) {
      const result = layoutGrid(
        Array.from({ length: columns }, (_, index) => `pane-${index}`),
        canvas,
        { columns, padding: 0, gap: 0 }
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.layout.rows).toBe(1)
        expect(result.layout.placements.every((placement) => placement.rect.width > 0)).toBe(true)
      }
    }
  })

  it('reports vertical scrolling instead of shrinking below the minimum row height', () => {
    const result = layoutGrid(['a', 'b', 'c'], { width: 1000, height: 500 }, {
      columns: 1,
      padding: 10,
      gap: 10,
      minPaneHeight: 200
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.layout.rows).toBe(3)
    expect(result.layout.needsVerticalScroll).toBe(true)
    expect(result.layout.contentHeight).toBe(640)
    expect(result.layout.placements[0]?.rect.height).toBe(200)
  })

  it('reports columns that are narrower than the minimum pane width', () => {
    const result = layoutGrid(['a', 'b', 'c', 'd', 'e'], { width: 500, height: 800 }, {
      columns: 5,
      padding: 10,
      gap: 10
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.layout.columnTooNarrow).toBe(true)
    }
  })

  it('handles an empty pane list', () => {
    const result = layoutGrid([], canvas, { columns: 2 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.layout.rows).toBe(0)
      expect(result.layout.contentHeight).toBe(0)
      expect(result.layout.placements).toEqual([])
    }
  })

  it('rejects invalid canvases, columns, IDs, and options', () => {
    expect(layoutGrid([], { width: 0, height: 800 }, { columns: 2 })).toEqual({
      ok: false,
      error: 'invalid-canvas'
    })
    expect(layoutGrid([], canvas, { columns: 0 })).toEqual({
      ok: false,
      error: 'invalid-columns'
    })
    expect(layoutGrid([], canvas, { columns: 6 })).toEqual({
      ok: false,
      error: 'invalid-columns'
    })
    expect(layoutGrid([''], canvas, { columns: 2 })).toEqual({
      ok: false,
      error: 'invalid-pane-id'
    })
    expect(layoutGrid(['a', 'a'], canvas, { columns: 2 })).toEqual({
      ok: false,
      error: 'duplicate-pane-id'
    })
    expect(layoutGrid(['a'], canvas, { columns: 2, gap: -1 })).toEqual({
      ok: false,
      error: 'invalid-options'
    })
  })

  it('reflows after reordering, adding, and removing panes', () => {
    const initial = layoutGrid(['a', 'b', 'c'], canvas, {
      columns: 2,
      padding: 0,
      gap: 0
    })
    expect(initial.ok).toBe(true)
    if (!initial.ok) {
      return
    }
    expect(initial.layout.placements[2]?.rect.y).toBeGreaterThan(0)

    const reordered = reorderPaneIds(['a', 'b', 'c'], 'c', 0)
    expect(reordered).toEqual(['c', 'a', 'b'])
    const reorderedLayout = layoutGrid(reordered ?? [], canvas, {
      columns: 2,
      padding: 0,
      gap: 0
    })
    expect(reorderedLayout.ok).toBe(true)
    if (reorderedLayout.ok) {
      expect(reorderedLayout.layout.placements.map((placement) => placement.paneId)).toEqual([
        'c',
        'a',
        'b'
      ])
      expect(reorderedLayout.layout.placements[0]?.rect.x).toBe(0)
    }

    const addedLayout = layoutGrid(['a', 'b', 'c', 'd'], canvas, {
      columns: 2,
      padding: 0,
      gap: 0
    })
    expect(addedLayout.ok).toBe(true)
    if (addedLayout.ok) {
      expect(addedLayout.layout.rows).toBe(2)
      expect(addedLayout.layout.placements[3]).toMatchObject({
        paneId: 'd',
        row: 1,
        column: 1
      })
    }

    const removedLayout = layoutGrid(['a', 'c'], canvas, {
      columns: 2,
      padding: 0,
      gap: 0
    })
    expect(removedLayout.ok).toBe(true)
    if (removedLayout.ok) {
      expect(removedLayout.layout.rows).toBe(1)
      expect(removedLayout.layout.placements.map((placement) => placement.paneId)).toEqual([
        'a',
        'c'
      ])
    }
  })
})

describe('ordering', () => {
  it('moves items and returns a new array', () => {
    const original = ['a', 'b', 'c']
    const moved = moveItem(original, 2, 0)
    expect(moved).toEqual(['c', 'a', 'b'])
    expect(original).toEqual(['a', 'b', 'c'])
    expect(moveItem(original, 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('rejects out-of-range moves and unknown IDs', () => {
    expect(moveItem(['a'], -1, 0)).toBeNull()
    expect(moveItem(['a'], 0, 1)).toBeNull()
    expect(reorderPaneIds(['a', 'b'], 'missing', 0)).toBeNull()
  })

  it('brings a pane to the front or sends it to the back', () => {
    expect(bringToFront(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(sendToBack(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(bringToFront(['a'], 'missing')).toBeNull()
    expect(sendToBack(['a'], 'missing')).toBeNull()
  })
})

describe('rectangle clamping and movement', () => {
  it('clamps rectangles into the canvas', () => {
    expect(clampRect({ x: -50, y: -10, width: 300, height: 200 }, canvas, minimum)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200
    })
    expect(clampRect({ x: 900, y: 700, width: 300, height: 200 }, canvas, minimum)).toEqual({
      x: 700,
      y: 600,
      width: 300,
      height: 200
    })
  })

  it('enforces the minimum pane size and lets the canvas win when smaller', () => {
    expect(clampRect({ x: 10, y: 10, width: 100, height: 80 }, canvas, minimum)).toEqual({
      x: 10,
      y: 10,
      width: 160,
      height: 120
    })
    expect(clampRect({ x: 0, y: 0, width: 100, height: 80 }, { width: 100, height: 80 }, minimum)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80
    })
  })

  it('rejects invalid rectangles and canvases', () => {
    expect(clampRect({ x: 0, y: 0, width: 0, height: 10 }, canvas, minimum)).toBeNull()
    expect(clampRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 10 }, minimum)).toBeNull()
  })

  it('moves a rectangle while keeping it inside the canvas', () => {
    expect(moveRect({ x: 100, y: 100, width: 200, height: 150 }, 950, 800, canvas, minimum)).toEqual({
      x: 800,
      y: 650,
      width: 200,
      height: 150
    })
    expect(moveRect({ x: 100, y: 100, width: 200, height: 150 }, Number.NaN, 0, canvas, minimum)).toBeNull()
  })
})

describe('resizeRect', () => {
  const base = { x: 100, y: 100, width: 300, height: 200 }

  it('grows and shrinks from the expected edges', () => {
    expect(resizeRect(base, 'se', 100, 100, canvas, minimum)).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 300
    })
    expect(resizeRect(base, 'sw', -50, 50, canvas, minimum)).toEqual({
      x: 50,
      y: 100,
      width: 350,
      height: 250
    })
    expect(resizeRect(base, 'nw', 50, 50, canvas, minimum)).toEqual({
      x: 150,
      y: 150,
      width: 250,
      height: 150
    })
  })

  it('enforces the minimum size from every direction', () => {
    expect(resizeRect(base, 'e', -300, 0, canvas, minimum)).toEqual({
      x: 100,
      y: 100,
      width: 160,
      height: 200
    })
    expect(resizeRect(base, 'w', 300, 0, canvas, minimum)).toEqual({
      x: 240,
      y: 100,
      width: 160,
      height: 200
    })
    expect(resizeRect(base, 's', 0, -300, canvas, minimum)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 120
    })
    expect(resizeRect(base, 'n', 0, 300, canvas, minimum)).toEqual({
      x: 100,
      y: 180,
      width: 300,
      height: 120
    })
  })

  it('ignores deltas on the perpendicular axis', () => {
    expect(resizeRect(base, 'e', 50, 500, canvas, minimum)).toEqual({
      x: 100,
      y: 100,
      width: 350,
      height: 200
    })
  })

  it('rejects invalid inputs', () => {
    expect(resizeRect({ ...base, width: 0 }, 'e', 10, 0, canvas, minimum)).toBeNull()
    expect(resizeRect(base, 'e', Number.NaN, 0, canvas, minimum)).toBeNull()
  })
})

describe('normalized geometry', () => {
  it('converts between pixels and normalized coordinates', () => {
    const normalized = rectToNormalized({ x: 100, y: 100, width: 200, height: 150 }, canvas)
    expect(normalized).toEqual({ x: 0.1, y: 0.125, width: 0.2, height: 0.1875 })
    expect(normalizedToRect(normalized as NonNullable<typeof normalized>, { width: 500, height: 400 }, minimum)).toEqual({
      x: 50,
      y: 50,
      width: 160,
      height: 120
    })
  })

  it('adapts normalized geometry to a different canvas size', () => {
    const normalized = { x: 0.5, y: 0.5, width: 0.25, height: 0.25 }
    expect(normalizedToRect(normalized, { width: 2000, height: 1000 }, minimum)).toEqual({
      x: 1000,
      y: 500,
      width: 500,
      height: 250
    })
  })

  it('clamps normalized geometry into the canvas and minimum size', () => {
    expect(
      normalizedToRect({ x: -0.1, y: 0.9, width: 0.5, height: 0.5 }, canvas, minimum)
    ).toEqual({
      x: 0,
      y: 400,
      width: 500,
      height: 400
    })
  })

  it('rejects invalid normalized values', () => {
    expect(rectToNormalized({ x: 0, y: 0, width: 0, height: 10 }, canvas)).toBeNull()
    expect(normalizedToRect({ x: 0, y: 0, width: 0, height: 0.2 }, canvas, minimum)).toBeNull()
    expect(normalizedToRect({ x: 0, y: 0, width: 0.2, height: 0.2 }, { width: 0, height: 800 }, minimum)).toBeNull()
  })
})

describe('snapRect', () => {
  it('snaps to canvas edges and returns a guide', () => {
    const result = snapRect(
      { x: 5, y: 100, width: 200, height: 100 },
      { canvas, threshold: 8, snapToNeighbors: false }
    )
    expect(result).not.toBeNull()
    expect(result?.rect.x).toBe(0)
    expect(result?.snappedX).toBe(true)
    expect(result?.guides.vertical).toEqual([0])
  })

  it('snaps to the opposite canvas edge', () => {
    const result = snapRect(
      { x: 795, y: 100, width: 200, height: 100 },
      { canvas, threshold: 8, snapToNeighbors: false }
    )
    expect(result?.rect.x).toBe(800)
    expect(result?.snappedX).toBe(true)
    expect(result?.guides.vertical).toEqual([1000])
  })

  it('snaps to the canvas center', () => {
    const result = snapRect(
      { x: 395, y: 100, width: 200, height: 100 },
      { canvas, threshold: 8, snapToNeighbors: false }
    )
    expect(result?.rect.x).toBe(400)
    expect(result?.guides.vertical).toEqual([500])
  })

  it('snaps to neighboring pane edges', () => {
    const result = snapRect(
      { x: 505, y: 200, width: 200, height: 100 },
      {
        canvas,
        threshold: 8,
        snapToCanvas: false,
        neighbors: [{ x: 300, y: 0, width: 200, height: 100 }]
      }
    )
    expect(result?.rect.x).toBe(500)
    expect(result?.guides.vertical).toEqual([500])
  })

  it('snaps to both axes', () => {
    const result = snapRect(
      { x: 5, y: 7, width: 200, height: 100 },
      { canvas, threshold: 8, snapToNeighbors: false }
    )
    expect(result?.rect.x).toBe(0)
    expect(result?.rect.y).toBe(0)
    expect(result?.snappedX).toBe(true)
    expect(result?.snappedY).toBe(true)
  })

  it('does not snap beyond the threshold', () => {
    const result = snapRect(
      { x: 100, y: 100, width: 200, height: 100 },
      { canvas, threshold: 8, snapToNeighbors: false }
    )
    expect(result?.rect.x).toBe(100)
    expect(result?.rect.y).toBe(100)
    expect(result?.snappedX).toBe(false)
    expect(result?.snappedY).toBe(false)
    expect(result?.guides).toEqual({ vertical: [], horizontal: [] })
  })

  it('supports optional grid snapping', () => {
    const result = snapRect(
      { x: 18, y: 38, width: 200, height: 100 },
      { canvas, threshold: 8, snapToCanvas: false, snapToNeighbors: false, snapToGrid: true, gridSize: 20 }
    )
    expect(result?.rect.x).toBe(20)
    expect(result?.rect.y).toBe(40)
    expect(result?.guides).toEqual({ vertical: [20], horizontal: [40] })
  })

  it('rejects invalid snap options', () => {
    expect(
      snapRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { canvas, snapToCanvas: false, snapToNeighbors: false, snapToGrid: true, gridSize: 0 }
      )
    ).toBeNull()
    expect(
      snapRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { canvas, neighbors: [{ x: 0, y: 0, width: 0, height: 10 }] }
      )
    ).toBeNull()
  })
})

describe('isRectFullyVisible', () => {
  const viewport = { x: 10, y: 60, width: 800, height: 400 }

  it('accepts rectangles fully inside the viewport', () => {
    expect(
      isRectFullyVisible({ x: 10, y: 60, width: 300, height: 200 }, viewport)
    ).toBe(true)
    expect(
      isRectFullyVisible({ x: 500, y: 250, width: 310, height: 210 }, viewport)
    ).toBe(true)
  })

  it('rejects partially visible and off-screen rectangles', () => {
    expect(
      isRectFullyVisible({ x: 10, y: 50, width: 300, height: 200 }, viewport)
    ).toBe(false)
    expect(
      isRectFullyVisible({ x: 10, y: 300, width: 300, height: 200 }, viewport)
    ).toBe(false)
    expect(
      isRectFullyVisible({ x: 5, y: 60, width: 300, height: 200 }, viewport)
    ).toBe(false)
  })

  it('applies tolerance and rejects invalid inputs', () => {
    expect(
      isRectFullyVisible({ x: 9.6, y: 59.6, width: 300, height: 200 }, viewport, 0.5)
    ).toBe(true)
    expect(
      isRectFullyVisible({ x: 9.6, y: 59.6, width: 300, height: 200 }, viewport, 0)
    ).toBe(false)
    expect(isRectFullyVisible({ x: 0, y: 0, width: 0, height: 10 }, viewport)).toBe(false)
    expect(isRectFullyVisible({ x: 0, y: 0, width: 10, height: 10 }, viewport, -1)).toBe(false)
  })
})
