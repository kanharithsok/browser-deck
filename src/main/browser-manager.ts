import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  app,
  clipboard,
  dialog,
  Menu,
  WebContentsView,
  type BaseWindow,
  type WebContents
} from 'electron'
import {
  CANVAS_RESPONSIVE_HEIGHT,
  CANVAS_RESPONSIVE_WIDTH
} from '../shared/canvas'
import { parsePaneBounds, type CanvasSize } from '../shared/geometry'
import type {
  PaneNotice,
  PaneScreenshotResult,
  PaneState,
  PaneViewRect,
  ScriptResult,
  ShellSnapshot
} from '../shared/ipc'
import { partitionForProfile, type BrowserProfile } from '../shared/profiles'
import { screenshotFileName } from '../shared/screenshot'
import { MAX_URL_LENGTH, isAllowedNavigationUrl, normalizeAddress } from '../shared/url'
import {
  RESPONSIVE_VIEWPORT,
  parsePaneViewport,
  toggleViewportRotation,
  viewportContentSize,
  viewportDisplayScale,
  type PaneViewport
} from '../shared/viewports'
import {
  isValidPaneId,
  parsePaneTitle,
  type WorkspacePaneDefinition
} from '../shared/workspace'
import type { ProfileStore } from './profile-store'
import { getProfileSession } from './session-policy'

export type PaneColorScheme = 'light' | 'dark'

interface PaneRecord {
  id: string
  profile: BrowserProfile
  view: WebContentsView
  title: string
  customTitle: string | null
  url: string
  pendingUrl: string | null
  isLoading: boolean
  error: string | null
  hasBounds: boolean
  shellVisible: boolean
  viewport: PaneViewport
  lastEmulationSignature: string
  emulationEnabled: boolean
  appliedScale: number
  pageReady: boolean
  lastColorScheme: PaneColorScheme | null
  colorSchemeErrorLogged: boolean
  destroyed: boolean
}

interface BrowserManagerOptions {
  onStateChanged: (state: ShellSnapshot) => void
  onPaneFocused?: (paneId: string) => void
  onPaneMaximizeRequested?: (paneId: string) => void
  onPaneNotice?: (notice: PaneNotice) => void
  onPaneRenameRequested?: (paneId: string) => void
  onPaneLayerChanged?: () => void
  getColorScheme: () => PaneColorScheme
}

export interface PaneInitialization {
  id?: string
  profile: BrowserProfile
  url: string
  viewport?: PaneViewport
  customTitle?: string | null
}

function fallbackTitle(url: string): string {
  if (url === 'about:blank' || !url) {
    return 'New device'
  }
  try {
    return new URL(url).hostname || 'New device'
  } catch {
    return 'New device'
  }
}

function isAbortError(errorCode: number): boolean {
  // ERR_ABORTED is emitted when a navigation is superseded by another one.
  return errorCode === -3
}

/**
 * Owns the native browser panes and their WebContents. The trusted shell only
 * receives narrow, validated operations; remote pages never receive this API.
 */
export class BrowserManager {
  private readonly panes = new Map<string, PaneRecord>()
  private destroyed = false
  private canvasZoom = 1

  constructor(
    private readonly window: BaseWindow,
    private readonly profileStore: ProfileStore,
    private readonly options: BrowserManagerOptions
  ) {}

  async initialize(panes: PaneInitialization[]): Promise<void> {
    for (const pane of panes) {
      if (pane.id !== undefined && !isValidPaneId(pane.id)) {
        throw new Error('Invalid device ID in workspace.')
      }
      const normalized = normalizeAddress(pane.url)
      this.createPane(pane.profile, normalized.ok ? normalized.url : 'about:blank', {
        id: pane.id,
        viewport: pane.viewport,
        customTitle: pane.customTitle
      })
    }
  }

  async addPane(address?: string): Promise<ScriptResult> {
    const profile = await this.profileStore.create()
    return this.addPaneForProfile(profile, address)
  }

  async addPaneWithViewport(input: unknown): Promise<ScriptResult> {
    const parsed = parsePaneViewport(input)
    if (!parsed.ok) {
      return { ok: false, error: parsed.error }
    }
    const profile = await this.profileStore.create()
    return this.addPaneForProfile(profile, undefined, parsed.viewport)
  }

