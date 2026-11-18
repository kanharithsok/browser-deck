import { randomUUID } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import {
  app,
  BaseWindow,
  dialog,
  Menu,
  nativeTheme,
  screen,
  session,
  webContents,
  WebContentsView,
  type MenuItemConstructorOptions
} from 'electron'
import {
  IPC_CHANNELS,
  type PaneCommand,
  type ShellState,
  type WorkspaceTransferResult
} from '../shared/ipc'
import { isLoopbackHostname, normalizeAddress } from '../shared/url'
import type { CanvasSize } from '../shared/geometry'
import { RESPONSIVE_VIEWPORT } from '../shared/viewports'
import {
  partitionForProfile,
  type BrowserProfile,
  type ProfileSummary
} from '../shared/profiles'
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  defaultWorkspaceLayout,
  type ThemePreference,
  type WindowBounds,
  type WorkspacePaneDefinition
} from '../shared/workspace'
import {
  MAX_WORKSPACE_TRANSFER_BYTES,
  materializeWorkspaceTransfer,
  parseWorkspaceTransfer,
  serializeWorkspaceTransfer
} from '../shared/workspace-transfer'
import { BrowserManager, type PaneInitialization } from './browser-manager'
import { registerIpcHandlers } from './ipc'
import { writeJsonAtomically } from './json-file'
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
let profileStore: ProfileStore | null = null
let workspaceStore: WorkspaceStore | null = null
let panePersistenceEnabled = false
let lastPersistedPaneKey = ''
let quitFlushed = false
let workspaceSwitching = false

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

