import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type PaneBoundsUpdate,
  type PaneFlowApi,
  type PaneMenuRequest,
  type ShellState
} from '../shared/ipc'

const api: PaneFlowApi = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState) as Promise<ShellState>,
  addPane: (url) => ipcRenderer.invoke(IPC_CHANNELS.addPane, url),
  closePane: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.closePane, paneId),
  navigate: (paneId, address) => ipcRenderer.invoke(IPC_CHANNELS.navigate, paneId, address),
  back: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.back, paneId),
  forward: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.forward, paneId),
  reload: (paneId) => ipcRenderer.invoke(IPC_CHANNELS.reload, paneId),
  reloadAll: () => ipcRenderer.invoke(IPC_CHANNELS.reloadAll),
  setPaneBounds: (updates: PaneBoundsUpdate[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPaneBounds, updates),
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
  }
}

contextBridge.exposeInMainWorld('paneflow', api)
