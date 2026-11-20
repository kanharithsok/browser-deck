import {
  layoutMinimap,
  type CanvasMinimapAction,
  type CanvasMinimapState
} from '../../shared/minimap'

const panel = document.querySelector<HTMLElement>('#panel')
const map = document.querySelector<HTMLElement>('#map')
const empty = document.querySelector<HTMLElement>('#empty')
const zoom = document.querySelector<HTMLElement>('#zoom')
const fit = document.querySelector<HTMLButtonElement>('#fit')
const collapse = document.querySelector<HTMLButtonElement>('#collapse')

if (!panel || !map || !empty || !zoom || !fit || !collapse) {
  throw new Error('Canvas minimap DOM is unavailable.')
}

const panelElement = panel
const mapElement = map
const emptyElement = empty
const zoomElement = zoom
const fitButton = fit
const collapseButton = collapse

let state: CanvasMinimapState | null = null
let layout: ReturnType<typeof layoutMinimap> = null
let collapsed = false

function send(action: CanvasMinimapAction): void {
  void window.browserdeck.sendCanvasMinimapAction(action).catch(() => undefined)
}

function applyCollapsed(next: boolean): void {
  collapsed = next
  panelElement.dataset.collapsed = next ? 'true' : 'false'
  collapseButton.setAttribute('aria-expanded', String(!next))
  collapseButton.setAttribute('aria-label', next ? 'Expand overview' : 'Collapse overview')
  collapseButton.title = next ? 'Expand overview' : 'Collapse overview'
  if (!next) {
    requestAnimationFrame(() => {
      if (state) {
        render(state)
      }
    })
  }
}

function render(nextState: CanvasMinimapState): void {
  state = nextState
  document.documentElement.dataset.theme = nextState.theme
  zoomElement.textContent = `${Math.round(nextState.zoom * 100)}%`
  fitButton.disabled = nextState.panes.length === 0

  if (collapsed) {
    return
  }

  mapElement.replaceChildren()
  layout = layoutMinimap(
    nextState.panes,
    nextState.viewport,
    {
      width: Math.max(1, mapElement.clientWidth),
      height: Math.max(1, mapElement.clientHeight)
    },
    6
  )

  if (!layout || layout.frames.length === 0) {
    mapElement.append(emptyElement)
    return
  }

  for (const frame of layout.frames) {
    const title = nextState.panes.find((pane) => pane.id === frame.id)?.title ?? 'Browser'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = frame.active ? 'frame active' : 'frame'
    button.style.left = `${frame.rect.x}px`
    button.style.top = `${frame.rect.y}px`
    button.style.width = `${frame.rect.width}px`
    button.style.height = `${frame.rect.height}px`
    button.title = `Focus browser: ${title}`
    button.setAttribute('aria-label', `Focus browser: ${title}`)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      send({ type: 'focus', paneId: frame.id })
    })
    mapElement.append(button)
  }

  const viewport = document.createElement('span')
  viewport.className = 'viewport'
  viewport.style.left = `${layout.viewport.x}px`
  viewport.style.top = `${layout.viewport.y}px`
  viewport.style.width = `${layout.viewport.width}px`
  viewport.style.height = `${layout.viewport.height}px`
  viewport.setAttribute('aria-hidden', 'true')
  mapElement.append(viewport)
}

mapElement.addEventListener('click', (event) => {
  if (!layout || !state) {
    return
  }
  if (event.target instanceof Element && event.target.closest('.frame')) {
    return
  }
  const rect = mapElement.getBoundingClientRect()
  const worldX = (event.clientX - rect.left - layout.offsetX) / layout.scale
  const worldY = (event.clientY - rect.top - layout.offsetY) / layout.scale
  send({ type: 'recenter', x: worldX, y: worldY })
})

fitButton.addEventListener('click', () => {
  send({ type: 'fit' })
})

collapseButton.addEventListener('click', () => {
  const next = !collapsed
  applyCollapsed(next)
  send({ type: 'collapse', collapsed: next })
})

window.addEventListener('resize', () => {
  if (state) {
    render(state)
  }
})

window.browserdeck.onCanvasMinimapState(render)