function currentShellState(): ShellState {
  const manager = browserManager
  const store = workspaceStore
  return {
    ...(manager?.snapshot() ?? { panes: [] }),
    layout: store?.layout() ?? defaultWorkspaceLayout([]),
    workspace: {
      id: store?.activeWorkspaceId() ?? DEFAULT_WORKSPACE_ID,
      name: store?.activeWorkspaceName() ?? DEFAULT_WORKSPACE_NAME
    },
    theme: store?.theme() ?? 'system'
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
    viewport: { ...(pane.viewport ?? RESPONSIVE_VIEWPORT) },
    ...(pane.customTitle ? { title: pane.customTitle } : {})
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
        viewport: pane.viewport,
        customTitle: pane.title
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

function createBrowserManager(window: BaseWindow, profiles: ProfileStore): BrowserManager {
  return new BrowserManager(window, profiles, {
    onStateChanged: () => {
      if (workspaceSwitching) {
        return
      }
      const shell = shellView
      if (shell && !shell.webContents.isDestroyed()) {
        shell.webContents.send(IPC_CHANNELS.stateChanged, currentShellState())
      }
      if (browserManager) {
        persistPanes(browserManager)
      }
    },
    onPaneFocused: (paneId) => {
      if (shellView && !shellView.webContents.isDestroyed()) {
        shellView.webContents.send(IPC_CHANNELS.paneFocused, paneId)
      }
    },
    onPaneRenameRequested: (paneId) => {
      if (shellView && !shellView.webContents.isDestroyed()) {
        shellView.webContents.send(IPC_CHANNELS.paneRenameRequested, paneId)
      }
    }
  })
}

function sendShellState(): void {
  if (shellView && !shellView.webContents.isDestroyed()) {
    shellView.webContents.send(IPC_CHANNELS.stateChanged, currentShellState())
  }
}

async function switchWorkspaceTo(workspaceId: string): Promise<void> {
  const store = workspaceStore
  const profiles = profileStore
  const current = browserManager
  const window = mainWindow
  if (!store || !profiles || !current || !window) {
    throw new Error('Workspace is not ready.')
  }
  if (workspaceId === store.activeWorkspaceId()) {
    return
  }

  await store.setPanes(current.workspacePanes())
  await store.flush()

  const previousWorkspaceId = store.activeWorkspaceId()
  workspaceSwitching = true
  panePersistenceEnabled = false
  let nextManager: BrowserManager | null = null
  try {
    await store.switchWorkspace(workspaceId)
    nextManager = createBrowserManager(window, profiles)
    const initialPanes = await createInitialPanes(profiles, store)
    await nextManager.initialize(initialPanes)

    current.destroyAll()
    browserManager = nextManager
    lastPersistedPaneKey = JSON.stringify(nextManager.workspacePanes())
    panePersistenceEnabled = true
    sendShellState()
  } catch (error) {
    nextManager?.destroyAll()
    try {
      await store.switchWorkspace(previousWorkspaceId)
    } catch (rollbackError) {
      console.error('Could not restore the previous workspace.', rollbackError)
    }
    panePersistenceEnabled = true
    throw error
  } finally {
    workspaceSwitching = false
  }
}

async function exportWorkspaceTransfer(workspaceId: string): Promise<WorkspaceTransferResult> {
  const store = workspaceStore
  const window = mainWindow
  if (!store || !window) {
    return { ok: false, error: 'Workspace is not ready.' }
  }
  const workspace = await store.getWorkspaceData(workspaceId)
  const transfer = serializeWorkspaceTransfer(workspace)
  const safeName = workspace.name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
  const result = await dialog.showSaveDialog(window, {
    title: 'Export Workspace',
    defaultPath: `${safeName || 'workspace'}.paneflow.json`,
    filters: [{ name: 'PaneFlow Workspace', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) {
    return { ok: true, canceled: true }
  }
  await writeJsonAtomically(result.filePath, transfer)
  return { ok: true }
}

async function importWorkspaceTransfer(): Promise<WorkspaceTransferResult> {
  const store = workspaceStore
  const profiles = profileStore
  const window = mainWindow
  if (!store || !profiles || !window) {
    return { ok: false, error: 'Workspace is not ready.' }
  }
  const result = await dialog.showOpenDialog(window, {
    title: 'Import Workspace',
    filters: [{ name: 'PaneFlow Workspace', extensions: ['json'] }],
    properties: ['openFile']
  })
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) {
    return { ok: true, canceled: true }
  }
  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_WORKSPACE_TRANSFER_BYTES) {
    return { ok: false, error: 'Workspace file is too large.' }
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return { ok: false, error: 'Workspace file is not valid JSON.' }
  }
  const parsed = parseWorkspaceTransfer(parsedJson)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  const paneIds: string[] = []
  const profileIds: string[] = []
  for (let index = 0; index < parsed.transfer.panes.length; index += 1) {
    const profile = await profiles.create()
    paneIds.push(randomUUID())
    profileIds.push(profile.id)
  }
  const existingNames = new Set(
    (await store.listWorkspaces()).map((workspace) => workspace.name.toLowerCase())
  )
  let name = `${parsed.transfer.name} (imported)`
  let suffix = 2
  while (existingNames.has(name.toLowerCase())) {
    name = `${parsed.transfer.name} (imported ${suffix})`
    suffix += 1
  }
  const workspace = materializeWorkspaceTransfer(
    parsed.transfer,
    randomUUID(),
    name,
    paneIds,
    profileIds
  )
  await store.writeWorkspaceData(workspace)
  return { ok: true, workspaceName: name }
}

async function duplicateWorkspace(sourceId: string): Promise<void> {
  const store = workspaceStore
  const profiles = profileStore
  if (!store || !profiles) {
    throw new Error('Workspace is not ready.')
  }

  const source = await store.getWorkspaceData(sourceId)
  const idMap = new Map<string, string>()
  const panes: WorkspacePaneDefinition[] = []
  for (const pane of source.panes) {
    const profile = await profiles.create()
    const paneId = randomUUID()
    idMap.set(pane.id, paneId)
    panes.push({
      id: paneId,
      profileId: profile.id,
      url: pane.url,
      viewport: { ...pane.viewport },
      ...(pane.title ? { title: pane.title } : {})
    })
  }

  const existingNames = new Set(
    (await store.listWorkspaces()).map((workspace) => workspace.name.toLowerCase())
  )
  let name = `${source.name} copy`
  let suffix = 2
  while (existingNames.has(name.toLowerCase())) {
    name = `${source.name} copy ${suffix}`
    suffix += 1
  }

  await store.writeWorkspaceData({
    ...source,
    id: randomUUID(),
    name,
    panes,
    layout: {
      mode: source.layout.mode,
      columns: source.layout.columns,
      gridOrder: source.layout.gridOrder
        .map((paneId) => idMap.get(paneId))
        .filter((id): id is string => Boolean(id)),
      freeform: Object.fromEntries(
        Object.entries(source.layout.freeform).flatMap(([paneId, rect]) => {
          const mappedId = idMap.get(paneId)
          return mappedId ? [[mappedId, { ...rect }]] : []
        })
      ),
      freeformOrder: source.layout.freeformOrder
        .map((paneId) => idMap.get(paneId))
        .filter((id): id is string => Boolean(id))
    },
    updatedAt: new Date().toISOString()
  })
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function profileSummaries(): ProfileSummary[] {
  const store = profileStore
  if (!store) {
    return []
  }
  const usage = browserManager?.profilePaneIds() ?? new Map<string, string[]>()
  return store.list().map((profile) => {
    const paneIds = [...(usage.get(profile.id) ?? [])]
    return {
      id: profile.id,
      label: profile.label,
      createdAt: profile.createdAt,
      paneIds,
      inUse: paneIds.length > 0
    }
  })
}

function profileInUse(profileId: string): boolean {
  return (browserManager?.profilePaneIds().get(profileId)?.length ?? 0) > 0
}

async function clearProfileSession(profileId: string): Promise<void> {
  const profileSession = session.fromPartition(partitionForProfile(profileId))
  await profileSession.clearStorageData()
  await profileSession.clearCache()
  await profileSession.clearAuthCache()
}

async function removeProfilePartition(profileId: string): Promise<void> {
  const partitionDirectory = join(
    app.getPath('userData'),
    'Partitions',
    `paneflow-profile-${profileId}`
  )
  await rm(partitionDirectory, { recursive: true, force: true })
}

function isWindowBoundsVisible(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapWidth =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapWidth >= 120 && overlapHeight >= 80
  })
}

function applySavedWindowBounds(window: BaseWindow, store: WorkspaceStore): void {
  const bounds = store.windowBounds()
  if (bounds && !window.isDestroyed() && isWindowBoundsVisible(bounds)) {
    window.setBounds(bounds)
  }
}

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#171716' : '#f5f5f3'
}

function updateWindowBackground(): void {
  const color = windowBackgroundColor()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color)
  }
  if (shellView && !shellView.webContents.isDestroyed()) {
    shellView.setBackgroundColor(color)
  }
}

