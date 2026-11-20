import type {
  CanvasMinimapAction,
  CanvasMinimapState
} from './minimap'
import type { PaneViewport } from './viewports'
import type { CanvasZoomAction, CanvasZoomState } from './zoom'
import type {
  ThemePreference,
  WorkspaceLayout,
  WorkspaceSummary
} from './workspace'

export const IPC_CHANNELS = {
  getState: 'paneflow:get-state',
  addPane: 'paneflow:add-pane',
  addPaneWithViewport: 'paneflow:add-pane-with-viewport',
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
  rotatePaneViewport: 'paneflow:rotate-pane-viewport',
  capturePaneScreenshot: 'paneflow:capture-pane-screenshot',
  copyPaneUrl: 'paneflow:copy-pane-url',
  clearPaneSiteData: 'paneflow:clear-pane-site-data',
  openPaneExternal: 'paneflow:open-pane-external',
  openPaneDevTools: 'paneflow:open-pane-devtools',
  saveWorkspaceLayout: 'paneflow:save-workspace-layout',
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
  setTheme: 'paneflow:set-theme',
  capturePaneSnapshots: 'paneflow:capture-pane-snapshots',
  setCanvasZoom: 'paneflow:set-canvas-zoom',
  updateCanvasMinimap: 'paneflow:update-canvas-minimap',
  setCanvasMinimapVisible: 'paneflow:set-canvas-minimap-visible',
  setCanvasOverlayVisibility: 'paneflow:set-canvas-overlay-visibility',
  canvasMinimapState: 'paneflow:canvas-minimap-state',
  canvasMinimapAction: 'paneflow:canvas-minimap-action',
  canvasMinimapActionRequested: 'paneflow:canvas-minimap-action-requested',
  canvasZoomState: 'paneflow:canvas-zoom-state',
  canvasZoomAction: 'paneflow:canvas-zoom-action',
  canvasZoomActionRequested: 'paneflow:canvas-zoom-action-requested',
  setCanvasHandMode: 'paneflow:set-canvas-hand-mode',
  setCanvasSelectMode: 'paneflow:set-canvas-select-mode',
  paneCommand: 'paneflow:pane-command',
  paneFocused: 'paneflow:pane-focused',
  paneNotice: 'paneflow:pane-notice',
  paneRenameRequested: 'paneflow:pane-rename-requested',
  stateChanged: 'paneflow:state-changed',
  requestMeasurement: 'paneflow:request-measurement'
} as const

export type PaneCommand =
  | 'add-pane'
  | 'duplicate-pane'
  | 'close-pane'
  | 'focus-address'
  | 'find-device'
  | 'reload-pane'
  | 'reload-all'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'open-workspaces'

export type ScriptResult = { ok: true } | { ok: false; error: string }

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

export interface PaneNotice {
  paneId: string
  message: string
}

export interface CanvasOverlayVisibility {
  minimap: boolean
  zoom: boolean
}

export type PaneSnapshotsResult =
  | { ok: true; snapshots: Record<string, string> }
  | { ok: false; error: string }

export type PaneScreenshotResult =
  | { ok: true; canceled?: boolean; filePath?: string }
  | { ok: false; error: string }

export interface PaneFlowApi {
  getState(): Promise<ShellState>
  addPane(url?: string): Promise<ScriptResult>
  addPaneWithViewport(viewport: PaneViewport): Promise<ScriptResult>
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
  rotatePaneViewport(paneId: string): Promise<ScriptResult>
  capturePaneScreenshot(paneId: string): Promise<PaneScreenshotResult>
  copyPaneUrl(paneId: string): Promise<ScriptResult>
  clearPaneSiteData(paneId: string): Promise<ScriptResult>
  openPaneExternal(paneId: string): Promise<ScriptResult>
  openPaneDevTools(paneId: string): Promise<ScriptResult>
  saveWorkspaceLayout(layout: WorkspaceLayout): Promise<ScriptResult>
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
  setTheme(theme: ThemePreference): Promise<ScriptResult>
  capturePaneSnapshots(): Promise<PaneSnapshotsResult>
  setCanvasZoom(zoom: number): Promise<ScriptResult>
  updateCanvasMinimap(state: CanvasMinimapState): Promise<ScriptResult>
  setCanvasMinimapVisible(visible: boolean): Promise<ScriptResult>
  setCanvasOverlayVisibility(visibility: CanvasOverlayVisibility): Promise<ScriptResult>
  sendCanvasMinimapAction(action: CanvasMinimapAction): Promise<ScriptResult>
  onCanvasMinimapState(listener: (state: CanvasMinimapState) => void): () => void
  onCanvasMinimapAction(listener: (action: CanvasMinimapAction) => void): () => void
  sendCanvasZoomAction(action: CanvasZoomAction): Promise<ScriptResult>
  onCanvasZoomState(listener: (state: CanvasZoomState) => void): () => void
  onCanvasZoomAction(listener: (action: CanvasZoomAction) => void): () => void
  setCanvasHandMode(active: boolean): Promise<ScriptResult>
  setCanvasSelectMode(active: boolean): Promise<ScriptResult>
  onStateChanged(listener: (state: ShellState) => void): () => void
  onRequestMeasurement(listener: () => void): () => void
  onPaneCommand(listener: (command: PaneCommand) => void): () => void
  onPaneFocused(listener: (paneId: string) => void): () => void
  onPaneNotice(listener: (notice: PaneNotice) => void): () => void
  onPaneRenameRequested(listener: (paneId: string) => void): () => void
}
