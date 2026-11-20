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
  getState: 'browserdeck:get-state',
  addPane: 'browserdeck:add-pane',
  addPaneWithViewport: 'browserdeck:add-pane-with-viewport',
  duplicatePane: 'browserdeck:duplicate-pane',
  closePane: 'browserdeck:close-pane',
  renamePane: 'browserdeck:rename-pane',
  navigate: 'browserdeck:navigate',
  back: 'browserdeck:back',
  forward: 'browserdeck:forward',
  reload: 'browserdeck:reload',
  reloadAll: 'browserdeck:reload-all',
  setPaneBounds: 'browserdeck:set-pane-bounds',
  setPaneViewport: 'browserdeck:set-pane-viewport',
  rotatePaneViewport: 'browserdeck:rotate-pane-viewport',
  capturePaneScreenshot: 'browserdeck:capture-pane-screenshot',
  copyPaneUrl: 'browserdeck:copy-pane-url',
  clearPaneSiteData: 'browserdeck:clear-pane-site-data',
  openPaneExternal: 'browserdeck:open-pane-external',
  openPaneDevTools: 'browserdeck:open-pane-devtools',
  saveWorkspaceLayout: 'browserdeck:save-workspace-layout',
  listWorkspaces: 'browserdeck:list-workspaces',
  exportWorkspace: 'browserdeck:export-workspace',
  importWorkspace: 'browserdeck:import-workspace',
  createWorkspace: 'browserdeck:create-workspace',
  renameWorkspace: 'browserdeck:rename-workspace',
  duplicateWorkspace: 'browserdeck:duplicate-workspace',
  switchWorkspace: 'browserdeck:switch-workspace',
  deleteWorkspace: 'browserdeck:delete-workspace',
  bringPaneToFront: 'browserdeck:bring-pane-to-front',
  sendPaneToBack: 'browserdeck:send-pane-to-back',
  setTheme: 'browserdeck:set-theme',
  capturePaneSnapshots: 'browserdeck:capture-pane-snapshots',
  setCanvasZoom: 'browserdeck:set-canvas-zoom',
  updateCanvasMinimap: 'browserdeck:update-canvas-minimap',
  setCanvasMinimapVisible: 'browserdeck:set-canvas-minimap-visible',
  setCanvasOverlayVisibility: 'browserdeck:set-canvas-overlay-visibility',
  canvasMinimapState: 'browserdeck:canvas-minimap-state',
  canvasMinimapAction: 'browserdeck:canvas-minimap-action',
  canvasMinimapActionRequested: 'browserdeck:canvas-minimap-action-requested',
  canvasZoomState: 'browserdeck:canvas-zoom-state',
  canvasZoomAction: 'browserdeck:canvas-zoom-action',
  canvasZoomActionRequested: 'browserdeck:canvas-zoom-action-requested',
  setCanvasHandMode: 'browserdeck:set-canvas-hand-mode',
  setCanvasSelectMode: 'browserdeck:set-canvas-select-mode',
  paneCommand: 'browserdeck:pane-command',
  paneFocused: 'browserdeck:pane-focused',
  paneNotice: 'browserdeck:pane-notice',
  paneRenameRequested: 'browserdeck:pane-rename-requested',
  stateChanged: 'browserdeck:state-changed',
  requestMeasurement: 'browserdeck:request-measurement'
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

export interface BrowserDeckApi {
  getState(): Promise<ShellState>
  addPane(url?: string): Promise<ScriptResult>
  addPaneWithViewport(viewport: PaneViewport, url?: string): Promise<ScriptResult>
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
