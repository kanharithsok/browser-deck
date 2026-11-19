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
  profilePartitionDirectoryName,
  type BrowserProfile,
  type ProfileSummary
} from '../shared/profiles'
import {
  CANVAS_MINIMAP_MARGIN,
  canvasMinimapSize,
  type CanvasMinimapAction,
  type CanvasMinimapState
} from '../shared/minimap'
import {
  buildShellCsp,
  isTrustedMinimapDocumentUrl,
  isTrustedShellDocumentUrl,
  isTrustedZoomDocumentUrl,
  SHELL_ENTRY_URL,
  SHELL_MINIMAP_URL,
  SHELL_ZOOM_URL
} from '../shared/shell'
import {
  CANVAS_ZOOM_BAR_HEIGHT,
  CANVAS_ZOOM_BAR_WIDTH,
  CANVAS_ZOOM_MARGIN,
  type CanvasZoomAction,
  type CanvasZoomState
} from '../shared/zoom'
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  adjacentWorkspaceId,
  defaultWorkspaceLayout,
  type ThemePreference,
  type WindowBounds,
  type WorkspaceCycleDirection,
  type WorkspacePaneDefinition
} from '../shared/workspace'
import {
  MAX_WORKSPACE_TRANSFER_BYTES,
  materializeWorkspaceTransfer,
  parseWorkspaceTransfer,
  serializeWorkspaceTransfer
} from '../shared/workspace-transfer'
import {
  BrowserManager,
  type PaneColorScheme,
  type PaneInitialization
} from './browser-manager'
import { registerIpcHandlers } from './ipc'
import { writeJsonAtomically } from './json-file'
import { ProfileStore } from './profile-store'
import { getProfileSession, hardenSession } from './session-policy'
import { installShellProtocol, registerShellScheme } from './shell-protocol'
import { installTestHook } from './test-hook'
import { WorkspaceStore } from './workspace-store'

let mainWindow: BaseWindow | null = null
let shellView: WebContentsView | null = null
let minimapView: WebContentsView | null = null
let minimapVisible = false
let minimapCollapsed = false
let minimapLoaded = false
let lastCanvasMinimapState: CanvasMinimapState | null = null
let zoomView: WebContentsView | null = null
let zoomVisible = false
let zoomLoaded = false
let canvasHandActive = false
let lastCanvasZoomState: CanvasZoomState | null = null
let browserManager: BrowserManager | null = null
let profileStore: ProfileStore | null = null
let workspaceStore: WorkspaceStore | null = null
let panePersistenceEnabled = false
let lastPersistedPaneKey = ''
let quitFlushed = false
let workspaceSwitching = false
let devServerUrl: URL | null = null
let workspaceMenuRefreshToken = 0

app.setName('PaneFlow')
registerShellScheme()

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
    theme: store?.theme() ?? 'system',
    resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
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
    console.error('Could not persist the workspace devices.', error)
  })
}

function toWorkspacePane(pane: PaneInitialization): WorkspacePaneDefinition {
  if (!pane.id) {
    throw new Error('Initial devices require stable IDs.')
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
    getColorScheme: paneColorScheme,
    onPaneLayerChanged: () => raiseCanvasOverlays(),
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
  if (workspaceSwitching) {
    throw new Error('A workspace switch is already in progress.')
  }

  const previousWorkspaceId = store.activeWorkspaceId()
  workspaceSwitching = true
  panePersistenceEnabled = false
  disableWorkspaceMenuActions()
  let nextManager: BrowserManager | null = null
  try {
    await store.setPanes(current.workspacePanes())
    await store.flush()
    await store.switchWorkspace(workspaceId)

    nextManager = createBrowserManager(window, profiles)
    const initialPanes = await createInitialPanes(profiles, store)
    await nextManager.initialize(initialPanes)

    current.destroyAll()
    browserManager = nextManager
    nextManager.setColorScheme(paneColorScheme())
    lastPersistedPaneKey = JSON.stringify(nextManager.workspacePanes())
    panePersistenceEnabled = true
  } catch (error) {
    nextManager?.destroyAll()
    if (store.activeWorkspaceId() !== previousWorkspaceId) {
      try {
        await store.switchWorkspace(previousWorkspaceId)
      } catch (rollbackError) {
        console.error('Could not restore the previous workspace.', rollbackError)
      }
    }
    panePersistenceEnabled = true
    throw error
  } finally {
    workspaceSwitching = false
    await refreshWorkspaceMenu()
  }
  sendShellState()
}

async function switchWorkspaceByOffset(direction: WorkspaceCycleDirection): Promise<void> {
  const store = workspaceStore
  if (!store || !browserManager || !mainWindow || workspaceSwitching) {
    return
  }
  const workspaces = await store.listWorkspaces()
  const targetId = adjacentWorkspaceId(workspaces, store.activeWorkspaceId(), direction)
  if (targetId) {
    await switchWorkspaceTo(targetId)
  }
}

function cycleWorkspace(direction: WorkspaceCycleDirection): void {
  void switchWorkspaceByOffset(direction).catch((error: unknown) => {
    console.error('Could not switch workspaces from the menu.', error)
  })
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

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return { ok: false, error: 'Could not read the workspace file.' }
  }
  if (!fileStat.isFile()) {
    return { ok: false, error: 'Workspace import must be a JSON file.' }
  }
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
      mode: 'canvas',
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
        .filter((id): id is string => Boolean(id)),
      canvas: Object.fromEntries(
        Object.entries(source.layout.canvas ?? {}).flatMap(([paneId, position]) => {
          const mappedId = idMap.get(paneId)
          return mappedId ? [[mappedId, { ...position }]] : []
        })
      )
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
  const profileSession = getProfileSession(profileId)
  await profileSession.clearStorageData()
  await profileSession.clearCache()
  await profileSession.clearAuthCache()
}

