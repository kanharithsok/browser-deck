import { randomUUID } from 'node:crypto'
import { Menu, WebContentsView, type BaseWindow } from 'electron'
import { parsePaneBounds, type CanvasSize } from '../shared/geometry'
import type { PaneState, PaneViewRect, ScriptResult, ShellState } from '../shared/ipc'
import { partitionForProfile, type BrowserProfile } from '../shared/profiles'
import { isAllowedNavigationUrl, normalizeAddress } from '../shared/url'
import type { ProfileStore } from './profile-store'
import { getProfileSession } from './session-policy'

interface PaneRecord {
  id: string
  profile: BrowserProfile
  view: WebContentsView
  title: string
  url: string
  pendingUrl: string | null
  isLoading: boolean
  error: string | null
  hasBounds: boolean
  shellVisible: boolean
  destroyed: boolean
}

interface BrowserManagerOptions {
  onStateChanged: (state: ShellState) => void
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

  async initialize(startUrls: string[]): Promise<void> {
    const profiles = this.profileStore.list()
    for (let index = 0; index < 2; index += 1) {
      const profile = profiles[index] ?? (await this.profileStore.create())
      const candidate = startUrls[index] ?? 'about:blank'
      const normalized = normalizeAddress(candidate)
      this.createPane(profile, normalized.ok ? normalized.url : 'about:blank')
    }
  }

  async addPane(address?: string): Promise<ScriptResult> {
    let url = 'about:blank'
    if (address !== undefined && address.trim() !== '') {
      if (address.length > 2048) {
        return { ok: false, error: 'Address is too long.' }
      }
      const normalized = normalizeAddress(address)
      if (!normalized.ok) {
        return { ok: false, error: normalized.error }
      }
      url = normalized.url
    }

    const profile = await this.profileStore.create()
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

  navigate(paneId: string, address: string): ScriptResult {
    const record = this.requirePane(paneId)
    if (!record) {
      return { ok: false, error: 'Pane not found.' }
    }

    if (address.length > 2048) {
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

      if (firstBounds && record.pendingUrl) {
        this.load(record, record.pendingUrl)
      }
    }

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

  snapshot(): ShellState {
    const panes: PaneState[] = []
    for (const record of this.panes.values()) {
      if (record.destroyed || record.view.webContents.isDestroyed()) {
        continue
      }

      const webContents = record.view.webContents
      let canGoBack = false
      let canGoForward = false
      if (!webContents.isDestroyed()) {
        canGoBack = webContents.navigationHistory.canGoBack()
        canGoForward = webContents.navigationHistory.canGoForward()
      }

      panes.push({
        id: record.id,
        profileId: record.profile.id,
        profileLabel: record.profile.label,
        title: record.title || fallbackTitle(record.url),
        url: record.url,
        isLoading: record.isLoading,
        canGoBack,
        canGoForward,
        error: record.error
      })
    }

    return { panes }
  }

  viewBounds(): Array<{ paneId: string; rect: PaneViewRect }> {
    const bounds: Array<{ paneId: string; rect: PaneViewRect }> = []
    for (const record of this.panes.values()) {
      if (!record.destroyed && !record.view.webContents.isDestroyed()) {
        bounds.push({ paneId: record.id, rect: record.view.getBounds() })
      }
    }
    return bounds
  }

  viewStates(): Array<{ paneId: string; rect: PaneViewRect; visible: boolean }> {
    const states: Array<{ paneId: string; rect: PaneViewRect; visible: boolean }> = []
    for (const record of this.panes.values()) {
      if (!record.destroyed && !record.view.webContents.isDestroyed()) {
        states.push({
          paneId: record.id,
          rect: record.view.getBounds(),
          visible: record.view.getVisible()
        })
      }
    }
    return states
  }

  async readCookie(paneId: string): Promise<string | null> {
    const record = this.panes.get(paneId)
    if (!record || record.destroyed || record.view.webContents.isDestroyed()) {
      return null
    }

    const value: unknown = await record.view.webContents.executeJavaScript('document.cookie')
    return typeof value === 'string' ? value : null
  }

  getWebContentsId(paneId: string): number | null {
    const record = this.panes.get(paneId)
    if (!record || record.destroyed || record.view.webContents.isDestroyed()) {
      return null
    }
    return record.view.webContents.id
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

  private createPane(profile: BrowserProfile, initialUrl: string): PaneRecord {
    if (this.destroyed || this.window.isDestroyed()) {
      throw new Error('PaneFlow window is not available.')
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionForProfile(profile.id),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: true
      }
    })

    const record: PaneRecord = {
      id: randomUUID(),
      profile,
      view,
      title: fallbackTitle(initialUrl),
      url: initialUrl,
      pendingUrl: null,
      isLoading: true,
      error: null,
      hasBounds: false,
      shellVisible: true,
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
      this.emitState()
    })

    webContents.on('did-stop-loading', () => {
      record.isLoading = false
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

  private destroyPane(record: PaneRecord, emitState = true): void {
    if (record.destroyed) {
      return
    }
    record.destroyed = true
    this.panes.delete(record.id)

    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(record.view)
    }

    const webContents = record.view.webContents
    if (!webContents.isDestroyed()) {
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
