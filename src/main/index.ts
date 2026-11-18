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
import { IPC_CHANNELS } from '../shared/ipc'
import { isLoopbackHostname, normalizeAddress } from '../shared/url'
import type { CanvasSize } from '../shared/geometry'
import { BrowserManager } from './browser-manager'
import { registerIpcHandlers } from './ipc'
import { ProfileStore } from './profile-store'
import { installTestHook } from './test-hook'

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

function buildApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
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

  window.on('closed', () => {
    browserManager?.destroyAll()
    browserManager = null

    if (!shell.webContents.isDestroyed()) {
      shell.webContents.removeAllListeners()
      shell.webContents.close()
    }

    shellView = null
    mainWindow = null
  })

  const profileStore = new ProfileStore(app.getPath('userData'))
  await profileStore.load()

  const manager = new BrowserManager(window, profileStore, {
    onStateChanged: (state) => {
      if (!shell.webContents.isDestroyed()) {
        shell.webContents.send(IPC_CHANNELS.stateChanged, state)
      }
    }
  })
  browserManager = manager

  installTestHook({
    snapshot: () => manager.snapshot(),
    viewBounds: () => manager.viewBounds(),
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
    await loadShell(shell, devServer)
    await manager.initialize(readInitialUrls())
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
    getCanvasSize: canvasSize
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
