import { describe, expect, it } from 'vitest'
import { layoutMinimap } from '../../src/shared/minimap'

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
