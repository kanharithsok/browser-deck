import { randomUUID } from 'node:crypto'
import { join, isAbsolute } from 'node:path'
import {
  app,
  BaseWindow,
  Menu,
  nativeTheme,
  session,
  WebContentsView,
  type MenuItemConstructorOptions
} from 'electron'
import { IPC_CHANNELS, type PaneCommand, type ShellState } from '../shared/ipc'
import { isLoopbackHostname, normalizeAddress } from '../shared/url'
import type { CanvasSize } from '../shared/geometry'
import { RESPONSIVE_VIEWPORT } from '../shared/viewports'
import type { BrowserProfile } from '../shared/profiles'
import {
  defaultWorkspaceLayout,
  type WorkspacePaneDefinition
} from '../shared/workspace'
import { BrowserManager, type PaneInitialization } from './browser-manager'
import { registerIpcHandlers } from './ipc'
import { ProfileStore } from './profile-store'
import { installTestHook } from './test-hook'
import { WorkspaceStore } from './workspace-store'

const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join('; ')

let mainWindow: BaseWindow | null = null
let shellView: WebContentsView | null = null
let browserManager: BrowserManager | null = null
let workspaceStore: WorkspaceStore | null = null
let panePersistenceEnabled = false
let lastPersistedPaneKey = ''
let quitFlushed = false

app.setName('PaneFlow')

const userDataOverride = process.env.PANEFLOW_USER_DATA_DIR
if (userDataOverride) {
  if (!app.isPackaged && isAbsolute(userDataOverride)) {
    app.setPath('userData', userDataOverride)
  } else {
    console.warn('Ignoring PANEFLOW_USER_DATA_DIR: only absolute paths are accepted in development.')
  }
}

function readInitialUrls(): string[] {
  const raw = process.env.PANEFLOW_START_URLS ?? ''
  const candidates = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 2)

  if (candidates.length === 0) {
    return ['about:blank', 'about:blank']
  }

  const urls = candidates.map((candidate) => {
    const normalized = normalizeAddress(candidate)
    return normalized.ok ? normalized.url : 'about:blank'
  })

  return [urls[0] ?? 'about:blank', urls[1] ?? urls[0] ?? 'about:blank']
}

function currentShellState(manager: BrowserManager): ShellState {
  return {
    ...manager.snapshot(),
    layout: workspaceStore?.layout() ?? defaultWorkspaceLayout([])
  }
}

function persistPanes(manager: BrowserManager): void {
  if (!panePersistenceEnabled || !workspaceStore) {
    return
  }
  const panes = manager.workspacePanes()
  const key = JSON.stringify(panes)
  if (key === lastPersistedPaneKey) {
    return
  }
  lastPersistedPaneKey = key
  void workspaceStore.setPanes(panes).catch((error) => {
    console.error('Could not persist the workspace panes.', error)
  })
}

function toWorkspacePane(pane: PaneInitialization): WorkspacePaneDefinition {
  if (!pane.id) {
    throw new Error('Initial panes require stable IDs.')
  }
  return {
    id: pane.id,
    profileId: pane.profile.id,
    url: pane.url,
    viewport: { ...(pane.viewport ?? RESPONSIVE_VIEWPORT) }
  }
}

async function createInitialPanes(
  profileStore: ProfileStore,
  store: WorkspaceStore
): Promise<PaneInitialization[]> {
  if (store.hasStoredWorkspace()) {
    const initial: PaneInitialization[] = []
    for (const pane of store.paneDefinitions()) {
      let profile: BrowserProfile
      try {
        profile = await profileStore.ensure(pane.profileId)
      } catch {
        profile = await profileStore.create()
      }
      initial.push({
        id: pane.id,
        profile,
        url: pane.url,
        viewport: pane.viewport
      })
    }
    return initial
  }

  // First run (or a recovered corrupt workspace): seed two panes from the
  // start URLs and persist their stable IDs before the views are created.
  const urls = readInitialUrls()
  const profiles = profileStore.list()
  const initial: PaneInitialization[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const profile = profiles[index] ?? (await profileStore.create())
    initial.push({
      id: randomUUID(),
      profile,
      url: urls[index] ?? 'about:blank',
      viewport: { ...RESPONSIVE_VIEWPORT }
    })
  }

  try {
    await store.initialize(initial.map(toWorkspacePane))
  } catch (error) {
    console.error('Could not save the initial workspace.', error)
  }
  return initial
}

function buildApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const sendCommand = (command: PaneCommand): void => {
    if (shellView && !shellView.webContents.isDestroyed()) {
      shellView.webContents.send(IPC_CHANNELS.paneCommand, command)
    }
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Pane',
      submenu: [
        {
          id: 'pane-add',
          label: 'Add Pane',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendCommand('add-pane')
        },
        {
          id: 'pane-close',
          label: 'Close Pane',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => sendCommand('close-pane')
        },
        {
          id: 'pane-reload',
          label: 'Reload Pane',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => sendCommand('reload-pane')
        },
        {
          id: 'pane-reload-all',
          label: 'Reload All Panes',
          accelerator: 'CmdOrCtrl+Alt+Shift+R',
          click: () => sendCommand('reload-all')
        },
        { type: 'separator' },
        {
          id: 'pane-maximize',
          label: 'Toggle Maximize',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => sendCommand('toggle-maximize')
        },
        {
          id: 'pane-layout',
          label: 'Toggle Grid / Freeform',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendCommand('toggle-layout')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function installShellContentPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [SHELL_CSP]
      }
    })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function canvasSize(): CanvasSize {
  if (!shellView) {
    return { width: 0, height: 0 }
  }
  const bounds = shellView.getBounds()
  return { width: bounds.width, height: bounds.height }
}

function syncShellBounds(window: BaseWindow, shell: WebContentsView): void {
  if (window.isDestroyed() || shell.webContents.isDestroyed()) {
    return
  }
  const content = window.getContentBounds()
  shell.setBounds({ x: 0, y: 0, width: content.width, height: content.height })
}

function getDevServerUrl(): URL | null {
  const raw = process.env.ELECTRON_RENDERER_URL
  if (!raw || app.isPackaged) {
    return null
  }

  try {
    const parsed = new URL(raw)
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHostname(parsed.hostname)
    ) {
      return parsed
    }
  } catch {
    // Fall through to the warning below.
  }

  console.warn('Ignoring ELECTRON_RENDERER_URL: development shell URLs must be loopback http(s).')
  return null
}

async function loadShell(shell: WebContentsView, devServer: URL | null): Promise<void> {
  if (devServer) {
    await shell.webContents.loadURL(devServer.toString())
    const loaded = new URL(shell.webContents.getURL())
    if (loaded.origin !== devServer.origin) {
      throw new Error('The development shell loaded an unexpected origin.')
    }
    return
  }

  await shell.webContents.loadFile(join(__dirname, '../renderer/index.html'))
}

