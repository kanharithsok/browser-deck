import { randomUUID } from 'node:crypto'
import { Menu, WebContentsView, type BaseWindow, type WebContents } from 'electron'
import { parsePaneBounds, type CanvasSize } from '../shared/geometry'
import type { PaneState, PaneViewRect, ScriptResult, ShellSnapshot } from '../shared/ipc'
import { partitionForProfile, type BrowserProfile } from '../shared/profiles'
import { MAX_URL_LENGTH, isAllowedNavigationUrl, normalizeAddress } from '../shared/url'
import {
  RESPONSIVE_VIEWPORT,
  parsePaneViewport,
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
  destroyed: boolean
}

interface BrowserManagerOptions {
  onStateChanged: (state: ShellSnapshot) => void
  onPaneFocused?: (paneId: string) => void
  onPaneRenameRequested?: (paneId: string) => void
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
    return 'New pane'
  }
  try {
    return new URL(url).hostname || 'New pane'
  } catch {
    return 'New pane'
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

  constructor(
    private readonly window: BaseWindow,
    private readonly profileStore: ProfileStore,
    private readonly options: BrowserManagerOptions
  ) {}

  async initialize(panes: PaneInitialization[]): Promise<void> {
    for (const pane of panes) {
      if (pane.id !== undefined && !isValidPaneId(pane.id)) {
        throw new Error('Invalid pane ID in workspace.')
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
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
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

  private addPaneForProfile(profile: BrowserProfile, address?: string): ScriptResult {
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

    this.createPane(profile, url)
    return { ok: true }
  }

  closePane(paneId: string): ScriptResult {
    const record = this.panes.get(paneId)
    if (!record) {
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
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
      return { ok: false, error: 'Pane not found.' }
    }
    if (this.window.isDestroyed()) {
      return { ok: false, error: 'Window is not available.' }
    }

    // Re-adding an existing child moves it to the top of the native stack.
    this.window.contentView.addChildView(record.view)
    return { ok: true }
  }

  sendPaneToBack(paneId: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Pane not found.' }
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

  setViewport(paneId: string, input: unknown): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Pane not found.' }
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

  showMenu(paneId: string, x: number, y: number): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Pane not found.' }
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
        label: 'Duplicate Pane',
        click: () => {
          void this.duplicatePane(record.id)
        }
      },
      {
        label: 'Rename Pane…',
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
        label: 'Close Pane',
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
      destroyed: false
    }

    try {
      this.window.contentView.addChildView(view)
    } catch (error) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
      throw error
    }

    this.panes.set(record.id, record)
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(8)
    view.setVisible(false)

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
      this.emitState()
    })

    webContents.on('did-navigate', (_event, url) => {
      record.url = url
      record.error = null
      this.syncVisibility(record)
      this.emitState()
    })

    webContents.on('did-navigate-in-page', (_event, url) => {
      record.url = url
      this.emitState()
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

    webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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

    const available = record.view.getBounds()
    const scale = viewportDisplayScale(record.viewport, available)
    const signature = [
      record.viewport.preset,
      record.viewport.width,
      record.viewport.height,
      record.viewport.deviceScaleFactor,
      record.viewport.displayScale,
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
      screenSize: { width: record.viewport.width, height: record.viewport.height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: record.viewport.deviceScaleFactor,
      viewSize: { width: record.viewport.width, height: record.viewport.height },
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