async function removeProfilePartition(profileId: string): Promise<void> {
  const partitionDirectory = join(
    app.getPath('userData'),
    'Partitions',
    profilePartitionDirectoryName(profileId)
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

function applySavedWindowPresentation(window: BaseWindow, store: WorkspaceStore): void {
  if (window.isDestroyed()) {
    return
  }
  const bounds = store.windowBounds()
  if (!bounds || !isWindowBoundsVisible(bounds)) {
    return
  }
  const presentation = store.windowPresentation()
  if (presentation.fullScreen) {
    window.setFullScreen(true)
  } else if (presentation.maximized) {
    window.maximize()
  }
}

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#171716' : '#f5f5f3'
}

function paneColorScheme(): PaneColorScheme {
  if (nativeTheme.themeSource === 'light') {
    return 'light'
  }
  if (nativeTheme.themeSource === 'dark') {
    return 'dark'
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
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
  browserManager?.setColorScheme(paneColorScheme())
  forwardCanvasZoomState()
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

function applyWorkspaceMenuEnabled(enabled: boolean): void {
  const menu = Menu.getApplicationMenu()
  for (const id of ['workspace-previous', 'workspace-next'] as const) {
    const item = menu?.getMenuItemById(id)
    if (item) {
      item.enabled = enabled
    }
  }
}

function disableWorkspaceMenuActions(): void {
  workspaceMenuRefreshToken += 1
  applyWorkspaceMenuEnabled(false)
}

async function refreshWorkspaceMenu(): Promise<void> {
  const token = ++workspaceMenuRefreshToken
  const store = workspaceStore
  let enabled = false
  if (store && browserManager && !workspaceSwitching) {
    try {
      enabled = (await store.listWorkspaces()).length > 1
    } catch (error) {
      console.error('Could not read workspaces for the menu.', error)
    }
  }
  if (token !== workspaceMenuRefreshToken || workspaceSwitching) {
    return
  }
  applyWorkspaceMenuEnabled(enabled)
}

function themeMenuItems(): MenuItemConstructorOptions[] {
  return (['system', 'light', 'dark'] as const).map((theme) => ({
    id: `theme-${theme}`,
    label: theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark',
    type: 'radio',
    checked: nativeTheme.themeSource === theme,
    click: () => applyThemePreference(theme)
  }))
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
    {
      label: 'Workspace',
      submenu: [
        {
          id: 'workspace-manage',
          label: 'Workspaces…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendCommand('open-workspaces')
        },
        { type: 'separator' },
        {
          id: 'workspace-next',
          label: 'Next Workspace',
          accelerator: 'CmdOrCtrl+Shift+]',
          enabled: false,
          click: () => cycleWorkspace('next')
        },
        {
          id: 'workspace-previous',
          label: 'Previous Workspace',
          accelerator: 'CmdOrCtrl+Shift+[',
          enabled: false,
          click: () => cycleWorkspace('previous')
        }
      ]
    },
    {
      label: 'Profiles',
      submenu: [
        {
          id: 'profiles-manage',
          label: 'Manage Profiles…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendCommand('open-profiles')
        }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Device',
      submenu: [
        {
          id: 'pane-add',
          label: 'Add Device',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendCommand('add-pane')
        },
        {
          id: 'pane-duplicate',
          label: 'Duplicate Device',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendCommand('duplicate-pane')
        },
        {
          id: 'pane-close',
          label: 'Close Device',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => sendCommand('close-pane')
        },
        {
          id: 'pane-reload',
          label: 'Reload Device',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => sendCommand('reload-pane')
        },
        {
          id: 'pane-reload-all',
          label: 'Reload All Devices',
          accelerator: 'CmdOrCtrl+Alt+Shift+R',
          click: () => sendCommand('reload-all')
        },
        { type: 'separator' },
        {
          id: 'pane-maximize',
          label: 'Toggle Maximize',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => sendCommand('toggle-maximize')
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
          submenu: themeMenuItems()
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function installShellContentPolicy(csp: string): void {
  const shellSession = session.defaultSession
  shellSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
  hardenSession(shellSession)
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

function syncMinimapBounds(window: BaseWindow, view: WebContentsView): void {
  if (window.isDestroyed() || view.webContents.isDestroyed()) {
    return
  }
  const content = window.getContentBounds()
  const size = canvasMinimapSize(content, minimapCollapsed)
  view.setBounds({
    x: Math.max(0, content.width - size.width - CANVAS_MINIMAP_MARGIN),
    y: Math.max(0, content.height - size.height - CANVAS_MINIMAP_MARGIN),
    width: size.width,
    height: size.height
  })
}

function focusShellAfterMinimapAction(): void {
  if (shellView && !shellView.webContents.isDestroyed()) {
    shellView.webContents.focus()
  }
}

function setCanvasMinimapCollapsed(collapsed: boolean): void {
  minimapCollapsed = collapsed
  if (mainWindow && minimapView && !minimapView.webContents.isDestroyed()) {
    syncMinimapBounds(mainWindow, minimapView)
    if (minimapVisible) {
      raiseMinimapView()
    }
  }
  focusShellAfterMinimapAction()
}

function syncZoomBounds(window: BaseWindow, view: WebContentsView): void {
  if (window.isDestroyed() || view.webContents.isDestroyed()) {
    return
  }
  const content = window.getContentBounds()
  view.setBounds({
    x: Math.max(0, Math.round((content.width - CANVAS_ZOOM_BAR_WIDTH) / 2)),
    y: Math.max(0, content.height - CANVAS_ZOOM_BAR_HEIGHT - CANVAS_ZOOM_MARGIN),
    width: CANVAS_ZOOM_BAR_WIDTH,
    height: CANVAS_ZOOM_BAR_HEIGHT
  })
}

function raiseMinimapView(): void {
  if (
    !minimapVisible ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !minimapView ||
    minimapView.webContents.isDestroyed()
  ) {
    return
  }
  mainWindow.contentView.addChildView(minimapView)
  minimapView.setVisible(true)
}

function raiseZoomView(): void {
  if (
    !zoomVisible ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !zoomView ||
    zoomView.webContents.isDestroyed()
  ) {
    return
  }
  mainWindow.contentView.addChildView(zoomView)
  zoomView.setVisible(true)
}

function raiseCanvasOverlays(): void {
  raiseMinimapView()
  raiseZoomView()
}

// The shell uses one visibility signal for both Canvas overlays so menus and
// dialogs never leave a native bar floating above trusted DOM.
function setCanvasMinimapVisible(visible: boolean): void {
  const wasVisible = minimapVisible || zoomVisible
  minimapVisible = visible
  zoomVisible = visible
  if (!visible) {
    if (minimapView && !minimapView.webContents.isDestroyed()) {
      minimapView.setVisible(false)
    }
    if (zoomView && !zoomView.webContents.isDestroyed()) {
      zoomView.setVisible(false)
    }
    return
  }
  raiseCanvasOverlays()
  if (!wasVisible) {
    forwardCanvasZoomState()
  }
}

function forwardCanvasZoomState(): void {
  const state: CanvasZoomState = {
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    themePreference: workspaceStore?.theme() ?? 'system',
    zoom: browserManager?.canvasZoomValue() ?? 1,
    handMode: canvasHandActive
  }
  lastCanvasZoomState = state
  if (zoomLoaded && zoomView && !zoomView.webContents.isDestroyed()) {
    zoomView.webContents.send(IPC_CHANNELS.canvasZoomState, state)
  }
}

function setCanvasHandModeActive(active: boolean): void {
  if (canvasHandActive === active) {
    return
  }
  canvasHandActive = active
  forwardCanvasZoomState()
}

function forwardCanvasZoomAction(action: CanvasZoomAction): void {
  if (shellView && !shellView.webContents.isDestroyed()) {
    shellView.webContents.send(IPC_CHANNELS.canvasZoomActionRequested, action)
  }
  // Keep focus on the bar for repeated keyboard steps. The shell menu takes
  // focus itself when the percentage button asks it to open.
  if (action.type === 'menu') {
    focusShellAfterMinimapAction()
  }
}

function forwardCanvasMinimapState(state: CanvasMinimapState): void {
  lastCanvasMinimapState = state
  if (
    minimapLoaded &&
    minimapView &&
    !minimapView.webContents.isDestroyed()
  ) {
    minimapView.webContents.send(IPC_CHANNELS.canvasMinimapState, state)
  }
}

function forwardCanvasMinimapAction(action: CanvasMinimapAction): void {
  if (shellView && !shellView.webContents.isDestroyed()) {
    shellView.webContents.send(IPC_CHANNELS.canvasMinimapActionRequested, action)
  }
  focusShellAfterMinimapAction()
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

  await shell.webContents.loadURL(SHELL_ENTRY_URL)
  if (!isTrustedShellDocumentUrl(shell.webContents.getURL(), null)) {
    throw new Error('The built shell loaded an unexpected origin.')
  }
}

async function createWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.focus()
    return
  }

  const devServer = devServerUrl

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
    backgroundColor: windowBackgroundColor(),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {})
  })
  mainWindow = window

  const shell = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
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
  shell.webContents.on('did-start-loading', () => {
    setCanvasMinimapVisible(false)
    setCanvasHandModeActive(false)
  })
  shell.webContents.on('render-process-gone', () => {
    setCanvasMinimapVisible(false)
  })

  const minimap = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })
  minimapView = minimap
  minimap.setBackgroundColor('#00000000')
  minimap.setBorderRadius(10)
  minimap.setVisible(false)
  window.contentView.addChildView(minimap)
  syncMinimapBounds(window, minimap)

  minimap.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  minimap.webContents.on('will-redirect', (event) => {
    if (!isTrustedMinimapDocumentUrl(event.url, devServer?.origin ?? null)) {
      event.preventDefault()
    }
  })
  minimap.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  minimap.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  minimap.webContents.on('did-finish-load', () => {
    if (
      minimap.webContents.isDestroyed() ||
      !isTrustedMinimapDocumentUrl(
        minimap.webContents.getURL(),
        devServer?.origin ?? null
      )
    ) {
      return
    }
    minimapLoaded = true
    if (lastCanvasMinimapState) {
      minimap.webContents.send(IPC_CHANNELS.canvasMinimapState, lastCanvasMinimapState)
    }
    raiseMinimapView()
  })

  const minimapUrl = devServer
    ? new URL('minimap.html', devServer).toString()
    : SHELL_MINIMAP_URL
  void minimap.webContents.loadURL(minimapUrl).catch((error: unknown) => {
    console.error('Could not load the Canvas minimap.', error)
  })

  const zoom = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })
  zoomView = zoom
  zoom.setBackgroundColor('#00000000')
  zoom.setVisible(false)
  window.contentView.addChildView(zoom)
  syncZoomBounds(window, zoom)

  zoom.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  zoom.webContents.on('will-redirect', (event) => {
    if (!isTrustedZoomDocumentUrl(event.url, devServer?.origin ?? null)) {
      event.preventDefault()
    }
  })
  zoom.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  zoom.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  zoom.webContents.on('did-finish-load', () => {
    if (
      zoom.webContents.isDestroyed() ||
      !isTrustedZoomDocumentUrl(zoom.webContents.getURL(), devServer?.origin ?? null)
    ) {
      return
    }
    zoomLoaded = true
    if (lastCanvasZoomState) {
      zoom.webContents.send(IPC_CHANNELS.canvasZoomState, lastCanvasZoomState)
    }
    raiseZoomView()
  })

  const zoomUrl = devServer
    ? new URL('zoom.html', devServer).toString()
    : SHELL_ZOOM_URL
  void zoom.webContents.loadURL(zoomUrl).catch((error: unknown) => {
    console.error('Could not load the Canvas zoom bar.', error)
  })

  const requestMeasurement = (): void => {
    if (!shell.webContents.isDestroyed()) {
      shell.webContents.send(IPC_CHANNELS.requestMeasurement)
    }
  }

  const syncLayout = (): void => {
    syncShellBounds(window, shell)
    if (minimapView && !minimapView.webContents.isDestroyed()) {
      syncMinimapBounds(window, minimapView)
    }
    if (zoomView && !zoomView.webContents.isDestroyed()) {
      syncZoomBounds(window, zoomView)
    }
    raiseCanvasOverlays()
    requestMeasurement()
  }

  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  const saveWindowBounds = (): void => {
    const store = workspaceStore
    if (!store || window.isDestroyed()) {
      return
    }
    void store.setWindowBounds(window.getNormalBounds(), {
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen()
    }).catch((error) => {
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
    disableWorkspaceMenuActions()

    if (minimapView && !minimapView.webContents.isDestroyed()) {
      minimapView.webContents.removeAllListeners()
      minimapView.webContents.close()
    }
    minimapView = null
    minimapVisible = false
    minimapCollapsed = false
    minimapLoaded = false
    lastCanvasMinimapState = null

    if (zoomView && !zoomView.webContents.isDestroyed()) {
      zoomView.webContents.removeAllListeners()
      zoomView.webContents.close()
    }
    zoomView = null
    zoomVisible = false
    zoomLoaded = false
    lastCanvasZoomState = null

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
    },
    minimapState: () =>
      minimapView && !minimapView.webContents.isDestroyed()
        ? {
            visible: minimapView.getVisible(),
            bounds: minimapView.getBounds(),
            loaded: minimapLoaded,
            collapsed: minimapCollapsed
          }
        : null,
    zoomState: () =>
      zoomView && !zoomView.webContents.isDestroyed()
        ? {
            visible: zoomView.getVisible(),
            bounds: zoomView.getBounds(),
            loaded: zoomLoaded
          }
        : null
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
    await refreshWorkspaceMenu()
    window.show()
    applySavedWindowPresentation(window, store)
    applyThemePreference(store.theme(), false)
    requestMeasurement()
  } catch (error) {
    console.error('Failed to initialize the PaneFlow window.', error)
    window.destroy()
  }
}

app.on('web-contents-created', (_event, contents) => {
  // Defense in depth for any future webContents: popups and webview attachment
  // stay denied unless a reviewed feature adds an explicit exception.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})

app.whenReady().then(async () => {
  devServerUrl = getDevServerUrl()
  const shellCsp = buildShellCsp(devServerUrl?.toString() ?? null)

  buildApplicationMenu()
  nativeTheme.on('updated', () => {
    updateWindowBackground()
    refreshThemeMenu()
    browserManager?.setColorScheme(paneColorScheme())
    forwardCanvasZoomState()
    sendShellState()
  })
  installShellContentPolicy(shellCsp)
  installShellProtocol(join(__dirname, '../renderer'), shellCsp)

  registerIpcHandlers({
    getBrowserManager: () => browserManager,
    getShellWebContents: () => shellView?.webContents ?? null,
    getMinimapWebContents: () => minimapView?.webContents ?? null,
    getZoomWebContents: () => zoomView?.webContents ?? null,
    getDevServerUrl: () => devServerUrl?.origin ?? null,
    updateCanvasMinimapState: forwardCanvasMinimapState,
    setCanvasMinimapVisible,
    setCanvasMinimapCollapsed,
    forwardCanvasMinimapAction,
    updateCanvasZoomState: forwardCanvasZoomState,
    forwardCanvasZoomAction,
    setCanvasHandMode: setCanvasHandModeActive,
    getCanvasSize: canvasSize,
    getWorkspaceLayout: () => workspaceStore?.layout() ?? defaultWorkspaceLayout([]),
    getWorkspaceIdentity: () => ({
      id: workspaceStore?.activeWorkspaceId() ?? DEFAULT_WORKSPACE_ID,
      name: workspaceStore?.activeWorkspaceName() ?? DEFAULT_WORKSPACE_NAME
    }),
    getThemePreference: () => workspaceStore?.theme() ?? 'system',
    getResolvedTheme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    setThemePreference: (theme) => applyThemePreference(theme),
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
          error: 'Confirm closing devices using this profile before clearing its data.'
        }
      }
      try {
        if (closePanes) {
          browserManager?.closePanesForProfile(profileId)
        }
        if (profileInUse(profileId)) {
          return { ok: false, error: 'Could not close all devices using this profile.' }
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
          error: 'Confirm closing devices using this profile before deleting it.'
        }
      }
      try {
        if (closePanes) {
          browserManager?.closePanesForProfile(profileId)
        }
        if (profileInUse(profileId)) {
          return { ok: false, error: 'Could not close all devices using this profile.' }
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
    importWorkspace: async () => {
      const result = await importWorkspaceTransfer()
      if (result.ok && !result.canceled) {
        await refreshWorkspaceMenu()
      }
      return result
    },
    createWorkspace: async (name) => {
      if (!workspaceStore) {
        return { ok: false, error: 'Workspace is not ready.' }
      }
      try {
        await workspaceStore.createWorkspace(name)
        await refreshWorkspaceMenu()
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
        await refreshWorkspaceMenu()
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
        await refreshWorkspaceMenu()
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