async function createWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.focus()
    return
  }

  const devServer = getDevServerUrl()
  const window = new BaseWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'PaneFlow',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171716' : '#f5f5f3'
  })
  mainWindow = window

  const shell = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  shellView = shell
  shell.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#171716' : '#f5f5f3')
  window.contentView.addChildView(shell)
  syncShellBounds(window, shell)

  shell.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  shell.webContents.on('will-redirect', (event) => {
    if (!devServer) {
      event.preventDefault()
      return
    }

    try {
      if (new URL(event.url).origin !== devServer.origin) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })
  shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shell.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  const requestMeasurement = (): void => {
    if (!shell.webContents.isDestroyed()) {
      shell.webContents.send(IPC_CHANNELS.requestMeasurement)
    }
  }

  const syncLayout = (): void => {
    syncShellBounds(window, shell)
    requestMeasurement()
  }

  window.on('resize', syncLayout)
  window.on('maximize', syncLayout)
  window.on('unmaximize', syncLayout)
  window.on('enter-full-screen', syncLayout)
  window.on('leave-full-screen', syncLayout)
  window.on('show', requestMeasurement)

  window.on('close', () => {
    void workspaceStore?.flush().catch((error) => {
      console.error('Could not flush the workspace while closing the window.', error)
    })
  })

  window.on('closed', () => {
    browserManager?.destroyAll()
    browserManager = null
    panePersistenceEnabled = false
    lastPersistedPaneKey = ''

    if (!shell.webContents.isDestroyed()) {
      shell.webContents.removeAllListeners()
      shell.webContents.close()
    }

    shellView = null
    mainWindow = null
  })

  const profileStore = new ProfileStore(app.getPath('userData'))
  await profileStore.load()

  const store = new WorkspaceStore(app.getPath('userData'))
  await store.load()
  workspaceStore = store

  const initialPanes = await createInitialPanes(profileStore, store)

  const manager = new BrowserManager(window, profileStore, {
    onStateChanged: () => {
      const current = browserManager
      if (!current) {
        return
      }
      if (!shell.webContents.isDestroyed()) {
        shell.webContents.send(IPC_CHANNELS.stateChanged, currentShellState(current))
      }
      persistPanes(current)
    },
    onPaneFocused: (paneId) => {
      if (!shell.webContents.isDestroyed()) {
        shell.webContents.send(IPC_CHANNELS.paneFocused, paneId)
      }
    }
  })
  browserManager = manager

  installTestHook({
    snapshot: () => currentShellState(manager),
    viewBounds: () => manager.viewBounds(),
    viewStates: () => manager.viewStates(),
    emulationState: (paneId) => manager.emulationState(paneId),
    viewOrder: () => manager.viewOrder(),
    readCookie: (paneId) => manager.readCookie(paneId),
    webContentsId: (paneId) => manager.getWebContentsId(paneId),
    shellWebContentsId: () => (shell.webContents.isDestroyed() ? null : shell.webContents.id),
    contentBounds: () => {
      if (window.isDestroyed()) {
        return null
      }
      const bounds = window.getContentBounds()
      return { x: 0, y: 0, width: bounds.width, height: bounds.height }
    }
  })

  try {
    // Create the restored panes before the shell reads its initial state. The
    // views stay hidden until the shell supplies validated bounds.
    await manager.initialize(initialPanes)
    lastPersistedPaneKey = JSON.stringify(manager.workspacePanes())
    panePersistenceEnabled = true
    await loadShell(shell, devServer)
    syncShellBounds(window, shell)
    window.show()
  } catch (error) {
    console.error('Failed to initialize the PaneFlow window.', error)
    window.destroy()
  }
}

app.whenReady().then(async () => {
  buildApplicationMenu()
  installShellContentPolicy()

  registerIpcHandlers({
    getBrowserManager: () => browserManager,
    getShellWebContents: () => shellView?.webContents ?? null,
    getCanvasSize: canvasSize,
    getWorkspaceLayout: () => workspaceStore?.layout() ?? defaultWorkspaceLayout([]),
    saveWorkspaceLayout: async (input) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      await workspaceStore.setLayout(input)
      return { ok: true }
    }
  })

  await createWindow()

  app.on('activate', () => {
    void createWindow().catch((error: unknown) => {
      console.error('Failed to create a PaneFlow window.', error)
    })
  })
}).catch((error: unknown) => {
  console.error('Failed to start PaneFlow.', error)
  app.quit()
})

app.on('will-quit', (event) => {
  if (quitFlushed || !workspaceStore) {
    return
  }
  event.preventDefault()
  quitFlushed = true
  const store = workspaceStore
  void store
    .flush()
    .catch((error) => {
      console.error('Could not flush the workspace before quitting.', error)
    })
    .finally(() => {
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
