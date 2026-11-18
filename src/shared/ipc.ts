export const IPC_CHANNELS = {
  getState: 'paneflow:get-state',
  addPane: 'paneflow:add-pane',
  closePane: 'paneflow:close-pane',
  navigate: 'paneflow:navigate',
  back: 'paneflow:back',
  forward: 'paneflow:forward',
  reload: 'paneflow:reload',
  reloadAll: 'paneflow:reload-all',
  setPaneBounds: 'paneflow:set-pane-bounds',
  showPaneMenu: 'paneflow:show-pane-menu',
  stateChanged: 'paneflow:state-changed',
  requestMeasurement: 'paneflow:request-measurement'
} as const

export type ScriptResult = { ok: true } | { ok: false; error: string }

export interface PaneViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PaneBoundsUpdate {
  paneId: string
  rect: PaneViewRect
}

export interface PaneState {
  id: string
  profileId: string
  profileLabel: string
  title: string
  url: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

export interface ShellState {
  panes: PaneState[]
}

export interface PaneMenuRequest {
  paneId: string
  x: number
  y: number
}

export interface PaneFlowApi {
  getState(): Promise<ShellState>
  addPane(url?: string): Promise<ScriptResult>
  closePane(paneId: string): Promise<ScriptResult>
  navigate(paneId: string, address: string): Promise<ScriptResult>
  back(paneId: string): Promise<ScriptResult>
  forward(paneId: string): Promise<ScriptResult>
  reload(paneId: string): Promise<ScriptResult>
  reloadAll(): Promise<ScriptResult>
  setPaneBounds(updates: PaneBoundsUpdate[]): Promise<ScriptResult>
  showPaneMenu(request: PaneMenuRequest): Promise<ScriptResult>
  onStateChanged(listener: (state: ShellState) => void): () => void
  onRequestMeasurement(listener: () => void): () => void
}
