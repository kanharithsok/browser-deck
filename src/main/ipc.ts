import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { CanvasSize } from '../shared/geometry'
import { IPC_CHANNELS, type ShellState, type ScriptResult } from '../shared/ipc'
import type { WorkspaceLayout } from '../shared/workspace'
import type { BrowserManager } from './browser-manager'

interface IpcContext {
  getBrowserManager: () => BrowserManager | null
  getShellWebContents: () => WebContents | null
  getCanvasSize: () => CanvasSize
  getWorkspaceLayout: () => WorkspaceLayout
  saveWorkspaceLayout: (input: unknown) => Promise<ScriptResult>
}

const unauthorized: ScriptResult = { ok: false, error: 'Unauthorized sender.' }
const unavailable: ScriptResult = { ok: false, error: 'Pane manager is not ready.' }

function isTrustedSender(event: IpcMainInvokeEvent, context: IpcContext): boolean {
  const shell = context.getShellWebContents()
  if (!shell || shell.isDestroyed()) {
    return false
  }
  return event.sender === shell && event.senderFrame === shell.mainFrame
}

function readString(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== 'string' || value.length > maxLength) {
    return null
  }
  return value
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function registerIpcHandlers(context: IpcContext): void {
  ipcMain.handle(IPC_CHANNELS.getState, (event): ShellState => {
    const layout = context.getWorkspaceLayout()
    if (!isTrustedSender(event, context)) {
      return { panes: [], layout }
    }
    const manager = context.getBrowserManager()
    return manager ? { ...manager.snapshot(), layout } : { panes: [], layout }
  })

  ipcMain.handle(IPC_CHANNELS.addPane, async (event, payload: unknown): Promise<ScriptResult> => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }

    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }

    if (payload !== undefined && typeof payload !== 'string') {
      return { ok: false, error: 'Invalid address.' }
    }

    try {
      return await manager.addPane(payload)
    } catch {
      return { ok: false, error: 'Could not create the pane.' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.closePane, (event, payload: unknown): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }
    const paneId = readString(payload, 100)
    return paneId ? manager.closePane(paneId) : { ok: false, error: 'Invalid pane ID.' }
  })

  ipcMain.handle(
    IPC_CHANNELS.navigate,
    (event, paneIdInput: unknown, addressInput: unknown): ScriptResult => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const manager = context.getBrowserManager()
      if (!manager) {
        return unavailable
      }
      const paneId = readString(paneIdInput, 100)
      const address = readString(addressInput)
      if (!paneId || address === null) {
        return { ok: false, error: 'Invalid navigation request.' }
      }
      return manager.navigate(paneId, address)
    }
  )

  const registerPaneCommand = (
    channel: string,
    command: (manager: BrowserManager, paneId: string) => ScriptResult
  ): void => {
    ipcMain.handle(channel, (event, payload: unknown): ScriptResult => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const manager = context.getBrowserManager()
      if (!manager) {
        return unavailable
      }
      const paneId = readString(payload, 100)
      return paneId ? command(manager, paneId) : { ok: false, error: 'Invalid pane ID.' }
    })
  }

  registerPaneCommand(IPC_CHANNELS.back, (manager, paneId) => manager.back(paneId))
  registerPaneCommand(IPC_CHANNELS.forward, (manager, paneId) => manager.forward(paneId))
  registerPaneCommand(IPC_CHANNELS.reload, (manager, paneId) => manager.reload(paneId))

  ipcMain.handle(IPC_CHANNELS.reloadAll, (event): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    return context.getBrowserManager()?.reloadAll() ?? unavailable
  })

  ipcMain.handle(IPC_CHANNELS.setPaneBounds, (event, payload: unknown): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }
    return manager.setBounds(payload, context.getCanvasSize())
  })

  ipcMain.handle(
    IPC_CHANNELS.setPaneViewport,
    (event, paneIdInput: unknown, payload: unknown): ScriptResult => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const manager = context.getBrowserManager()
      if (!manager) {
        return unavailable
      }
      const paneId = readString(paneIdInput, 100)
      if (!paneId) {
        return { ok: false, error: 'Invalid pane ID.' }
      }
      return manager.setViewport(paneId, payload)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceLayout,
    async (event, payload: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      try {
        return await context.saveWorkspaceLayout(payload)
      } catch {
        return { ok: false, error: 'Could not save the workspace layout.' }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.bringPaneToFront, (event, payload: unknown): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }
    const paneId = readString(payload, 100)
    return paneId ? manager.bringPaneToFront(paneId) : { ok: false, error: 'Invalid pane ID.' }
  })

  ipcMain.handle(IPC_CHANNELS.sendPaneToBack, (event, payload: unknown): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }
    const paneId = readString(payload, 100)
    return paneId ? manager.sendPaneToBack(paneId) : { ok: false, error: 'Invalid pane ID.' }
  })

  ipcMain.handle(IPC_CHANNELS.showPaneMenu, (event, payload: unknown): ScriptResult => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return { ok: false, error: 'Invalid menu request.' }
    }

    const request = payload as Record<string, unknown>
    const paneId = readString(request.paneId, 100)
    const x = readFiniteNumber(request.x)
    const y = readFiniteNumber(request.y)

    if (!paneId || x === null || y === null) {
      return { ok: false, error: 'Invalid menu request.' }
    }

    return manager.showMenu(paneId, x, y)
  })
}
