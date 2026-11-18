import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { CanvasSize } from '../shared/geometry'
import {
  IPC_CHANNELS,
  type ProfileListResult,
  type ShellState,
  type ScriptResult,
  type WorkspaceIdentity,
  type WorkspaceListResult,
  type WorkspaceTransferResult
} from '../shared/ipc'
import { isTrustedShellDocumentUrl } from '../shared/shell'
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  defaultWorkspaceLayout,
  type ThemePreference,
  type WorkspaceLayout
} from '../shared/workspace'
import type { BrowserManager } from './browser-manager'

interface IpcContext {
  getBrowserManager: () => BrowserManager | null
  getShellWebContents: () => WebContents | null
  getDevServerUrl: () => string | null
  getCanvasSize: () => CanvasSize
  getWorkspaceLayout: () => WorkspaceLayout
  getWorkspaceIdentity: () => WorkspaceIdentity
  getThemePreference: () => ThemePreference
  saveWorkspaceLayout: (input: unknown) => Promise<ScriptResult>
  listProfiles: () => Promise<ProfileListResult>
  renameProfile: (profileId: string, label: string) => Promise<ScriptResult>
  clearProfile: (profileId: string, closePanes: boolean) => Promise<ScriptResult>
  deleteProfile: (profileId: string, closePanes: boolean) => Promise<ScriptResult>
  listWorkspaces: () => Promise<WorkspaceListResult>
  exportWorkspace: (workspaceId: string) => Promise<WorkspaceTransferResult>
  importWorkspace: () => Promise<WorkspaceTransferResult>
  createWorkspace: (name: string) => Promise<ScriptResult>
  renameWorkspace: (workspaceId: string, name: string) => Promise<ScriptResult>
  duplicateWorkspace: (workspaceId: string) => Promise<ScriptResult>
  switchWorkspace: (workspaceId: string) => Promise<ScriptResult>
  deleteWorkspace: (workspaceId: string) => Promise<ScriptResult>
}

const unauthorized: ScriptResult = { ok: false, error: 'Unauthorized sender.' }
const unavailable: ScriptResult = { ok: false, error: 'Pane manager is not ready.' }

function isTrustedSender(event: IpcMainInvokeEvent, context: IpcContext): boolean {
  const shell = context.getShellWebContents()
  if (!shell || shell.isDestroyed() || event.sender !== shell) {
    return false
  }
  const frame = event.senderFrame
  if (!frame || frame !== shell.mainFrame) {
    return false
  }
  return isTrustedShellDocumentUrl(frame.url, context.getDevServerUrl())
}