  async addPaneWithProfile(profileId: string, address?: string): Promise<ScriptResult> {
    const profile = this.profileStore.get(profileId)
    if (!profile) {
      return { ok: false, error: 'Profile not found.' }
    }
    return this.addPaneForProfile(profile, address)
  }

  async duplicatePane(paneId: string): Promise<ScriptResult> {
    const source = this.requirePane(paneId)
    if (!source) {
      return { ok: false, error: 'Device not found.' }
    }
    const profile = await this.profileStore.create()
    if (this.destroyed || this.window.isDestroyed()) {
      return { ok: false, error: 'PaneFlow window is not available.' }
    }
    this.createPane(profile, source.url, {
      viewport: { ...source.viewport },
      customTitle: source.customTitle
    })
    return { ok: true }
  }

  renamePane(paneId: string, title: unknown): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    const parsed = parsePaneTitle(title)
    if (!parsed.ok) {
      return { ok: false, error: parsed.error }
    }

    // Pressing Enter on the prefilled page title should not pin it as a custom
    // name; only an actual edit changes the pane title state.
    if (record.customTitle === null && parsed.title === record.title) {
      return { ok: true }
    }

    if (record.customTitle !== parsed.title) {
      record.customTitle = parsed.title
      this.emitState()
    }
    return { ok: true }
  }

  private addPaneForProfile(
    profile: BrowserProfile,
    address?: string,
    viewport?: PaneViewport
  ): ScriptResult {
    let url = 'about:blank'
    if (address !== undefined && address.trim() !== '') {
      if (address.length > MAX_URL_LENGTH) {
        return { ok: false, error: 'Address is too long.' }
      }
      const normalized = normalizeAddress(address)
      if (!normalized.ok) {
        return { ok: false, error: normalized.error }
      }
      url = normalized.url
    }

    if (this.destroyed || this.window.isDestroyed()) {
      return { ok: false, error: 'PaneFlow window is not available.' }
    }

    this.createPane(profile, url, viewport === undefined ? {} : { viewport })
    return { ok: true }
  }

  closePane(paneId: string): ScriptResult {
    const record = this.panes.get(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }
    this.destroyPane(record)
    return { ok: true }
  }

  closePanesForProfile(profileId: string): string[] {
    const targets = [...this.panes.values()].filter(
      (record) => record.profile.id === profileId && this.liveWebContents(record)
    )
    for (const record of targets) {
      this.destroyPane(record, false)
    }
    if (targets.length > 0) {
      this.emitState()
    }
    return targets.map((record) => record.id)
  }

  navigate(paneId: string, address: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    if (address.length > MAX_URL_LENGTH) {
      return { ok: false, error: 'Address is too long.' }
    }

    const normalized = normalizeAddress(address)
    if (!normalized.ok) {
      return { ok: false, error: normalized.error }
    }

    this.load(record, normalized.url)
    return { ok: true }
  }

  back(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    const history = record.view.webContents.navigationHistory
    if (!history.canGoBack()) {
      return { ok: false, error: 'No previous page.' }
    }
    history.goBack()
    return { ok: true }
  }

  forward(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    const history = record.view.webContents.navigationHistory
    if (!history.canGoForward()) {
      return { ok: false, error: 'No next page.' }
    }
    history.goForward()
    return { ok: true }
  }

  reload(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    if (record.pendingUrl) {
      this.load(record, record.pendingUrl)
      return { ok: true }
    }

    this.prepareForNavigation(record)
    record.view.webContents.reload()
    this.emitState()
    return { ok: true }
  }

  reloadAll(): ScriptResult {
    for (const record of this.panes.values()) {
      if (record.destroyed || record.view.webContents.isDestroyed()) {
        continue
      }

      if (record.pendingUrl) {
        this.load(record, record.pendingUrl)
      } else {
        this.prepareForNavigation(record)
        record.view.webContents.reload()
      }
    }
    this.emitState()
    return { ok: true }
  }

  bringPaneToFront(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }
    if (this.window.isDestroyed()) {
      return { ok: false, error: 'Window is not available.' }
    }

    // Re-adding an existing child moves it to the top of the native stack.
    this.window.contentView.addChildView(record.view)
    this.options.onPaneLayerChanged?.()
    return { ok: true }
  }

  sendPaneToBack(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }
    if (this.window.isDestroyed()) {
      return { ok: false, error: 'Window is not available.' }
    }

    // Index 0 is the trusted shell; pane views start above it.
    this.window.contentView.addChildView(record.view, 1)
    return { ok: true }
  }

  viewOrder(): string[] {
    if (this.window.isDestroyed()) {
      return []
    }

    const order: string[] = []
    for (const child of this.window.contentView.children) {
      for (const record of this.panes.values()) {
        if (!record.destroyed && record.view === child) {
          order.push(record.id)
          break
        }
      }
    }
    return order
  }

  setBounds(input: unknown, canvas: CanvasSize): ScriptResult {
    const parsed = parsePaneBounds(input, new Set(this.panes.keys()), canvas)
    if (!parsed.ok) {
      return { ok: false, error: parsed.error }
    }

    for (const update of parsed.updates) {
      const record = this.panes.get(update.paneId)
      if (!record || record.destroyed || record.view.webContents.isDestroyed()) {
        continue
      }
      record.shellVisible = update.visible
      if (update.visible) {
        record.view.setBounds(update.rect)
      }
      const firstBounds = !record.hasBounds && update.visible
      record.hasBounds = record.hasBounds || update.visible
      this.syncVisibility(record)
      this.applyEmulation(record)

      if (firstBounds && record.pendingUrl) {
        this.load(record, record.pendingUrl)
      }
    }

    return { ok: true }
  }

  setColorScheme(scheme: PaneColorScheme): void {
    for (const record of this.panes.values()) {
      record.lastColorScheme = null
      this.applyColorScheme(record, scheme)
    }
  }

  canvasZoomValue(): number {
    return this.canvasZoom
  }

  setCanvasZoom(zoom: number): void {
    if (this.canvasZoom === zoom) {
      return
    }
    this.canvasZoom = zoom
    for (const record of this.panes.values()) {
      record.lastEmulationSignature = ''
      this.applyEmulation(record)
    }
  }

  setViewport(paneId: string, input: unknown): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    const parsed = parsePaneViewport(input)
    if (!parsed.ok) {
      return { ok: false, error: parsed.error }
    }

    record.viewport = parsed.viewport
    record.lastEmulationSignature = ''
    this.applyEmulation(record)
    this.emitState()
    return { ok: true }
  }

  rotateViewport(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    const next = toggleViewportRotation(record.viewport)
    if (!next) {
      return { ok: false, error: 'Responsive devices do not have a fixed orientation.' }
    }

    record.viewport = next
    record.lastEmulationSignature = ''
    this.applyEmulation(record)
    this.emitState()
    return { ok: true }
  }

  async captureScreenshot(paneId: string): Promise<PaneScreenshotResult> {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }
    if (record.url === 'about:blank') {
      return { ok: false, error: 'There is no page to capture yet.' }
    }

    try {
      const image = await record.view.webContents.capturePage()
      if (image.isEmpty()) {
        return { ok: false, error: 'The page did not produce a screenshot.' }
      }

      const defaultPath = path.join(
        app.getPath('pictures'),
        screenshotFileName(record.url, new Date())
      )
      const result = await dialog.showSaveDialog(this.window, {
        title: 'Save device screenshot',
        buttonLabel: 'Save',
        defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
      if (result.canceled || !result.filePath) {
        return { ok: true, canceled: true }
      }

      const filePath = result.filePath.toLowerCase().endsWith('.png')
        ? result.filePath
        : `${result.filePath}.png`
      await writeFile(filePath, image.toPNG())
      return { ok: true, filePath }
    } catch {
      return { ok: false, error: 'Could not save the screenshot.' }
    }
  }

  showMenu(paneId: string, x: number, y: number, maximized: boolean): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Device not found.' }
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'Invalid menu position.' }
    }

    if (this.window.isDestroyed()) {
      return { ok: false, error: 'Window is not available.' }
    }

    const history = record.view.webContents.navigationHistory
    const menu = Menu.buildFromTemplate([
      {
        label: 'Back',
        enabled: history.canGoBack(),
        click: () => {
          this.back(record.id)
        }
      },
      {
        label: 'Forward',
        enabled: history.canGoForward(),
        click: () => {
          this.forward(record.id)
        }
      },
      {
        label: 'Reload',
        click: () => {
          this.reload(record.id)
        }
      },
      {
        label: 'Copy URL',
        enabled: record.url !== 'about:blank',
        click: () => {
          clipboard.writeText(record.url)
        }
      },
      { type: 'separator' },
      {
        label: 'Rotate Viewport',
        enabled: record.viewport.preset !== 'responsive',
        click: () => {
          this.rotateViewport(record.id)
        }
      },
      {
        label: 'Capture Screenshot…',
        enabled: record.url !== 'about:blank',
        click: () => {
          void this.captureScreenshot(record.id).then((result) => {
            if (!result.ok) {
              dialog.showErrorBox('Screenshot failed', result.error)
            }
          })
        }
      },
      { type: 'separator' },
      {
        label: maximized ? 'Restore Device' : 'Maximize Device',
        click: () => {
          this.options.onPaneMaximizeRequested?.(record.id)
        }
      },
      {
        label: 'Duplicate Device',
        click: () => {
          void this.duplicatePane(record.id)
        }
      },
      {
        label: 'Rename Device…',
        click: () => {
          this.options.onPaneRenameRequested?.(record.id)
        }
      },
      { type: 'separator' },
      {
        label: 'Open DevTools',
        click: () => {
          if (!record.view.webContents.isDestroyed()) {
            record.view.webContents.openDevTools({ mode: 'detach' })
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Close Device',
        click: () => {
          this.closePane(record.id)
        }
      }
    ])

    menu.popup({
      window: this.window,
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y))
    })
    return { ok: true }
  }

  snapshot(): ShellSnapshot {
    const panes: PaneState[] = []
    for (const record of this.panes.values()) {
      const webContents = this.liveWebContents(record)
      if (!webContents) {
        continue
      }

      const canGoBack = webContents.navigationHistory.canGoBack()
      const canGoForward = webContents.navigationHistory.canGoForward()

      panes.push({
        id: record.id,
        profileId: record.profile.id,
        profileLabel: record.profile.label,
        title: record.customTitle ?? (record.title || fallbackTitle(record.url)),
        customTitle: record.customTitle,
        url: record.url,
        isLoading: record.isLoading,
        canGoBack,
        canGoForward,
        error: record.error,
        viewport: { ...record.viewport }
      })
    }

    return { panes }
  }

  profilePaneIds(): Map<string, string[]> {
    const usage = new Map<string, string[]>()
    for (const record of this.panes.values()) {
      if (!this.liveWebContents(record)) {
        continue
      }
      const paneIds = usage.get(record.profile.id) ?? []
      paneIds.push(record.id)
      usage.set(record.profile.id, paneIds)
    }
    return usage
  }

  notifyProfilesChanged(): void {
    this.emitState()
  }

  workspacePanes(): WorkspacePaneDefinition[] {
    const panes: WorkspacePaneDefinition[] = []
    for (const record of this.panes.values()) {
      if (!this.liveWebContents(record)) {
        continue
      }
      panes.push({
        id: record.id,
        profileId: record.profile.id,
        url: record.url,
        viewport: { ...record.viewport },
        ...(record.customTitle ? { title: record.customTitle } : {})
      })
    }
    return panes
  }

  viewBounds(): Array<{ paneId: string; rect: PaneViewRect }> {
    const bounds: Array<{ paneId: string; rect: PaneViewRect }> = []
    for (const record of this.panes.values()) {
      if (this.liveWebContents(record)) {
        bounds.push({ paneId: record.id, rect: record.view.getBounds() })
      }
    }
    return bounds
  }

  viewStates(): Array<{ paneId: string; rect: PaneViewRect; visible: boolean }> {
    const states: Array<{ paneId: string; rect: PaneViewRect; visible: boolean }> = []
    for (const record of this.panes.values()) {
      if (this.liveWebContents(record)) {
        states.push({
          paneId: record.id,
          rect: record.view.getBounds(),
          visible: record.view.getVisible()
        })
      }
    }
    return states
  }

  emulationState(paneId: string): {
    enabled: boolean
    scale: number
    viewport: PaneViewport
  } | null {
    const record = this.panes.get(paneId)
    if (!record || !this.liveWebContents(record)) {
      return null
    }
    return {
      enabled: record.emulationEnabled,
      scale: record.appliedScale,
      viewport: { ...record.viewport }
    }
  }

  async captureSnapshots(): Promise<Record<string, string>> {
    const snapshots: Record<string, string> = {}
    await Promise.all(
      [...this.panes.values()].map(async (record) => {
        const webContents = this.liveWebContents(record)
        if (!webContents || record.url === 'about:blank') {
          return
        }
        try {
          const image = await webContents.capturePage()
          if (image.isEmpty()) {
            return
          }
          const jpeg = image.toJPEG(82)
          snapshots[record.id] = `data:image/jpeg;base64,${jpeg.toString('base64')}`
        } catch {
          // A snapshot is a progressive enhancement for canvas panning.
        }
      })
    )
    return snapshots
  }

  async readCookie(paneId: string): Promise<string | null> {
    const record = this.panes.get(paneId)
    const webContents = record ? this.liveWebContents(record) : null
    if (!webContents) {
      return null
    }

    const value: unknown = await webContents.executeJavaScript('document.cookie')
    return typeof value === 'string' ? value : null
  }

  getWebContentsId(paneId: string): number | null {
    const record = this.panes.get(paneId)
    const webContents = record ? this.liveWebContents(record) : null
    return webContents ? webContents.id : null
  }

  paneIdForWebContentsId(webContentsId: number): string | null {
    for (const record of this.panes.values()) {
      const webContents = this.liveWebContents(record)
      if (webContents?.id === webContentsId) {
        return record.id
      }
    }
    return null
  }

  /** Matches a blocked download to the pane whose profile and origin initiated it. */
  paneIdForDownload(profileId: string, origin: string): string | null {
    let fallback: string | null = null
    for (const record of this.panes.values()) {
      if (record.profile.id !== profileId || !this.liveWebContents(record)) {
        continue
      }
      fallback ??= record.id
      if (!origin) {
        continue
      }
      try {
        if (new URL(record.url).origin === origin) {
          return record.id
        }
      } catch {
        // about:blank and invalid URLs cannot match an origin.
      }
    }
    return fallback
  }

  destroyAll(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    for (const record of [...this.panes.values()]) {
      this.destroyPane(record, false)
    }
  }

  private createPane(
    profile: BrowserProfile,
    initialUrl: string,
    options: { id?: string; viewport?: PaneViewport; customTitle?: string | null } = {}
  ): PaneRecord {
    if (this.destroyed || this.window.isDestroyed()) {
      throw new Error('PaneFlow window is not available.')
    }

    const paneId = options.id ?? randomUUID()
    if (!isValidPaneId(paneId) || this.panes.has(paneId)) {
      throw new Error('Pane ID is invalid or duplicated.')
    }

    let customTitle: string | null = null
    if (options.customTitle !== undefined && options.customTitle !== null) {
      const parsedTitle = parsePaneTitle(options.customTitle)
      if (!parsedTitle.ok) {
        throw new Error(parsedTitle.error)
      }
      customTitle = parsedTitle.title
    }

    const parsedViewport =
      options.viewport === undefined
        ? { ok: true as const, viewport: { ...RESPONSIVE_VIEWPORT } }
        : parsePaneViewport(options.viewport)
    if (!parsedViewport.ok) {
      throw new Error(parsedViewport.error)
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionForProfile(profile.id),
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
        devTools: true
      }
    })

    const record: PaneRecord = {
      id: paneId,
      profile,
      view,
      title: fallbackTitle(initialUrl),
      customTitle,
      url: initialUrl,
      pendingUrl: null,
      isLoading: true,
      error: null,
      hasBounds: false,
      shellVisible: true,
      viewport: parsedViewport.viewport,
      lastEmulationSignature: '',
      emulationEnabled: false,
      appliedScale: 0,
      pageReady: false,
      lastColorScheme: null,
      colorSchemeErrorLogged: false,
      destroyed: false
    }

    try {
      this.window.contentView.addChildView(view)
      this.options.onPaneLayerChanged?.()
    } catch (error) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
      throw error
    }

    this.panes.set(record.id, record)
    view.setBackgroundColor(this.options.getColorScheme() === 'dark' ? '#101010' : '#ffffff')
    view.setBorderRadius(8)
    view.setVisible(false)
    this.applyColorScheme(record, this.options.getColorScheme())

    // Touch the session before loading so the remote policy applies to the
    // very first request, not just later navigations.
    getProfileSession(profile.id)

    this.attachEvents(record)
    this.load(record, initialUrl)
    return record
  }

  private attachEvents(record: PaneRecord): void {
    const webContents = record.view.webContents

    webContents.on('did-start-loading', () => {
      record.isLoading = true
      record.error = null
      record.pageReady = false
      this.emitState()
    })

    webContents.on('did-stop-loading', () => {
      record.isLoading = false
      record.pageReady = true
      this.applyEmulation(record)
      this.applyColorScheme(record)
      this.emitState()
    })

    webContents.on('did-navigate', (_event, url) => {
      record.url = url
      record.error = null
      record.lastColorScheme = null
      this.applyColorScheme(record)
      this.syncVisibility(record)
      this.emitState()
    })

    webContents.on('did-navigate-in-page', (_event, url) => {
      record.url = url
      this.emitState()
    })

    webContents.on('dom-ready', () => {
      this.applyColorScheme(record)
    })

    webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      record.title = title
      this.emitState()
    })

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || isAbortError(errorCode)) {
        return
      }
      record.isLoading = false
      record.error = `${errorDescription} (${errorCode})`
      record.url = validatedUrl || record.url
      record.view.setVisible(false)
      this.emitState()
    })

    webContents.on('render-process-gone', () => {
      record.isLoading = false
      record.error = 'The page process ended unexpectedly.'
      record.view.setVisible(false)
      this.emitState()
    })

    webContents.on('will-navigate', (event) => {
      if (!isAllowedNavigationUrl(event.url)) {
        event.preventDefault()
      }
    })

    webContents.on('will-redirect', (event) => {
      if (!isAllowedNavigationUrl(event.url)) {
        event.preventDefault()
      }
    })

    webContents.setWindowOpenHandler(() => {
      this.reportNotice(record, 'Popup blocked')
      return { action: 'deny' }
    })
    webContents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })

    webContents.on('destroyed', () => {
      this.handleUnexpectedDestruction(record)
    })

    webContents.on('focus', () => {
      if (!record.destroyed) {
        this.options.onPaneFocused?.(record.id)
      }
    })
  }

  private reportNotice(record: PaneRecord, message: string): void {
    this.options.onPaneNotice?.({ paneId: record.id, message })
  }

  private handleUnexpectedDestruction(record: PaneRecord): void {
    if (record.destroyed || !this.panes.has(record.id)) {
      return
    }

    record.destroyed = true
    this.panes.delete(record.id)

    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(record.view)
    }

    this.emitState()
  }

  private applyColorScheme(record: PaneRecord, scheme = this.options.getColorScheme()): void {
    const webContents = this.liveWebContents(record)
    if (!webContents || record.lastColorScheme === scheme) {
      return
    }

    record.lastColorScheme = scheme
    record.view.setBackgroundColor(scheme === 'dark' ? '#101010' : '#ffffff')

    const apply = async (): Promise<void> => {
      try {
        if (!webContents.debugger.isAttached()) {
          webContents.debugger.attach('1.3')
          webContents.debugger.once('detach', () => {
            record.lastColorScheme = null
          })
        }
        await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          media: '',
          features: [{ name: 'prefers-color-scheme', value: scheme }]
        })
      } catch (error) {
        record.lastColorScheme = null
        if (!record.colorSchemeErrorLogged) {
          record.colorSchemeErrorLogged = true
          console.warn(
            `Could not apply the ${scheme} color scheme to pane ${record.id}.`,
            error
          )
        }
      }
    }

    void apply()
  }

  private prepareForNavigation(record: PaneRecord): void {
    record.error = null
    record.isLoading = true
    this.syncVisibility(record)
  }

  private syncVisibility(record: PaneRecord): void {
    const visible =
      record.hasBounds &&
      record.shellVisible &&
      record.error === null &&
      record.url !== 'about:blank'
    record.view.setVisible(visible)
  }

  private applyEmulation(record: PaneRecord): void {
    const webContents = this.liveWebContents(record)
    if (!webContents || !record.pageReady) {
      // Enabling device emulation before a WebContentsView has loaded can crash
      // the renderer process on macOS. The load-stop handler applies the latest
      // viewport state once the page has a live surface.
      return
    }

    if (record.viewport.preset === 'responsive') {
      if (this.canvasZoom === 1) {
        if (!record.emulationEnabled) {
          record.lastEmulationSignature = 'responsive'
          return
        }
        webContents.disableDeviceEmulation()
        record.emulationEnabled = false
        record.appliedScale = 0
        record.lastEmulationSignature = 'responsive'
        return
      }

      const canvasSignature = `responsive-canvas:${this.canvasZoom}`
      if (record.lastEmulationSignature === canvasSignature) {
        return
      }
      webContents.enableDeviceEmulation({
        screenPosition: 'desktop',
        screenSize: {
          width: CANVAS_RESPONSIVE_WIDTH,
          height: CANVAS_RESPONSIVE_HEIGHT
        },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1,
        viewSize: {
          width: CANVAS_RESPONSIVE_WIDTH,
          height: CANVAS_RESPONSIVE_HEIGHT
        },
        scale: this.canvasZoom
      })
      record.emulationEnabled = true
      record.appliedScale = this.canvasZoom
      record.lastEmulationSignature = canvasSignature
      return
    }

    const available = record.view.getBounds()
    const size = viewportContentSize(record.viewport)
    const scale = viewportDisplayScale(record.viewport, available)
    const signature = [
      record.viewport.preset,
      record.viewport.width,
      record.viewport.height,
      record.viewport.deviceScaleFactor,
      record.viewport.rotated === true ? 'rotated' : 'upright',
      scale
    ].join(':')
    if (record.lastEmulationSignature === signature) {
      return
    }

    // Desktop screen positioning keeps the requested CSS viewport exact.
    // Mobile positioning makes Chromium apply a 980px fallback layout to pages
    // without a viewport meta tag, which would make the preset dimensions a lie.
    webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width: size.width, height: size.height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: record.viewport.deviceScaleFactor,
      viewSize: { width: size.width, height: size.height },
      scale
    })
    record.emulationEnabled = true
    record.appliedScale = scale
    record.lastEmulationSignature = signature
  }

  private load(record: PaneRecord, url: string): void {
    if (record.destroyed || record.view.webContents.isDestroyed()) {
      return
    }

    if (!isAllowedNavigationUrl(url)) {
      record.error = 'That address is not allowed.'
      record.view.setVisible(false)
      this.emitState()
      return
    }

    record.url = url
    record.title = fallbackTitle(url)
    record.error = null
    record.isLoading = true
    record.pageReady = false

    if (!record.hasBounds) {
      // Loading a WebContentsView before it has real bounds gives the page a
      // 0x0 initial viewport. Defer the first request until the shell has
      // measured the pane; navigate/reload calls replace the pending URL.
      record.pendingUrl = url
      this.syncVisibility(record)
      this.emitState()
      return
    }

    record.pendingUrl = null
    this.syncVisibility(record)

    void record.view.webContents.loadURL(url).catch(() => {
      // Failures are surfaced by did-fail-load. loadURL also rejects when a
      // navigation is superseded; that is not a pane error.
    })
    this.emitState()
  }

  private requirePane(paneId: string): PaneRecord | undefined {
    const record = this.panes.get(paneId)
    if (!record || record.destroyed || record.view.webContents.isDestroyed()) {
      return undefined
    }
    return record
  }

  private liveWebContents(record: PaneRecord): WebContents | null {
    if (record.destroyed) {
      return null
    }
    try {
      const webContents: WebContents | undefined = record.view?.webContents
      return webContents && !webContents.isDestroyed() ? webContents : null
    } catch {
      return null
    }
  }

  private destroyPane(record: PaneRecord, emitState = true): void {
    if (record.destroyed) {
      return
    }
    const webContents = this.liveWebContents(record)
    record.destroyed = true
    this.panes.delete(record.id)

    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(record.view)
    }

    if (webContents && !webContents.isDestroyed()) {
      webContents.removeAllListeners()
      webContents.closeDevTools()
      webContents.close()
    }

    if (emitState) {
      this.emitState()
    }
  }

  private emitState(): void {
    if (this.destroyed) {
      return
    }
    this.options.onStateChanged(this.snapshot())
  }
}
