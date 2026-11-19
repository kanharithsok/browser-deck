import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  parseCanvasZoomState,
  type CanvasZoomAction,
  type CanvasZoomState
} from '../../shared/zoom'

const value = document.querySelector<HTMLElement>('#value')
const percent = document.querySelector<HTMLButtonElement>('#percent')
const out = document.querySelector<HTMLButtonElement>('#out')
const zoomIn = document.querySelector<HTMLButtonElement>('#in')

if (!value || !percent || !out || !zoomIn) {
  throw new Error('Canvas zoom DOM is unavailable.')
}

const valueElement = value
const percentButton = percent
const outButton = out
const inButton = zoomIn

function send(action: CanvasZoomAction): void {
  void window.paneflow.sendCanvasZoomAction(action).catch(() => undefined)
}

function render(state: CanvasZoomState): void {
  document.documentElement.dataset.theme = state.theme
  valueElement.textContent = `${Math.round(state.zoom * 100)}%`
  outButton.disabled = state.zoom <= CANVAS_MIN_ZOOM
  inButton.disabled = state.zoom >= CANVAS_MAX_ZOOM
}

percentButton.addEventListener('click', () => {
  send({ type: 'menu' })
})

outButton.addEventListener('click', () => {
  send({ type: 'step', direction: 'out' })
})

inButton.addEventListener('click', () => {
  send({ type: 'step', direction: 'in' })
})

window.paneflow.onCanvasZoomState((state) => {
  const parsed = parseCanvasZoomState(state)
  if (parsed) {
    render(parsed)
  }
})
