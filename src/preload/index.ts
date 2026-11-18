import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type PaneBoundsUpdate,
  type PaneCommand,
  type PaneFlowApi,
  type PaneMenuRequest,
  type ShellState
} from '../shared/ipc'
import type { PaneViewport } from '../shared/viewports'
import type { WorkspaceLayout } from '../shared/workspace'

const api: PaneFlowApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState) as Promise<ShellState>,
  addPane: (url) => ipcRenderer.invoke(IPC_CHANNELS.addPane, url),
  addPaneWithProfile: (profileId: string, url?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.addPaneWithProfile, profileId, url),
  closePane: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.closePane, paneId),
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
  }
}

contextBridge.exposeInMainWorld('paneflow', api)
