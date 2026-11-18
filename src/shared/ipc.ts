import type { ProfileSummary } from './profiles'
import type { PaneViewport } from './viewports'
import type { WorkspaceLayout } from './workspace'

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
  setPaneViewport: 'paneflow:set-pane-viewport',
  saveWorkspaceLayout: 'paneflow:save-workspace-layout',
  listProfiles: 'paneflow:list-profiles',
  renameProfile: 'paneflow:rename-profile',
  clearProfile: 'paneflow:clear-profile',
  deleteProfile: 'paneflow:delete-profile',
  bringPaneToFront: 'paneflow:bring-pane-to-front',
  sendPaneToBack: 'paneflow:send-pane-to-back',
  showPaneMenu: 'paneflow:show-pane-menu',
  paneCommand: 'paneflow:pane-command',
  paneFocused: 'paneflow:pane-focused',
  stateChanged: 'paneflow:state-changed',
  requestMeasurement: 'paneflow:request-measurement'
} as const

export type PaneCommand =
  | 'add-pane'
  | 'close-pane'
  | 'reload-pane'
  | 'reload-all'
  | 'toggle-maximize'
  | 'toggle-layout'

export type ScriptResult = { ok: true } | { ok: false; error: string }

export type ProfileListResult =
  | { ok: true; profiles: ProfileSummary[] }
  | { ok: false; error: string }

export interface PaneViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PaneBoundsUpdate {
  paneId: string
  rect: PaneViewRect
  visible: boolean
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
  viewport: PaneViewport
}

export interface ShellSnapshot {
  panes: PaneState[]
}

export interface ShellState extends ShellSnapshot {
  layout: WorkspaceLayout
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
  setPaneViewport(paneId: string, viewport: PaneViewport): Promise<ScriptResult>
  saveWorkspaceLayout(layout: WorkspaceLayout): Promise<ScriptResult>
  listProfiles(): Promise<ProfileListResult>
  renameProfile(profileId: string, label: string): Promise<ScriptResult>
  clearProfile(profileId: string): Promise<ScriptResult>
  deleteProfile(profileId: string): Promise<ScriptResult>
  bringPaneToFront(paneId: string): Promise<ScriptResult>
  sendPaneToBack(paneId: string): Promise<ScriptResult>
  showPaneMenu(request: PaneMenuRequest): Promise<ScriptResult>
  onStateChanged(listener: (state: ShellState) => void): () => void
  onRequestMeasurement(listener: () => void): () => void
  onPaneCommand(listener: (command: PaneCommand) => void): () => void
  onPaneFocused(listener: (paneId: string) => void): () => void
}
