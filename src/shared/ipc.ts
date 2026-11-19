import type { PaneChromeStyle } from './pane-chrome'
import type { ProfileSummary } from './profiles'
import type { PaneViewport, ViewportPresetId } from './viewports'
import type {
  ThemePreference,
  WorkspaceLayout,
  WorkspaceSummary
} from './workspace'

export const IPC_CHANNELS = {
  getState: 'paneflow:get-state',
  addPane: 'paneflow:add-pane',
  addPaneWithViewport: 'paneflow:add-pane-with-viewport',
  addPaneWithProfile: 'paneflow:add-pane-with-profile',
  duplicatePane: 'paneflow:duplicate-pane',
  closePane: 'paneflow:close-pane',
  renamePane: 'paneflow:rename-pane',
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
  listWorkspaces: 'paneflow:list-workspaces',
  exportWorkspace: 'paneflow:export-workspace',
  importWorkspace: 'paneflow:import-workspace',
  createWorkspace: 'paneflow:create-workspace',
  renameWorkspace: 'paneflow:rename-workspace',
  duplicateWorkspace: 'paneflow:duplicate-workspace',
  switchWorkspace: 'paneflow:switch-workspace',
  deleteWorkspace: 'paneflow:delete-workspace',
  bringPaneToFront: 'paneflow:bring-pane-to-front',
  sendPaneToBack: 'paneflow:send-pane-to-back',
  showPaneMenu: 'paneflow:show-pane-menu',
  showAddPaneMenu: 'paneflow:show-add-pane-menu',
  showThemeMenu: 'paneflow:show-theme-menu',
  capturePaneSnapshots: 'paneflow:capture-pane-snapshots',
  setCanvasZoom: 'paneflow:set-canvas-zoom',
  paneCommand: 'paneflow:pane-command',
  paneFocused: 'paneflow:pane-focused',
  paneRenameRequested: 'paneflow:pane-rename-requested',
  stateChanged: 'paneflow:state-changed',
  requestMeasurement: 'paneflow:request-measurement'
} as const

export type PaneCommand =
  | 'add-pane'
  | 'duplicate-pane'
  | 'close-pane'
  | 'reload-pane'
  | 'reload-all'
  | 'toggle-maximize'
  | 'toggle-layout'

export type ScriptResult = { ok: true } | { ok: false; error: string }

export type ProfileListResult =
  | { ok: true; profiles: ProfileSummary[] }
  | { ok: false; error: string }

export type WorkspaceListResult =
  | { ok: true; workspaces: WorkspaceSummary[] }
  | { ok: false; error: string }

export type WorkspaceTransferResult =
  | { ok: true; canceled?: boolean; workspaceName?: string }
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
  customTitle: string | null
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

export interface WorkspaceIdentity {
  id: string
  name: string
}

export interface ShellState extends ShellSnapshot {
  layout: WorkspaceLayout
  workspace: WorkspaceIdentity
  theme: ThemePreference
  resolvedTheme: 'light' | 'dark'
}

export interface PaneMenuRequest {
  paneId: string
  x: number
  y: number
}

export interface AddPaneMenuRequest {
  x: number
  y: number
  paneChrome: PaneChromeStyle
  showPaneChromePreview: boolean
}

export type AddPaneMenuResult =
  | { ok: true; preset: ViewportPresetId | null; paneChrome?: PaneChromeStyle }
  | { ok: false; error: string }

export interface ThemeMenuRequest {
  x: number
  y: number
}

export type PaneSnapshotsResult =
  | { ok: true; snapshots: Record<string, string> }
  | { ok: false; error: string }

export interface PaneFlowApi {
  getState(): Promise<ShellState>
  addPane(url?: string): Promise<ScriptResult>
  addPaneWithViewport(viewport: PaneViewport): Promise<ScriptResult>
  addPaneWithProfile(profileId: string, url?: string): Promise<ScriptResult>
  duplicatePane(paneId: string): Promise<ScriptResult>
  closePane(paneId: string): Promise<ScriptResult>
  renamePane(paneId: string, title: string): Promise<ScriptResult>
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
  clearProfile(profileId: string, closePanes?: boolean): Promise<ScriptResult>
  deleteProfile(profileId: string, closePanes?: boolean): Promise<ScriptResult>
  listWorkspaces(): Promise<WorkspaceListResult>
  exportWorkspace(workspaceId: string): Promise<WorkspaceTransferResult>
  importWorkspace(): Promise<WorkspaceTransferResult>
  createWorkspace(name: string): Promise<ScriptResult>
  renameWorkspace(workspaceId: string, name: string): Promise<ScriptResult>
  duplicateWorkspace(workspaceId: string): Promise<ScriptResult>
  switchWorkspace(workspaceId: string): Promise<ScriptResult>
  deleteWorkspace(workspaceId: string): Promise<ScriptResult>
  bringPaneToFront(paneId: string): Promise<ScriptResult>
  sendPaneToBack(paneId: string): Promise<ScriptResult>
  showPaneMenu(request: PaneMenuRequest): Promise<ScriptResult>
  showAddPaneMenu(request: AddPaneMenuRequest): Promise<AddPaneMenuResult>
  showThemeMenu(request: ThemeMenuRequest): Promise<ScriptResult>
  capturePaneSnapshots(): Promise<PaneSnapshotsResult>
  setCanvasZoom(zoom: number): Promise<ScriptResult>
  onStateChanged(listener: (state: ShellState) => void): () => void
  onRequestMeasurement(listener: () => void): () => void
  onPaneCommand(listener: (command: PaneCommand) => void): () => void
  onPaneFocused(listener: (paneId: string) => void): () => void
  onPaneRenameRequested(listener: (paneId: string) => void): () => void
}
