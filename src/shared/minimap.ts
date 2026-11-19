import type { Size } from './layout'

export interface MinimapFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
  active?: boolean
}

export interface MinimapViewport {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapLayout {
  scale: number
  offsetX: number
  offsetY: number
  frames: Array<{ id: string; active: boolean; rect: MinimapRect }>
  viewport: MinimapRect
}

function positiveSize(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Projects world-space canvas frames and the visible viewport into a fixed
 * overview map. Both the panes and the current viewport are included in the
 * bounds so the map remains useful after panning far away from every pane.
 */
export function layoutMinimap(
  frames: readonly MinimapFrame[],
  viewport: MinimapViewport | null,
  map: Size,
  padding = 8
): MinimapLayout | null {
  if (!positiveSize(map.width) || !positiveSize(map.height) || frames.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const frame of frames) {
    if (!positiveSize(frame.width) || !positiveSize(frame.height)) {
      continue
    }
    minX = Math.min(minX, frame.x)
    minY = Math.min(minY, frame.y)
    maxX = Math.max(maxX, frame.x + frame.width)
    maxY = Math.max(maxY, frame.y + frame.height)
  }

  if (viewport && positiveSize(viewport.width) && positiveSize(viewport.height)) {
    minX = Math.min(minX, viewport.x)
    minY = Math.min(minY, viewport.y)
    maxX = Math.max(maxX, viewport.x + viewport.width)
    maxY = Math.max(maxY, viewport.y + viewport.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null
  }

  const worldWidth = Math.max(1, maxX - minX)
  const worldHeight = Math.max(1, maxY - minY)
  const innerWidth = Math.max(1, map.width - padding * 2)
  const innerHeight = Math.max(1, map.height - padding * 2)
  const scale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight, 4)
  const offsetX = (map.width - worldWidth * scale) / 2 - minX * scale
  const offsetY = (map.height - worldHeight * scale) / 2 - minY * scale

  const project = (x: number, y: number, width: number, height: number): MinimapRect => ({
    x: offsetX + x * scale,
    y: offsetY + y * scale,
    width: Math.max(2, width * scale),
    height: Math.max(2, height * scale)
  })

  return {
    scale,
    offsetX,
    offsetY,
    frames: frames
      .filter((frame) => positiveSize(frame.width) && positiveSize(frame.height))
      .map((frame) => ({
        id: frame.id,
        active: frame.active === true,
        rect: project(frame.x, frame.y, frame.width, frame.height)
      })),
    viewport: viewport
      ? project(viewport.x, viewport.y, viewport.width, viewport.height)
      : { x: offsetX, y: offsetY, width: 0, height: 0 }
  }
}