function emptyShellState(): ShellState {
  return {
    panes: [],
    layout: defaultWorkspaceLayout([]),
    workspace: { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME },
    theme: 'system'
  }
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
    if (!isTrustedSender(event, context)) {
      return emptyShellState()
    }
    const layout = context.getWorkspaceLayout()
    const workspace = context.getWorkspaceIdentity()
    const theme = context.getThemePreference()
    const manager = context.getBrowserManager()
    return manager
      ? { ...manager.snapshot(), layout, workspace, theme }
      : { panes: [], layout, workspace, theme }
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

  ipcMain.handle(
    IPC_CHANNELS.addPaneWithProfile,
    async (event, profileIdInput: unknown, urlInput: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const manager = context.getBrowserManager()
      if (!manager) {
        return unavailable
      }
      const profileId = readString(profileIdInput, 100)
      if (!profileId) {
        return { ok: false, error: 'Invalid profile ID.' }
      }
      if (urlInput !== undefined && typeof urlInput !== 'string') {
        return { ok: false, error: 'Invalid address.' }
      }
      try {
        return await manager.addPaneWithProfile(profileId, urlInput)
      } catch {
        return { ok: false, error: 'Could not create the pane.' }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.duplicatePane, async (event, payload: unknown): Promise<ScriptResult> => {
    if (!isTrustedSender(event, context)) {
      return unauthorized
    }
    const manager = context.getBrowserManager()
    if (!manager) {
      return unavailable
    }
    const paneId = readString(payload, 100)
    if (!paneId) {
      return { ok: false, error: 'Invalid pane ID.' }
    }
    try {
      return await manager.duplicatePane(paneId)
    } catch {
      return { ok: false, error: 'Could not duplicate the pane.' }
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

  ipcMain.handle(IPC_CHANNELS.listProfiles, async (event): Promise<ProfileListResult> => {
    if (!isTrustedSender(event, context)) {
      return { ok: false, error: 'Unauthorized sender.' }
    }
    return context.listProfiles()
  })

  ipcMain.handle(
    IPC_CHANNELS.renameProfile,
    async (event, profileIdInput: unknown, labelInput: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const profileId = readString(profileIdInput, 100)
      const label = readString(labelInput, 200)
      if (!profileId || label === null) {
        return { ok: false, error: 'Invalid profile name.' }
      }
      return context.renameProfile(profileId, label)
    }
  )

  const registerProfileAction = (
    channel: string,
    action: (profileId: string, closePanes: boolean) => Promise<ScriptResult>
  ): void => {
    ipcMain.handle(
      channel,
      async (event, payload: unknown, closePanesInput: unknown): Promise<ScriptResult> => {
        if (!isTrustedSender(event, context)) {
          return unauthorized
        }
        const profileId = readString(payload, 100)
        if (!profileId) {
          return { ok: false, error: 'Invalid profile ID.' }
        }
        if (closePanesInput !== undefined && typeof closePanesInput !== 'boolean') {
          return { ok: false, error: 'Invalid close-panes option.' }
        }
        return action(profileId, closePanesInput === true)
      }
    )
  }

  registerProfileAction(IPC_CHANNELS.clearProfile, context.clearProfile)
  registerProfileAction(IPC_CHANNELS.deleteProfile, context.deleteProfile)

  ipcMain.handle(IPC_CHANNELS.listWorkspaces, async (event): Promise<WorkspaceListResult> => {
    if (!isTrustedSender(event, context)) {
      return { ok: false, error: 'Unauthorized sender.' }
    }
    return context.listWorkspaces()
  })

  ipcMain.handle(
    IPC_CHANNELS.exportWorkspace,
    async (event, payload: unknown): Promise<WorkspaceTransferResult> => {
      if (!isTrustedSender(event, context)) {
        return { ok: false, error: 'Unauthorized sender.' }
      }
      const workspaceId = readString(payload, 100)
      if (!workspaceId) {
        return { ok: false, error: 'Invalid workspace ID.' }
      }
      try {
        return await context.exportWorkspace(workspaceId)
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not export the workspace.'
        }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.importWorkspace, async (event): Promise<WorkspaceTransferResult> => {
    if (!isTrustedSender(event, context)) {
      return { ok: false, error: 'Unauthorized sender.' }
    }
    try {
      return await context.importWorkspace()
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not import the workspace.'
      }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    async (event, nameInput: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const name = readString(nameInput, 200)
      return name === null
        ? { ok: false, error: 'Invalid workspace name.' }
        : context.createWorkspace(name)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.renameWorkspace,
    async (event, workspaceIdInput: unknown, nameInput: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const workspaceId = readString(workspaceIdInput, 100)
      const name = readString(nameInput, 200)
      if (!workspaceId || name === null) {
        return { ok: false, error: 'Invalid workspace name.' }
      }
      return context.renameWorkspace(workspaceId, name)
    }
  )

  const registerWorkspaceAction = (
    channel: string,
    action: (workspaceId: string) => Promise<ScriptResult>
  ): void => {
    ipcMain.handle(channel, async (event, payload: unknown): Promise<ScriptResult> => {
      if (!isTrustedSender(event, context)) {
        return unauthorized
      }
      const workspaceId = readString(payload, 100)
      if (!workspaceId) {
        return { ok: false, error: 'Invalid workspace ID.' }
      }
      return action(workspaceId)
    })
  }

  registerWorkspaceAction(IPC_CHANNELS.duplicateWorkspace, context.duplicateWorkspace)
  registerWorkspaceAction(IPC_CHANNELS.switchWorkspace, context.switchWorkspace)
  registerWorkspaceAction(IPC_CHANNELS.deleteWorkspace, context.deleteWorkspace)

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