function refreshThemeMenu(): void {
  const menu = Menu.getApplicationMenu()
  for (const theme of ['system', 'light', 'dark'] as const) {
    const item = menu?.getMenuItemById(`theme-${theme}`)
    if (item) {
      item.checked = nativeTheme.themeSource === theme
    }
  }
}

function applyThemePreference(theme: ThemePreference, persist = true): void {
  nativeTheme.themeSource = theme
  updateWindowBackground()
  refreshThemeMenu()
  if (persist) {
    const store = workspaceStore
    if (!store) {
      return
    }
    void store
      .setTheme(theme)
      .then(() => sendShellState())
      .catch((error) => {
        console.error('Could not persist the theme preference.', error)
      })
  } else {
    sendShellState()
  }
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
          id: 'pane-duplicate',
          label: 'Duplicate Pane',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendCommand('duplicate-pane')
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
        {
          label: 'Theme',
          submenu: [
            {
              id: 'theme-system',
              label: 'System',
              type: 'radio',
              checked: nativeTheme.themeSource === 'system',
              click: () => applyThemePreference('system')
            },
            {
              id: 'theme-light',
              label: 'Light',
              type: 'radio',
              checked: nativeTheme.themeSource === 'light',
              click: () => applyThemePreference('light')
            },
            {
              id: 'theme-dark',
              label: 'Dark',
              type: 'radio',
              checked: nativeTheme.themeSource === 'dark',
              click: () => applyThemePreference('dark')
            }
          ]
        },
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

  const profiles = new ProfileStore(app.getPath('userData'))
  await profiles.load()
  profileStore = profiles

  const store = new WorkspaceStore(app.getPath('userData'))
  await store.load()
  workspaceStore = store

  // Electron only propagates prefers-color-scheme changes to renderers created
  // after a themeSource transition. Start from system, then apply the saved
  // preference after the shell renderer has loaded.
  nativeTheme.themeSource = 'system'

  const window = new BaseWindow({
    width: 1280,
    height: 860,
    minWidth: MIN_APP_WINDOW_WIDTH,
    minHeight: MIN_APP_WINDOW_HEIGHT,
    show: false,
    title: 'PaneFlow',
    backgroundColor: windowBackgroundColor()
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
  shell.setBackgroundColor(windowBackgroundColor())
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

  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  const saveWindowBounds = (): void => {
    const store = workspaceStore
    if (!store || window.isDestroyed()) {
      return
    }
    void store.setWindowBounds(window.getNormalBounds()).catch((error) => {
      console.error('Could not persist the window bounds.', error)
    })
  }
  const scheduleWindowBoundsSave = (): void => {
    if (boundsSaveTimer !== null) {
      clearTimeout(boundsSaveTimer)
    }
    boundsSaveTimer = setTimeout(() => {
      boundsSaveTimer = null
      saveWindowBounds()
    }, 350)
  }
  const handleWindowLayoutChange = (): void => {
    syncLayout()
    scheduleWindowBoundsSave()
  }

  window.on('resize', handleWindowLayoutChange)
  window.on('move', scheduleWindowBoundsSave)
  window.on('maximize', handleWindowLayoutChange)
  window.on('unmaximize', handleWindowLayoutChange)
  window.on('enter-full-screen', handleWindowLayoutChange)
  window.on('leave-full-screen', handleWindowLayoutChange)
  window.on('show', requestMeasurement)

  window.on('close', () => {
    if (boundsSaveTimer !== null) {
      clearTimeout(boundsSaveTimer)
      boundsSaveTimer = null
    }
    saveWindowBounds()
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

  const initialPanes = await createInitialPanes(profiles, store)

  const manager = createBrowserManager(window, profiles)
  browserManager = manager

  installTestHook({
    snapshot: () => currentShellState(),
    viewBounds: () => browserManager?.viewBounds() ?? [],
    viewStates: () => browserManager?.viewStates() ?? [],
    emulationState: (paneId) => browserManager?.emulationState(paneId) ?? null,
    viewOrder: () => browserManager?.viewOrder() ?? [],
    readCookie: (paneId) => browserManager?.readCookie(paneId) ?? Promise.resolve(null),
    webContentsId: (paneId) => browserManager?.getWebContentsId(paneId) ?? null,
    webContentsCount: () =>
      webContents.getAllWebContents().filter((contents) => !contents.isDestroyed()).length,
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
    applySavedWindowBounds(window, store)
    syncShellBounds(window, shell)
    window.show()
    applyThemePreference(store.theme(), false)
    requestMeasurement()
  } catch (error) {
    console.error('Failed to initialize the PaneFlow window.', error)
    window.destroy()
  }
}

app.whenReady().then(async () => {
  buildApplicationMenu()
  nativeTheme.on('updated', () => {
    updateWindowBackground()
    refreshThemeMenu()
  })
  installShellContentPolicy()

  registerIpcHandlers({
    getBrowserManager: () => browserManager,
    getShellWebContents: () => shellView?.webContents ?? null,
    getCanvasSize: canvasSize,
    getWorkspaceLayout: () => workspaceStore?.layout() ?? defaultWorkspaceLayout([]),
    getWorkspaceIdentity: () => ({
      id: workspaceStore?.activeWorkspaceId() ?? DEFAULT_WORKSPACE_ID,
      name: workspaceStore?.activeWorkspaceName() ?? DEFAULT_WORKSPACE_NAME
    }),
    getThemePreference: () => workspaceStore?.theme() ?? 'system',
    saveWorkspaceLayout: async (input) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      if (workspaceSwitching) {
        return { ok: false, error: 'Workspace is switching.' }
      }
      await workspaceStore.setLayout(input)
      return { ok: true }
    },
    listProfiles: async () => {
      if (!profileStore) {
        return { ok: false, error: 'Profiles are not ready.' }
      }
      return { ok: true, profiles: profileSummaries() }
    },
    renameProfile: async (profileId, label) => {
      if (!profileStore) {
        return { ok: false, error: 'Profiles are not ready.' }
      }
      try {
        await profileStore.rename(profileId, label)
        browserManager?.notifyProfilesChanged()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not rename the profile.') }
      }
    },
    clearProfile: async (profileId, closePanes) => {
      if (!profileStore?.get(profileId)) {
        return { ok: false, error: 'Profile not found.' }
      }
      if (profileInUse(profileId) && !closePanes) {
        return {
          ok: false,
          error: 'Confirm closing panes using this profile before clearing its data.'
        }
      }
      try {
        if (closePanes) {
          browserManager?.closePanesForProfile(profileId)
        }
        if (profileInUse(profileId)) {
          return { ok: false, error: 'Could not close all panes using this profile.' }
        }
        await clearProfileSession(profileId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not clear the profile.') }
      }
    },
    deleteProfile: async (profileId, closePanes) => {
      if (!profileStore?.get(profileId)) {
        return { ok: false, error: 'Profile not found.' }
      }
      if (profileInUse(profileId) && !closePanes) {
        return {
          ok: false,
          error: 'Confirm closing panes using this profile before deleting it.'
        }
      }
      try {
        if (closePanes) {
          browserManager?.closePanesForProfile(profileId)
        }
        if (profileInUse(profileId)) {
          return { ok: false, error: 'Could not close all panes using this profile.' }
        }
        await clearProfileSession(profileId)
        await profileStore.remove(profileId)
        await removeProfilePartition(profileId).catch((error) => {
          console.error('Could not remove the profile partition directory.', error)
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not delete the profile.') }
      }
    },
    listWorkspaces: async () => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      try {
        return { ok: true, workspaces: await workspaceStore.listWorkspaces() }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not read workspaces.') }
      }
    },
    exportWorkspace: (workspaceId) => exportWorkspaceTransfer(workspaceId),
    importWorkspace: () => importWorkspaceTransfer(),
    createWorkspace: async (name) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      try {
        await workspaceStore.createWorkspace(name)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not create the workspace.') }
      }
    },
    renameWorkspace: async (workspaceId, name) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      try {
        const active = workspaceId === workspaceStore.activeWorkspaceId()
        await workspaceStore.renameWorkspace(workspaceId, name)
        if (active) {
          sendShellState()
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not rename the workspace.') }
      }
    },
    duplicateWorkspace: async (workspaceId) => {
      try {
        await duplicateWorkspace(workspaceId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not duplicate the workspace.') }
      }
    },
    switchWorkspace: async (workspaceId) => {
      try {
        await switchWorkspaceTo(workspaceId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not switch workspaces.') }
      }
    },
    deleteWorkspace: async (workspaceId) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      try {
        await workspaceStore.deleteWorkspace(workspaceId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: messageFromError(error, 'Could not delete the workspace.') }
      }
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
