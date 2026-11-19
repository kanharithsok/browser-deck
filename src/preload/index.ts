import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type PaneBoundsUpdate,
  type PaneCommand,
  type PaneFlowApi,
  type PaneMenuRequest,
  type ShellState
} from '../shared/ipc'
import type {
  CanvasMinimapAction,
  CanvasMinimapState
} from '../shared/minimap'
import type { PaneViewport } from '../shared/viewports'
import type { CanvasZoomAction, CanvasZoomState } from '../shared/zoom'
import type { WorkspaceLayout } from '../shared/workspace'

const api: PaneFlowApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState) as Promise<ShellState>,
  addPane: (url) => ipcRenderer.invoke(IPC_CHANNELS.addPane, url),
  addPaneWithViewport: (viewport: PaneViewport) =>
    ipcRenderer.invoke(IPC_CHANNELS.addPaneWithViewport, viewport),
  addPaneWithProfile: (profileId: string, url?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.addPaneWithProfile, profileId, url),
  duplicatePane: (paneId: string) => ipcRenderer.invoke(IPC_CHANNELS.duplicatePane, paneId),
  closePane: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.closePane, paneId),
  renamePane: (paneId: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renamePane, paneId, title),
  navigate: (paneId, address) => ipcRenderer.invoke(IPC_CHANNELS.navigate, paneId, address),
  back: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.back, paneId),
  forward: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.forward, paneId),
  reload: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.reload, paneId),
  reloadAll: () => ipcRenderer.invoke(IPC_CHANNELS.reloadAll),
  setPaneBounds: (updates: PaneBoundsUpdate[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPaneBounds, updates),
  setPaneViewport: (paneId: string, viewport: PaneViewport) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPaneViewport, paneId, viewport),
  saveWorkspaceLayout: (layout: WorkspaceLayout) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveWorkspaceLayout, layout),
  listProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.listProfiles),
  renameProfile: (profileId: string, label: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameProfile, profileId, label),
  clearProfile: (profileId: string, closePanes = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.clearProfile, profileId, closePanes),
  deleteProfile: (profileId: string, closePanes = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteProfile, profileId, closePanes),
  listWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.listWorkspaces),
  exportWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportWorkspace, workspaceId),
  importWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.importWorkspace),
  createWorkspace: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, name),
  renameWorkspace: (workspaceId: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameWorkspace, workspaceId, name),
  duplicateWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.duplicateWorkspace, workspaceId),
  switchWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.switchWorkspace, workspaceId),
  deleteWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteWorkspace, workspaceId),
  bringPaneToFront: (paneId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.bringPaneToFront, paneId),
  sendPaneToBack: (paneId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendPaneToBack, paneId),
  showPaneMenu: (request: PaneMenuRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.showPaneMenu, request),
  showThemeMenu: (request) => ipcRenderer.invoke(IPC_CHANNELS.showThemeMenu, request),
  setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.setTheme, theme),
  capturePaneSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.capturePaneSnapshots),
  setCanvasZoom: (zoom: number) => ipcRenderer.invoke(IPC_CHANNELS.setCanvasZoom, zoom),
  updateCanvasMinimap: (state) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateCanvasMinimap, state),
  setCanvasMinimapVisible: (visible: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setCanvasMinimapVisible, visible),
  sendCanvasMinimapAction: (action) =>
    ipcRenderer.invoke(IPC_CHANNELS.canvasMinimapAction, action),
  onCanvasMinimapState: (listener) => {
    const wrapped = (_event: IpcRendererEvent, state: CanvasMinimapState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC_CHANNELS.canvasMinimapState, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.canvasMinimapState, wrapped)
    }
  },
  onCanvasMinimapAction: (listener) => {
    const wrapped = (_event: IpcRendererEvent, action: CanvasMinimapAction): void => {
      listener(action)
    }
    ipcRenderer.on(IPC_CHANNELS.canvasMinimapActionRequested, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.canvasMinimapActionRequested, wrapped)
    }
  },
  sendCanvasZoomAction: (action) =>
    ipcRenderer.invoke(IPC_CHANNELS.canvasZoomAction, action),
  onCanvasZoomState: (listener) => {
    const wrapped = (_event: IpcRendererEvent, state: CanvasZoomState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC_CHANNELS.canvasZoomState, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.canvasZoomState, wrapped)
    }
  },
  onCanvasZoomAction: (listener) => {
    const wrapped = (_event: IpcRendererEvent, action: CanvasZoomAction): void => {
      listener(action)
    }
    ipcRenderer.on(IPC_CHANNELS.canvasZoomActionRequested, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.canvasZoomActionRequested, wrapped)
    }
  },
  onStateChanged: (listener) => {
    const wrapped = (_event: IpcRendererEvent, state: ShellState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC_CHANNELS.stateChanged, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.stateChanged, wrapped)
    }
  },
  onRequestMeasurement: (listener) => {
    const wrapped = (): void => {
      listener()
    }
    ipcRenderer.on(IPC_CHANNELS.requestMeasurement, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.requestMeasurement, wrapped)
    }
  },
  onPaneCommand: (listener) => {
    const wrapped = (_event: IpcRendererEvent, command: PaneCommand): void => {
      listener(command)
    }
    ipcRenderer.on(IPC_CHANNELS.paneCommand, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.paneCommand, wrapped)
    }
  },
  onPaneFocused: (listener) => {
    const wrapped = (_event: IpcRendererEvent, paneId: string): void => {
      listener(paneId)
    }
    ipcRenderer.on(IPC_CHANNELS.paneFocused, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.paneFocused, wrapped)
    }
  },
  onPaneRenameRequested: (listener) => {
    const wrapped = (_event: IpcRendererEvent, paneId: string): void => {
      listener(paneId)
    }
    ipcRenderer.on(IPC_CHANNELS.paneRenameRequested, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.paneRenameRequested, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('paneflow', api)
