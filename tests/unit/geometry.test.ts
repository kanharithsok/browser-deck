import { describe, expect, it } from 'vitest'
import {
  MIN_PANE_VIEW_HEIGHT,
  MIN_PANE_VIEW_WIDTH,
  parsePaneBounds,
  sanitizeRect
} from '../../src/shared/geometry'

const canvas = { width: 1000, height: 800 }
const knownPanes = new Set(['pane-a', 'pane-b'])

describe('sanitizeRect', () => {
  it('rounds and clamps a valid rectangle', () => {
    expect(sanitizeRect({ x: 10.4, y: 20.6, width: 300.2, height: 400.8 }, canvas)).toEqual({
      x: 10,
      y: 21,
      width: 300,
      height: 401
    })
  })

  it('clamps rectangles that extend beyond the canvas', () => {
    expect(sanitizeRect({ x: 900, y: 700, width: 300, height: 300 }, canvas)).toEqual({
      x: 900,
      y: 700,
      width: 100,
      height: 100
    })
  })

  it('rejects non-finite and non-positive rectangles', () => {
    expect(sanitizeRect({ x: Number.NaN, y: 0, width: 10, height: 10 }, canvas)).toBeNull()
    expect(sanitizeRect({ x: 0, y: 0, width: 0, height: 10 }, canvas)).toBeNull()
    expect(sanitizeRect({ x: 0, y: 0, width: 10, height: -1 }, canvas)).toBeNull()
  })

  it('rejects a rectangle entirely outside the canvas', () => {
    expect(sanitizeRect({ x: 1200, y: 900, width: 10, height: 10 }, canvas)).toBeNull()
  })
})

describe('parsePaneBounds', () => {
  it('accepts valid updates for known panes', () => {
    const result = parsePaneBounds(
      [
        { paneId: 'pane-a', rect: { x: 10, y: 20, width: 300, height: 200 } },
        { paneId: 'pane-b', rect: { x: 320, y: 20, width: 300, height: 200 } }
      ],
      knownPanes,
      canvas
    )

    expect(result).toEqual({
      ok: true,
      updates: [
        { paneId: 'pane-a', rect: { x: 10, y: 20, width: 300, height: 200 } },
        { paneId: 'pane-b', rect: { x: 320, y: 20, width: 300, height: 200 } }
      ]
    })
  })

  it('rejects unknown and duplicate pane IDs', () => {
    const unknown = parsePaneBounds(
      [{ paneId: 'pane-c', rect: { x: 0, y: 0, width: 200, height: 200 } }],
      knownPanes,
      canvas
    )
    expect(unknown.ok).toBe(false)

    const duplicate = parsePaneBounds(
      [
        { paneId: 'pane-a', rect: { x: 0, y: 0, width: 200, height: 200 } },
        { paneId: 'pane-a', rect: { x: 10, y: 0, width: 200, height: 200 } }
      ],
      knownPanes,
      canvas
    )
    expect(duplicate.ok).toBe(false)
  })

  it('rejects malformed payloads and non-finite values', () => {
    expect(parsePaneBounds(null, knownPanes, canvas).ok).toBe(false)
    expect(parsePaneBounds({}, knownPanes, canvas).ok).toBe(false)
    expect(
      parsePaneBounds(
        [{ paneId: 'pane-a', rect: { x: Infinity, y: 0, width: 200, height: 200 } }],
        knownPanes,
        canvas
      ).ok
    ).toBe(false)
  })

  it('rejects panes below the supported minimum view size', () => {
    const result = parsePaneBounds(
      [
        {
          paneId: 'pane-a',
          rect: { x: 0, y: 0, width: MIN_PANE_VIEW_WIDTH - 1, height: MIN_PANE_VIEW_HEIGHT }
        }
      ],
      knownPanes,
      canvas
    )
    expect(result.ok).toBe(false)
  })

  it('rejects invalid canvas sizes and oversized payloads', () => {
    expect(parsePaneBounds([], knownPanes, { width: 0, height: 800 }).ok).toBe(false)
    expect(
      parsePaneBounds(
        Array.from({ length: 201 }, (_, index) => ({
          paneId: `pane-${index}`,
          rect: { x: 0, y: 0, width: 100, height: 100 }
        })),
        knownPanes,
        canvas
      ).ok
    ).toBe(false)
  })
})
