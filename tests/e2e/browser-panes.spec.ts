/// <reference lib="dom" />

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { IPC_CHANNELS, type PaneViewRect, type ShellState } from '../../src/shared/ipc'
import {
  SHELL_ENTRY_URL,
  SHELL_MINIMAP_URL,
  SHELL_ZOOM_URL
} from '../../src/shared/shell'
import type { PaneViewport } from '../../src/shared/viewports'
import type { WorkspaceData } from '../../src/shared/workspace'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.cjs'

interface TestHook {
  snapshot(): ShellState
  viewBounds(): Array<{ paneId: string; rect: PaneViewRect }>
  viewStates(): Array<{ paneId: string; rect: PaneViewRect; visible: boolean }>
  emulationState(paneId: string): { enabled: boolean; scale: number; viewport: PaneViewport } | null
  viewOrder(): string[]
  readCookie(paneId: string): Promise<string | null>
  webContentsId(paneId: string): number | null
  webContentsCount(): number
  shellWebContentsId(): number | null
  contentBounds(): PaneViewRect | null
  minimapState(): {
    visible: boolean
    bounds: PaneViewRect
    loaded: boolean
    collapsed: boolean
  } | null
  zoomState(): {
    visible: boolean
    bounds: PaneViewRect
    loaded: boolean
  } | null
}

interface DomPaneRect {
  paneId: string
  rect: PaneViewRect
}

function testEnv(userDataDir: string, startUrls: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  delete env.ELECTRON_RENDERER_URL
  env.PANEFLOW_TEST = '1'
  env.PANEFLOW_USER_DATA_DIR = userDataDir
  env.PANEFLOW_START_URLS = startUrls
  return env
}

function isShellPage(url: string): boolean {
  return url.startsWith(SHELL_ENTRY_URL)
}

async function launchApp(userDataDir: string, startUrls: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: testEnv(userDataDir, startUrls),
    timeout: 30_000
  })
}

async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeout = 20_000
): Promise<T> {
  const deadline = Date.now() + timeout
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (predicate(value)) {
        return value
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(100)
  }

  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

async function readPersistedWorkspace(userDataDir: string): Promise<WorkspaceData | null> {
  try {
    const raw = await readFile(join(userDataDir, 'workspaces', 'default.json'), 'utf8')
    return JSON.parse(raw) as WorkspaceData
  } catch {
    return null
  }
}

async function readPersistedProfiles(
  userDataDir: string
): Promise<Array<{ id: string; label: string }>> {
  try {
    const raw = await readFile(join(userDataDir, 'profiles.json'), 'utf8')
    const parsed = JSON.parse(raw) as {
      profiles?: Array<{ id: string; label: string }>
    }
    return parsed.profiles ?? []
  } catch {
    return []
  }
}

async function getSnapshot(app: ElectronApplication): Promise<ShellState> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.snapshot()
  })
}

async function getViewStates(
  app: ElectronApplication
): Promise<Array<{ paneId: string; rect: PaneViewRect; visible: boolean }>> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.viewStates()
  })
}

async function getEmulationState(
  app: ElectronApplication,
  paneId: string
): Promise<{ enabled: boolean; scale: number; viewport: PaneViewport } | null> {
  return app.evaluate((_electron, id) => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.emulationState(id)
  }, paneId)
}

async function getWorkingSetMb(app: ElectronApplication): Promise<number> {
  const kilobytes = await app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .reduce((total, metric) => total + (metric.memory?.workingSetSize ?? 0), 0)
  )
  return Math.round(kilobytes / 1024)
}

async function getWebContentsCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.webContentsCount()
  })
}

async function getZoomState(app: ElectronApplication): Promise<{
  visible: boolean
  bounds: PaneViewRect
  loaded: boolean
} | null> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.zoomState()
  })
}

async function resetCanvasZoomFromBar(
  shellPage: Page,
  zoomPage: Page
): Promise<void> {
  await zoomPage.getByRole('button', { name: 'Choose zoom level' }).click()
  const menu = shellPage.getByRole('menu', { name: 'Zoom' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Reset (100%)' }).click()
  await expect(menu).toHaveCount(0)
}

async function getMinimapState(app: ElectronApplication): Promise<{
  visible: boolean
  bounds: PaneViewRect
  loaded: boolean
  collapsed: boolean
} | null> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.minimapState()
  })
}

async function readPersistedAppState(
  userDataDir: string
): Promise<{
  activeWorkspaceId?: string
  windowBounds?: PaneViewRect
  maximized?: boolean
  fullScreen?: boolean
  theme?: string
} | null> {
  try {
    const raw = await readFile(join(userDataDir, 'app-state.json'), 'utf8')
    return JSON.parse(raw) as {
      activeWorkspaceId?: string
      windowBounds?: PaneViewRect
      maximized?: boolean
      fullScreen?: boolean
      theme?: string
    }
  } catch {
    return null
  }
}

async function getWindowBounds(app: ElectronApplication): Promise<PaneViewRect> {
  return app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0]
    if (!window) {
      throw new Error('PaneFlow window is unavailable')
    }
    return window.getNormalBounds()
  })
}

async function getContentBounds(app: ElectronApplication): Promise<PaneViewRect> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    const bounds = hook.contentBounds()
    if (!bounds) {
      throw new Error('Window content bounds are unavailable')
    }
    return bounds
  })
}

async function readCookie(app: ElectronApplication, paneId: string): Promise<string | null> {
  return app.evaluate(async (_electron, id) => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.readCookie(id)
  }, paneId)
}

async function readPaneBodyText(app: ElectronApplication, paneId: string): Promise<string> {
  return evaluateInPane<string>(app, paneId, 'document.body.innerText')
}

async function evaluateInPane<T>(
  app: ElectronApplication,
  paneId: string,
  script: string
): Promise<T> {
  const webContentsId = await app.evaluate((_electron, id) => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    return hook ? hook.webContentsId(id) : null
  }, paneId)

  return app.evaluate(async ({ webContents }, args) => {
    const target = args.id === null ? undefined : webContents.fromId(args.id)
    if (!target || target.isDestroyed()) {
      throw new Error('Pane page is not available')
    }
    return target.executeJavaScript(args.script)
  }, { id: webContentsId, script }) as Promise<T>
}

async function writeIndexedDbProbe(page: Page, value: string): Promise<void> {
  await page.evaluate(async (probe) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('paneflow-fixture', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('kv')) {
          request.result.createObjectStore('kv')
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('kv', 'readwrite')
        transaction.objectStore('kv').put(probe, 'probe')
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, value)
}

async function readIndexedDbProbe(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    return new Promise<string | null>((resolve, reject) => {
      const request = indexedDB.open('paneflow-fixture', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('kv')) {
          database.close()
          resolve(null)
          return
        }
        const transaction = database.transaction('kv', 'readonly')
        const read = transaction.objectStore('kv').get('probe')
        read.onsuccess = () => {
          database.close()
          resolve(typeof read.result === 'string' ? read.result : null)
        }
        read.onerror = () => reject(read.error)
      }
    })
  })
}

async function clickAppMenuCommand(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuItemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuItemId)
    if (!item) {
      throw new Error(`Menu item ${menuItemId} is unavailable`)
    }
    item.click()
  }, id)
}

async function readAppMenuItem(
  app: ElectronApplication,
  id: string
): Promise<{ id: string; accelerator: string | null; enabled: boolean } | null> {
  return app.evaluate(({ Menu }, menuItemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuItemId)
    return item
      ? { id: item.id, accelerator: item.accelerator, enabled: item.enabled }
      : null
  }, id)
}

async function shellEvaluate<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    const shellId = hook.shellWebContentsId()
    if (shellId === null) {
      throw new Error('Shell webContents is unavailable')
    }
    const shell = webContents.fromId(shellId)
    if (!shell) {
      throw new Error('Shell webContents was not found')
    }
    return shell.executeJavaScript(source)
  }, script) as Promise<T>
}

async function attemptUntrustedIpc(
  app: ElectronApplication,
  pageUrl: string,
  paneId: string
): Promise<{
  state: ShellState
  close: { ok: boolean; error?: string }
}> {
  return app.evaluate(
    async ({ BrowserWindow }, args) => {
      const untrustedWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false
        }
      })
      try {
        await untrustedWindow.loadURL(args.pageUrl)
        return await untrustedWindow.webContents.executeJavaScript(`(async () => {
          const { ipcRenderer } = require('electron')
          return {
            state: await ipcRenderer.invoke(${JSON.stringify(args.getStateChannel)}),
            close: await ipcRenderer.invoke(
              ${JSON.stringify(args.closePaneChannel)},
              ${JSON.stringify(args.paneId)}
            )
          }
        })()`)
      } finally {
        if (!untrustedWindow.isDestroyed()) {
          untrustedWindow.destroy()
        }
      }
    },
    {
      pageUrl,
      paneId,
      getStateChannel: IPC_CHANNELS.getState,
      closePaneChannel: IPC_CHANNELS.closePane
    }
  )
}

async function readDomPaneRects(app: ElectronApplication): Promise<DomPaneRect[]> {
  return shellEvaluate<DomPaneRect[]>(
    app,
    `Array.from(document.querySelectorAll('[data-pane-content]')).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        paneId: element.dataset.paneContent,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    })`
  )
}

async function readPaneCardRects(
  page: Page
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.pane-card')).map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  )
}

async function focusPane(page: Page, paneId: string): Promise<void> {
  const card = page.locator(`.pane-card[data-pane-id="${paneId}"]`)
  await card.locator('.pane-title').click()
  await expect(card).toHaveAttribute('aria-current', 'true')
}

async function setPaneAddress(page: Page, paneId: string, address: string): Promise<void> {
  await focusPane(page, paneId)
  const input = page.locator('.global-pane-bar .address-input')
  await input.fill(address)
  await input.press('Enter')
}

function rectsAlign(domRects: DomPaneRect[], nativeBounds: Array<{ paneId: string; rect: PaneViewRect }>): boolean {
  if (domRects.length !== nativeBounds.length) {
    return false
  }

  return domRects.every((domRect) => {
    const native = nativeBounds.find((entry) => entry.paneId === domRect.paneId)
    if (!native) {
      return false
    }

    return (
      Math.abs(domRect.rect.x - native.rect.x) <= 1 &&
      Math.abs(domRect.rect.y - native.rect.y) <= 1 &&
      Math.abs(domRect.rect.width - native.rect.width) <= 1 &&
      Math.abs(domRect.rect.height - native.rect.height) <= 1
    )
  })
}

async function waitForAlignedBounds(app: ElectronApplication): Promise<void> {
  await waitFor(
    async () => {
      const states = await getViewStates(app)
      const visibleStates = states.filter((state) => state.visible)
      const visibleIds = new Set(visibleStates.map((state) => state.paneId))
      const dom = (await readDomPaneRects(app)).filter((entry) =>
        visibleIds.has(entry.paneId)
      )
      return {
        dom,
        native: visibleStates.map((state) => ({
          paneId: state.paneId,
          rect: state.rect
        }))
      }
    },
    ({ dom, native }) => rectsAlign(dom, native),
    'visible native view bounds to align with the shell DOM',
    10_000
  )
}

async function waitForVisibleAlignedBounds(app: ElectronApplication): Promise<void> {
  await waitFor(
    async () => {
      const states = await getViewStates(app)
      const visibleStates = states.filter((state) => state.visible)
      const visibleIds = new Set(visibleStates.map((state) => state.paneId))
      const dom = (await readDomPaneRects(app)).filter((entry) => visibleIds.has(entry.paneId))
      return {
        dom,
        native: visibleStates.map((state) => ({ paneId: state.paneId, rect: state.rect }))
      }
    },
    ({ dom, native }) => dom.length > 0 && rectsAlign(dom, native),
    'visible native view bounds to align with the shell DOM',
    10_000
  )
}

test('Browser panes: native composition, isolated auth, lifecycle, and persistence', async () => {
  test.setTimeout(180_000)

  let fixture: FixtureServer | null = null
  let userDataDir = ''
  let app: ElectronApplication | null = null

  try {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'paneflow-e2e-'))
    const firstUrls = `${fixture.url}/pane/one?user=alice,${fixture.url}/pane/two?user=bob`

    app = await launchApp(userDataDir, firstUrls)

    const initial = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes.length === 2 &&
        state.panes.every((pane) => pane.url.includes('/pane/') && !pane.isLoading),
      'two fixture panes to finish loading'
    )

    expect(initial.panes).toHaveLength(2)
    expect(initial.panes[0]?.profileId).not.toBe(initial.panes[1]?.profileId)
    expect(initial.panes[0]?.profileLabel).not.toBe(initial.panes[1]?.profileLabel)
    const firstProfileIds = initial.panes.map((pane) => pane.profileId)
    const alicePaneId = initial.panes[0]?.id
    const bobPaneId = initial.panes[1]?.id
    expect(alicePaneId).toBeTruthy()
    expect(bobPaneId).toBeTruthy()

    const pages = await waitFor(
      async () => (app as ElectronApplication).windows(),
      (windows) =>
        windows.some((page) => isShellPage(page.url())) &&
        windows.some((page) => page.url() === SHELL_MINIMAP_URL) &&
        windows.some((page) => page.url() === SHELL_ZOOM_URL) &&
        windows.some((page) => page.url().includes('/pane/one')) &&
        windows.some((page) => page.url().includes('/pane/two')),
      'shell, overlays, and native pane pages'
    )
    const shellPage = pages.find((page) => isShellPage(page.url()))
    const minimapPage = pages.find((page) => page.url() === SHELL_MINIMAP_URL)
    const zoomPage = pages.find((page) => page.url() === SHELL_ZOOM_URL)
    const alicePage = pages.find((page) => page.url().includes('/pane/one'))
    const bobPage = pages.find((page) => page.url().includes('/pane/two'))
    if (!shellPage || !minimapPage || !zoomPage || !alicePage || !bobPage) {
      throw new Error('Expected the shell, overlays, and both native pane pages')
    }
    expect(shellPage.url()).toBe(SHELL_ENTRY_URL)

    // The shell's production CSP blocks inline script and cross-origin fetch.
    const cspProbe = await shellPage.evaluate(async (fixtureUrl) => {
      const script = document.createElement('script')
      script.textContent = 'window.__paneflowCspInline = true'
      document.head.appendChild(script)
      script.remove()

      let externalFetchSucceeded = false
      try {
        await fetch(`${fixtureUrl}/pane/one`, { signal: AbortSignal.timeout(2_000) })
        externalFetchSucceeded = true
      } catch {
        // A CSP-blocked fetch rejects before reaching the fixture.
      }

      return {
        inlineExecuted: Boolean(
          (window as unknown as { __paneflowCspInline?: boolean }).__paneflowCspInline
        ),
        externalFetchSucceeded
      }
    }, (fixture as FixtureServer).url)
    expect(cspProbe.inlineExecuted).toBe(false)
    expect(cspProbe.externalFetchSucceeded).toBe(false)

    await waitFor(
      async () => ({
        alice: await readCookie(app as ElectronApplication, alicePaneId as string),
        bob: await readCookie(app as ElectronApplication, bobPaneId as string)
      }),
      ({ alice, bob }) =>
        (alice ?? '').includes('paneflow_user=alice') &&
        (bob ?? '').includes('paneflow_user=bob'),
      'isolated profile cookies'
    )

    const aliceCookie = await readCookie(app, alicePaneId as string)
    const bobCookie = await readCookie(app, bobPaneId as string)
    expect(aliceCookie).toContain('alice')
    expect(bobCookie).toContain('bob')
    expect(aliceCookie).not.toContain('bob')

    // Remote pages have no application bridge, Node APIs, or process globals.
    expect(
      await alicePage.evaluate(() =>
        [typeof (window as unknown as { paneflow?: unknown }).paneflow, typeof require, typeof process].join(',')
      )
    ).toBe('undefined,undefined,undefined')

    // A different WebContents in the same Electron process must not pass the
    // IPC sender check even though it can reach ipcRenderer directly.
    const untrustedIpc = await attemptUntrustedIpc(
      app,
      `${fixture.url}/pane/untrusted?user=mallory`,
      alicePaneId as string
    )
    expect(untrustedIpc.state.panes).toEqual([])
    expect(untrustedIpc.state.workspace.id).toBe('default')
    expect(untrustedIpc.close).toEqual({ ok: false, error: 'Unauthorized sender.' })

    // Top-level remote navigation is restricted to http(s)/about:blank.
    const aliceUrlBeforeBlockedNavigation = alicePage.url()
    await alicePage.evaluate(() => {
      window.location.href = 'file:///etc/passwd'
    })
    await delay(250)
    expect(alicePage.url()).toBe(aliceUrlBeforeBlockedNavigation)
    await alicePage.evaluate(() => {
      window.location.href = 'data:text/html,<h1>blocked</h1>'
    })
    await delay(250)
    expect(alicePage.url()).toBe(aliceUrlBeforeBlockedNavigation)

    // Local storage isolation (same origin, different persistent partitions)
    // using a real click inside the native browser view.
    await alicePage.locator('#storage-button').click()
    await expect
      .poll(() => alicePage.evaluate(() => localStorage.getItem('paneflow_fixture')))
      .not.toBeNull()
    const aliceStorageBeforeRestart = await alicePage.evaluate(() =>
      localStorage.getItem('paneflow_fixture')
    )
    expect(aliceStorageBeforeRestart).not.toBeNull()
    expect(await bobPage.evaluate(() => localStorage.getItem('paneflow_fixture'))).toBeNull()

    // IndexedDB isolation between the same-origin partitions.
    await writeIndexedDbProbe(alicePage, 'alice-idb')
    expect(await readIndexedDbProbe(alicePage)).toBe('alice-idb')
    expect(await readIndexedDbProbe(bobPage)).toBeNull()

    // Popups and permissions from remote content are denied by session policy.
    expect(await alicePage.evaluate(() => window.open('/popup'))).toBeNull()
    expect(await alicePage.evaluate(() => Notification.requestPermission())).toBe('denied')

    // Native view bounds track the shell DOM after the initial layout.
    await waitForAlignedBounds(app)
    const initialContentBounds = await getContentBounds(app)
    const shellViewport = await shellEvaluate<{ width: number; height: number; dpr: number }>(
      app,
      '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })'
    )
    expect(shellViewport.width).toBe(initialContentBounds.width)
    expect(shellViewport.height).toBe(initialContentBounds.height)

    // macOS uses a hidden-inset title bar: content fills the window, the toolbar
    // is the drag region, and space is reserved for the native traffic lights.
    const macWindowChrome = await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window is unavailable')
      }
      return {
        bounds: window.getBounds(),
        content: window.getContentBounds(),
        buttonPosition: window.getWindowButtonPosition()
      }
    })
    expect(macWindowChrome.content.width).toBe(macWindowChrome.bounds.width)
    expect(macWindowChrome.content.height).toBe(macWindowChrome.bounds.height)
    expect(macWindowChrome.buttonPosition).toEqual({ x: 16, y: 16 })
    const toolbarChrome = await shellPage.locator('.toolbar').evaluate((element) => ({
      region: getComputedStyle(element).getPropertyValue('-webkit-app-region'),
      left: element.getBoundingClientRect().left,
      brandLeft: element.querySelector('.brand')?.getBoundingClientRect().left ?? 0
    }))
    expect(toolbarChrome.region).toBe('drag')
    expect(toolbarChrome.left).toBe(0)
    expect(toolbarChrome.brandLeft).toBeGreaterThanOrEqual(76)

    const aliceDomRect = (await readDomPaneRects(app)).find((entry) => entry.paneId === alicePaneId)
    const aliceViewport = await alicePage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    expect(aliceDomRect).toBeTruthy()
    expect(Math.abs(aliceViewport.width - (aliceDomRect?.rect.width ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs(aliceViewport.height - (aliceDomRect?.rect.height ?? 0))).toBeLessThanOrEqual(1)

    // Canvas is the only workspace layout now. There is no Grid/Freeform
    // switcher and no grid-column control.
    await expect(shellPage.locator('.workspace')).toHaveClass(/workspace-canvas/)
    await expect(shellPage.getByRole('group', { name: 'Layout mode' })).toHaveCount(0)
    await expect(shellPage.getByLabel('Grid columns')).toHaveCount(0)

    // Canvas starts fitted to all panes, with a bottom-center zoom overlay.
    await expect
      .poll(async () => {
        const workspaceBounds = await shellPage.locator('.workspace').boundingBox()
        const cards = await shellPage.locator('.pane-card').evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON())
        )
        return Boolean(
          workspaceBounds &&
            cards.length === 2 &&
            cards.every(
              (card) =>
                card.x >= workspaceBounds.x - 1 &&
                card.y >= workspaceBounds.y - 1 &&
                card.x + card.width <= workspaceBounds.x + workspaceBounds.width + 1 &&
                card.y + card.height <= workspaceBounds.y + workspaceBounds.height + 1
            )
        )
      })
      .toBe(true)
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(true)
    const startupZoom = await getZoomState(app as ElectronApplication)
    if (!startupZoom) {
      throw new Error('Startup zoom bar state is unavailable')
    }
    expect(startupZoom.loaded).toBe(true)
    expect(startupZoom.bounds.width).toBe(204)
    expect(startupZoom.bounds.height).toBe(40)
    expect(startupZoom.bounds.x + startupZoom.bounds.width / 2).toBe(
      Math.round(initialContentBounds.width / 2)
    )
    expect(startupZoom.bounds.y + startupZoom.bounds.height).toBe(
      initialContentBounds.height - 12
    )
    await expect(zoomPage.locator('#value')).toContainText('%')
    const toolbarBorders = await shellPage.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.toolbar .toolbar-icon')).map(
        (button) => getComputedStyle(button).borderTopWidth
      )
    )
    expect(toolbarBorders).toEqual(['0px', '0px', '0px', '0px', '0px'])
    await expect(shellPage.locator('.global-pane-bar')).toBeVisible()
    await waitForAlignedBounds(app)

    // The overview is a persistent native panel in the bottom-right. It needs
    // no reveal button and must stay above native pane views.
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)
    const visibleMinimap = await getMinimapState(app as ElectronApplication)
    const minimapContent = await getContentBounds(app as ElectronApplication)
    if (!visibleMinimap) {
      throw new Error('Canvas minimap state is unavailable')
    }
    expect(visibleMinimap.loaded).toBe(true)
    expect(visibleMinimap.bounds.x + visibleMinimap.bounds.width).toBe(minimapContent.width - 12)
    expect(visibleMinimap.bounds.y + visibleMinimap.bounds.height).toBe(minimapContent.height - 12)
    expect(visibleMinimap.bounds.width).toBeGreaterThanOrEqual(168)
    await expect(minimapPage.locator('.frame')).toHaveCount(2)
    await expect(minimapPage.locator('.viewport')).toBeVisible()

    // A minimap frame centers and focuses its pane, then returns keyboard focus
    // to the shell instead of keeping it in the native overlay.
    await minimapPage.locator('.frame').nth(1).click()
    await waitForVisibleAlignedBounds(app)
    await expect(shellPage.locator('.pane-card').nth(1)).toHaveAttribute('aria-current', 'true')
    const centeredWorkspace = await shellPage.locator('.workspace').boundingBox()
    const centeredPane = await shellPage.locator('.pane-card').nth(1).boundingBox()
    if (!centeredWorkspace || !centeredPane) {
      throw new Error('Canvas minimap focus bounds are unavailable')
    }
    expect(
      Math.abs(
        centeredPane.x + centeredPane.width / 2 -
          (centeredWorkspace.x + centeredWorkspace.width / 2)
      )
    ).toBeLessThanOrEqual(2)
    expect(await shellPage.evaluate(() => document.hasFocus())).toBe(true)

    await expect.poll(() => shellPage.locator('.pane-snapshot').count()).toBe(2)
    const firstCanvasCard = shellPage.locator('.pane-card').first()
    const secondCanvasCard = shellPage.locator('.pane-card').nth(1)
    const paneDragBefore = await firstCanvasCard.boundingBox()
    const otherPaneBefore = await secondCanvasCard.boundingBox()
    const backgroundBefore = await shellPage
      .locator('.workspace')
      .evaluate((element) => getComputedStyle(element).backgroundPosition)
    const paneDragHeader = await firstCanvasCard.locator('.pane-header').boundingBox()
    if (!paneDragBefore || !otherPaneBefore || !paneDragHeader) {
      throw new Error('Canvas pane drag bounds are unavailable')
    }
    await shellPage.mouse.move(
      paneDragHeader.x + paneDragHeader.width * 0.5,
      paneDragHeader.y + paneDragHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      paneDragHeader.x + paneDragHeader.width * 0.5 + 40,
      paneDragHeader.y + paneDragHeader.height / 2 + 24,
      { steps: 6 }
    )
    await shellPage.mouse.up()
    await waitForVisibleAlignedBounds(app)
    const paneDragAfter = await firstCanvasCard.boundingBox()
    const otherPaneAfter = await secondCanvasCard.boundingBox()
    expect(paneDragAfter?.x).not.toBe(paneDragBefore.x)
    expect(paneDragAfter?.y).not.toBe(paneDragBefore.y)
    expect(otherPaneAfter?.x).toBe(otherPaneBefore.x)
    expect(otherPaneAfter?.y).toBe(otherPaneBefore.y)
    expect(
      await shellPage
        .locator('.workspace')
        .evaluate((element) => getComputedStyle(element).backgroundPosition)
    ).toBe(backgroundBefore)

    // Dragging near another frame snaps the edges together and shows guides
    // while the gesture is active. Guides clear on release.
    const snapFirstBefore = await firstCanvasCard.boundingBox()
    const snapSecondBefore = await secondCanvasCard.boundingBox()
    const snapHeader = await secondCanvasCard.locator('.pane-header').boundingBox()
    if (!snapFirstBefore || !snapSecondBefore || !snapHeader) {
      throw new Error('Canvas snap bounds are unavailable')
    }
    const snapDelta = snapFirstBefore.x + snapFirstBefore.width - snapSecondBefore.x + 2
    await shellPage.mouse.move(
      snapHeader.x + snapHeader.width / 2,
      snapHeader.y + snapHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      snapHeader.x + snapHeader.width / 2 + snapDelta,
      snapHeader.y + snapHeader.height / 2 + 2,
      { steps: 8 }
    )
    await expect
      .poll(() => shellPage.locator('.alignment-guide').count())
      .toBeGreaterThan(0)
    await shellPage.mouse.up()
    await expect.poll(() => shellPage.locator('.alignment-guide').count()).toBe(0)
    await waitForVisibleAlignedBounds(app)
    const snapFirstAfter = await firstCanvasCard.boundingBox()
    const snapSecondAfter = await secondCanvasCard.boundingBox()
    if (!snapFirstAfter || !snapSecondAfter) {
      throw new Error('Canvas snapped pane bounds are unavailable')
    }
    expect(Math.abs(snapSecondAfter.x - (snapFirstAfter.x + snapFirstAfter.width))).toBeLessThanOrEqual(1)

    // Website content remains interactive while the label is the drag handle.
    await alicePage.locator('#popup-button').click()
    await expect(alicePage.locator('#output')).toContainText('Popup denied by PaneFlow.')

    // Space temporarily enables the Hand tool and wheel zoom. Zooming out keeps
    // the responsive viewport intact while scaling the native views.
    await shellPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await shellPage.keyboard.down('Space')
    await expect(shellPage.locator('.workspace')).toHaveClass(/canvas-hand/)
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).every((state) => !state.visible))
      .toBe(true)
    const wheelWorkspace = await shellPage.locator('.workspace').boundingBox()
    if (!wheelWorkspace) {
      throw new Error('Canvas wheel workspace is unavailable')
    }
    await shellPage.mouse.move(
      wheelWorkspace.x + wheelWorkspace.width / 2,
      wheelWorkspace.y + wheelWorkspace.height / 2
    )
    await shellPage.mouse.wheel(0, 220)
    await expect.poll(() => zoomPage.locator('#value').textContent()).not.toBe('100%')
    await shellPage.keyboard.up('Space')
    await waitForVisibleAlignedBounds(app)
    const zoomedEmulation = await getEmulationState(app, alicePaneId as string)
    expect(zoomedEmulation?.enabled).toBe(true)
    expect(zoomedEmulation?.scale ?? 1).toBeLessThan(1)
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await waitForVisibleAlignedBounds(app)
    const resetEmulation = await getEmulationState(app, alicePaneId as string)
    expect(resetEmulation?.enabled).toBe(false)

    // Wheel panning must hide native views for the gesture and restore them at
    // the new screen positions; otherwise a moved pane's live content drifts.
    const beforeWheelPan = await firstCanvasCard.boundingBox()
    await shellPage.mouse.move(wheelWorkspace.x + 8, wheelWorkspace.y + 8)
    await shellPage.mouse.wheel(0, 20)
    await waitForVisibleAlignedBounds(app)
    const afterWheelPan = await firstCanvasCard.boundingBox()
    expect(afterWheelPan?.y).not.toBe(beforeWheelPan?.y)

    const canvasBefore = await shellPage.locator('.pane-card').first().boundingBox()
    if (!canvasBefore) {
      throw new Error('Canvas pane bounds are unavailable')
    }
    const canvasWorkspace = await shellPage.locator('.workspace').boundingBox()
    if (!canvasWorkspace) {
      throw new Error('Canvas workspace bounds are unavailable')
    }
    await shellPage.mouse.move(canvasWorkspace.x + 8, canvasWorkspace.y + 8)
    await shellPage.mouse.down()
    await shellPage.mouse.move(canvasWorkspace.x + 88, canvasWorkspace.y + 12, { steps: 6 })
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).every((state) => !state.visible))
      .toBe(true)
    await shellPage.mouse.up()
    await waitForVisibleAlignedBounds(app)
    const canvasAfter = await shellPage.locator('.pane-card').first().boundingBox()
    expect(canvasAfter?.x).not.toBe(canvasBefore.x)
    expect(canvasAfter?.y).not.toBe(canvasBefore.y)

    // Clicking empty minimap space recenters the canvas without making the
    // native views disappear or opening a dialog.
    const minimapBackgroundBefore = await shellPage
      .locator('.workspace')
      .evaluate((element) => getComputedStyle(element).backgroundPosition)
    const minimapMap = await minimapPage.locator('#map').boundingBox()
    if (!minimapMap) {
      throw new Error('Canvas minimap bounds are unavailable')
    }
    await minimapPage.mouse.click(minimapMap.x + 4, minimapMap.y + 4)
    await expect
      .poll(() =>
        shellPage
          .locator('.workspace')
          .evaluate((element) => getComputedStyle(element).backgroundPosition)
      )
      .not.toBe(minimapBackgroundBefore)

    // Fit all from the persistent overview brings every pane back into view.
    await expect(shellPage.getByRole('button', { name: 'Fit all panes to view' })).toBeVisible()
    await minimapPage.getByRole('button', { name: 'Fit all panes' }).click()
    await waitForVisibleAlignedBounds(app)
    const fittedWorkspace = await shellPage.locator('.workspace').boundingBox()
    const fittedCards = await shellPage.locator('.pane-card').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().toJSON())
    )
    if (!fittedWorkspace || fittedCards.length !== 2) {
      throw new Error('Canvas fit-all bounds are unavailable')
    }
    for (const card of fittedCards) {
      expect(card.x).toBeGreaterThanOrEqual(fittedWorkspace.x - 1)
      expect(card.y).toBeGreaterThanOrEqual(fittedWorkspace.y - 1)
      expect(card.x + card.width).toBeLessThanOrEqual(fittedWorkspace.x + fittedWorkspace.width + 1)
      expect(card.y + card.height).toBeLessThanOrEqual(
        fittedWorkspace.y + fittedWorkspace.height + 1
      )
    }

    // The overview collapses to a compact header while remaining available,
    // then restores the map and frames.
    const expandedMinimap = await getMinimapState(app as ElectronApplication)
    if (!expandedMinimap) {
      throw new Error('Expanded minimap state is unavailable')
    }
    await minimapPage.getByRole('button', { name: 'Collapse overview' }).click()
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.collapsed)
      .toBe(true)
    const collapsedMinimap = await getMinimapState(app as ElectronApplication)
    expect(collapsedMinimap?.bounds.height).toBeLessThan(expandedMinimap.bounds.height)
    await expect(minimapPage.locator('#map')).toBeHidden()
    await minimapPage.getByRole('button', { name: 'Expand overview' }).click()
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.collapsed)
      .toBe(false)
    await expect(minimapPage.locator('#map')).toBeVisible()
    await expect(minimapPage.locator('.frame')).toHaveCount(2)

    // The toolbar add control is a quiet plus button that opens the custom
    // device menu. Choosing a device creates a fresh pane with that viewport.
    const addButton = shellPage.locator('.toolbar .add-pane-button')
    expect((await addButton.textContent())?.trim()).toBe('')
    await addButton.click()
    const addMenu = shellPage.getByRole('menu', { name: 'Add pane' })
    await expect(addMenu).toBeVisible()
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).some((state) => !state.visible))
      .toBe(true)
    await expect(addMenu.getByRole('menuitem')).toHaveCount(10)
    await expect(addMenu.locator('.app-menu-section')).toHaveText([
      'New pane',
      'Phones',
      'Tablets',
      'Desktop'
    ])
    await addMenu
      .getByRole('menuitem', { name: /^iPhone 15 Pro\b.*393/ })
      .click()
    await expect(addButton).toHaveAttribute('aria-expanded', 'false')
    const menuAddState = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 3,
      'device pane from the toolbar menu'
    )
    const menuAddedPane = menuAddState.panes.find(
      (pane) => pane.viewport.preset === 'iphone-15-pro'
    )
    expect(menuAddedPane).toBeTruthy()
    await expect(shellPage.locator('.global-pane-bar .viewport-select')).toHaveValue(
      'iphone-15-pro'
    )
    await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.closePane(${JSON.stringify(menuAddedPane?.id)})`
    )
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'device pane from the toolbar menu to close'
    )
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForAlignedBounds(app)

    // Right-click empty canvas opens the custom canvas menu. It can add a pane,
    // toggle the Hand tool, and change appearance without native menus.
    const emptyWorkspace = await shellPage.locator('.workspace').boundingBox()
    if (!emptyWorkspace) {
      throw new Error('Canvas context-menu workspace bounds are unavailable')
    }
    const openCanvasContextMenu = async (): Promise<void> => {
      await shellPage.mouse.click(emptyWorkspace.x + 8, emptyWorkspace.y + 8, {
        button: 'right'
      })
    }

    await openCanvasContextMenu()
    const canvasMenu = shellPage.getByRole('menu', { name: 'Canvas menu' })
    await expect(canvasMenu).toBeVisible()
    await expect(canvasMenu.getByText('View', { exact: true })).toBeVisible()
    await expect(canvasMenu.getByText('Manage', { exact: true })).toBeVisible()
    await expect(canvasMenu.getByText('Appearance', { exact: true })).toBeVisible()
    await canvasMenu.getByRole('menuitem', { name: /^Add pane/ }).click()
    await expect(shellPage.getByRole('menu', { name: 'Add pane' })).toBeVisible()
    await expect(
      shellPage.getByRole('menuitem', { name: /^iPad Pro 12\.9/ })
    ).toBeVisible()
    await shellPage.keyboard.press('Escape')
    await expect(shellPage.locator('.app-menu')).toHaveCount(0)
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).every((state) => state.visible))
      .toBe(true)

    const handTool = shellPage.getByRole('button', { name: 'Hand tool' })
    await openCanvasContextMenu()
    await shellPage.getByRole('menuitemcheckbox', { name: 'Hand tool' }).click()
    await expect(handTool).toHaveAttribute('aria-pressed', 'true')
    await openCanvasContextMenu()
    await shellPage.getByRole('menuitemcheckbox', { name: 'Hand tool' }).click()
    await expect(handTool).toHaveAttribute('aria-pressed', 'false')

    await openCanvasContextMenu()
    await shellPage.getByRole('menuitemradio', { name: 'Light' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.theme === 'light',
      'light theme from the canvas menu'
    )
    await openCanvasContextMenu()
    await shellPage.getByRole('menuitemradio', { name: 'System' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.theme === 'system',
      'system theme from the canvas menu'
    )
    await waitForAlignedBounds(app)

    // Bottom zoom bar: step controls and a percentage dropdown that can set
    // exact levels or run Fit all / Reset.
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForAlignedBounds(app)
    const zoomLabelBeforeStep = await zoomPage.locator('#value').textContent()
    await zoomPage.getByRole('button', { name: 'Zoom out' }).click()
    await expect
      .poll(() => zoomPage.locator('#value').textContent())
      .not.toBe(zoomLabelBeforeStep)
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(true)
    await zoomPage.getByRole('button', { name: 'Choose zoom level' }).click()
    const zoomMenu = shellPage.getByRole('menu', { name: 'Zoom' })
    await expect(zoomMenu).toBeVisible()
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(false)
    await expect(zoomMenu.getByRole('menuitemradio')).toHaveCount(7)
    await zoomMenu.getByRole('menuitemradio', { name: '50%', exact: true }).click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('50%')
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(true)
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')

    // Clicking empty canvas clears the active pane and hides its global bar;
    // clicking a pane restores the selection.
    const deselectWorkspace = await shellPage.locator('.workspace').boundingBox()
    if (!deselectWorkspace) {
      throw new Error('Canvas deselect workspace bounds are unavailable')
    }
    await shellPage.mouse.click(deselectWorkspace.x + 6, deselectWorkspace.y + 6)
    await expect.poll(() => shellPage.locator('.pane-card-active').count()).toBe(0)
    await expect(shellPage.locator('.global-pane-bar')).toHaveCount(0)
    await shellPage.locator('.pane-title').first().click()
    await waitForVisibleAlignedBounds(app)
    await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
    await expect(shellPage.locator('.global-pane-bar')).toBeVisible()

    await handTool.click()
    await expect(handTool).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).every((state) => !state.visible))
      .toBe(true)
    await handTool.click()
    await expect(handTool).toHaveAttribute('aria-pressed', 'false')
    await waitForVisibleAlignedBounds(app)
    await expect(shellPage.locator('.workspace')).toHaveClass(/workspace-canvas/)
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)

    // Per-pane viewport emulation: presets, custom dimensions, validation,
    // independent pane settings, always-fit scaling, and return to responsive
    // sizing. There is intentionally no display-scale selector.
    await focusPane(shellPage, alicePaneId as string)
    const viewportSelect = shellPage.locator('.global-pane-bar .viewport-select')
    await expect(shellPage.locator('.scale-select')).toHaveCount(0)
    const paneMetrics = (paneId: string) =>
      evaluateInPane<{ width: number; height: number; dpr: number }>(
        app as ElectronApplication,
        paneId,
        '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })'
      )
    const aliceMetrics = () => paneMetrics(alicePaneId as string)
    const bobMetrics = () => paneMetrics(bobPaneId as string)

    await viewportSelect.selectOption('mobile')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'mobile',
      'mobile viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 390, height: 844, dpr: 3 })
    const mobileFitEmulation = await getEmulationState(app, alicePaneId as string)
    expect(mobileFitEmulation?.enabled).toBe(true)
    expect(mobileFitEmulation?.scale).toBeGreaterThan(0)
    expect(mobileFitEmulation?.scale).toBeLessThanOrEqual(1)

    // A second pane can hold a different emulated viewport at the same time.
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await focusPane(shellPage, bobPaneId as string)
    await shellPage.locator('.global-pane-bar .viewport-select').selectOption('tablet')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[1]?.viewport.preset === 'tablet',
      'tablet viewport state for the second pane'
    )
    await expect.poll(bobMetrics).toMatchObject({ width: 820, height: 1180, dpr: 2 })
    await expect.poll(aliceMetrics).toMatchObject({ width: 390, height: 844, dpr: 3 })

    // Device presets use their real CSS dimensions and device pixel ratios.
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await focusPane(shellPage, alicePaneId as string)
    const aliceViewportSelect = shellPage.locator('.global-pane-bar .viewport-select')
    await aliceViewportSelect.selectOption('pixel-8')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'pixel-8',
      'Pixel viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 412, height: 915, dpr: 2.625 })
    const pixelEmulation = await getEmulationState(app, alicePaneId as string)
    expect(pixelEmulation?.enabled).toBe(true)
    expect(pixelEmulation?.scale).toBeGreaterThan(0)
    expect(pixelEmulation?.scale).toBeLessThanOrEqual(1)

    await aliceViewportSelect.selectOption('custom')
    const customRow = shellPage.locator('.global-pane-bar .viewport-custom')
    await expect(customRow).toBeVisible()
    await customRow.getByLabel('Custom viewport width').fill('100')
    await customRow.getByLabel('Custom viewport height').fill('700')
    await customRow.getByLabel('Custom device scale factor').fill('2')
    await customRow.getByRole('button', { name: 'Apply' }).click()
    await expect(customRow.getByRole('alert')).toContainText('between 200 and 7680')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'pixel-8',
      'invalid custom viewport to leave the preset unchanged'
    )

    await customRow.getByLabel('Custom viewport width').fill('500')
    await customRow.getByLabel('Custom viewport height').fill('1000')
    await customRow.getByRole('button', { name: 'Apply' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes[0]?.viewport.preset === 'custom' &&
        state.panes[0]?.viewport.width === 500 &&
        state.panes[0]?.viewport.height === 1000,
      'custom viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 500, height: 1000, dpr: 2 })
    const customFitEmulation = await getEmulationState(app, alicePaneId as string)
    expect(customFitEmulation?.enabled).toBe(true)
    expect(customFitEmulation?.scale).toBeGreaterThan(0)
    expect(customFitEmulation?.scale).toBeLessThanOrEqual(1)

    await aliceViewportSelect.selectOption('responsive')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'responsive',
      'responsive viewport state'
    )

    // The other pane keeps its emulated viewport until changed.
    await expect.poll(bobMetrics).toMatchObject({ width: 820, height: 1180, dpr: 2 })
    await focusPane(shellPage, bobPaneId as string)
    await shellPage.locator('.global-pane-bar .viewport-select').selectOption('responsive')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[1]?.viewport.preset === 'responsive',
      'responsive viewport state for the second pane'
    )
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(app)

    // Responsive panes scale their live views through canvas zoom. Returning
    // the canvas to 100% disables device emulation and restores the responsive
    // page viewport to the pane content rectangle.
    const responsiveEmulation = await getEmulationState(app, alicePaneId as string)
    expect(responsiveEmulation?.enabled).toBe(true)
    expect(responsiveEmulation?.scale).toBeGreaterThan(0)
    expect(responsiveEmulation?.scale).toBeLessThanOrEqual(1)
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await expect
      .poll(async () => getEmulationState(app as ElectronApplication, alicePaneId as string))
      .toMatchObject({ enabled: false, scale: 0 })
    await expect
      .poll(async () => {
        const rect = (await readDomPaneRects(app as ElectronApplication)).find(
          (entry) => entry.paneId === alicePaneId
        )
        const metrics = await aliceMetrics()
        return (
          rect !== undefined &&
          Math.abs(metrics.width - rect.rect.width) <= 1 &&
          Math.abs(metrics.height - rect.rect.height) <= 1 &&
          metrics.dpr === shellViewport.dpr
        )
      })
      .toBe(true)

    // Maximize temporarily fills the workspace; unrelated native views hide,
    // and restore returns to the prior canvas geometry.
    const preMaximizeRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!preMaximizeRect) {
      throw new Error('Pre-maximize pane bounds are unavailable')
    }
    await shellPage
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Maximize pane' })
      .click()
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(1)
    await waitForVisibleAlignedBounds(app)
    const maximizedRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!maximizedRect) {
      throw new Error('Maximized pane bounds are unavailable')
    }
    expect(maximizedRect.width).toBeGreaterThan(preMaximizeRect.width + 20)
    expect(maximizedRect.height).toBeGreaterThanOrEqual(preMaximizeRect.height - 1)

    await shellPage
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Restore pane' })
      .click()
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(2)
    await waitForAlignedBounds(app)
    const restoredMaximizeRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!restoredMaximizeRect) {
      throw new Error('Restored maximize pane bounds are unavailable')
    }
    expect(Math.abs(restoredMaximizeRect.x - preMaximizeRect.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(restoredMaximizeRect.width - preMaximizeRect.width)).toBeLessThanOrEqual(2)

    // Application menu commands route through preload to the active pane.
    const duplicateSource = (await getSnapshot(app as ElectronApplication)).panes.find(
      (pane) => pane.id === alicePaneId
    )
    if (!duplicateSource) {
      throw new Error('Duplicate source pane is unavailable')
    }
    const preDuplicateIds = new Set(
      (await getSnapshot(app as ElectronApplication)).panes.map((pane) => pane.id)
    )
    await focusPane(shellPage, alicePaneId as string)
    await clickAppMenuCommand(app, 'pane-duplicate')
    const duplicatedState = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 3,
      'menu duplicate pane'
    )
    const duplicatedPane = duplicatedState.panes.find((pane) => !preDuplicateIds.has(pane.id))
    expect(duplicatedPane?.profileId).toBeTruthy()
    expect(firstProfileIds).not.toContain(duplicatedPane?.profileId)
    expect(duplicatedPane?.url).toBe(duplicateSource.url)
    expect(duplicatedPane?.viewport).toEqual(duplicateSource.viewport)
    await clickAppMenuCommand(app, 'pane-close')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'duplicate pane close'
    )

    // Custom pane titles are edited inline. Invalid or unknown-pane renames
    // are rejected in main, and whitespace around a valid name is normalized.
    const rejectedTitle = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.renamePane(${JSON.stringify(alicePaneId)}, ${JSON.stringify('x'.repeat(81))})`
    )
    expect(rejectedTitle.ok).toBe(false)
    const rejectedUnknownRename = await shellEvaluate<{ ok: boolean }>(
      app,
      "window.paneflow.renamePane('unknown-pane', 'Nope')"
    )
    expect(rejectedUnknownRename.ok).toBe(false)

    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(app)
    const namedAliceCard = shellPage.locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
    await namedAliceCard.locator('.pane-title').dblclick()
    const paneTitleInput = namedAliceCard.locator('.pane-title-input')
    await expect(paneTitleInput).toBeVisible()
    await paneTitleInput.fill('  Alice QA  ')
    await paneTitleInput.press('Enter')
    await expect(namedAliceCard.locator('.pane-title')).toHaveText('Alice QA')
    const titledSnapshot = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => {
        const pane = state.panes.find((entry) => entry.id === alicePaneId)
        return pane?.customTitle === 'Alice QA' && pane.title === 'Alice QA'
      },
      'custom pane title'
    )
    expect(titledSnapshot.panes.find((pane) => pane.id === alicePaneId)?.title).toBe('Alice QA')
    await waitFor(
      () => readPersistedWorkspace(userDataDir),
      (workspace) =>
        workspace?.panes.find((pane) => pane.id === alicePaneId)?.title === 'Alice QA',
      'custom pane title to persist'
    )

    await clickAppMenuCommand(app, 'pane-add')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 3,
      'menu add pane'
    )
    await clickAppMenuCommand(app, 'pane-close')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'menu close pane'
    )

    const paneIdsBeforeDeviceAdd = new Set(
      (await getSnapshot(app as ElectronApplication)).panes.map((pane) => pane.id)
    )
    const rejectedDeviceAdd = await shellEvaluate<{ ok: boolean }>(
      app,
      "window.paneflow.addPaneWithViewport({ preset: 'watch' })"
    )
    expect(rejectedDeviceAdd.ok).toBe(false)
    const deviceAdd = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.addPaneWithViewport(${JSON.stringify({
        preset: 'pixel-8',
        width: 412,
        height: 915,
        deviceScaleFactor: 2.625
      })})`
    )
    expect(deviceAdd.ok).toBe(true)
    const deviceSnapshot = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes.length === 3 &&
        state.panes.some((pane) => !paneIdsBeforeDeviceAdd.has(pane.id)),
      'device pane creation'
    )
    const devicePane = deviceSnapshot.panes.find(
      (pane) => !paneIdsBeforeDeviceAdd.has(pane.id)
    )
    if (!devicePane) {
      throw new Error('Device pane is unavailable')
    }
    expect(devicePane.viewport).toEqual({
      preset: 'pixel-8',
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625
    })
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(app)
    await expect(
      shellPage.locator('.global-pane-bar .viewport-select')
    ).toHaveValue('pixel-8')
    await waitFor(
      () => getEmulationState(app as ElectronApplication, devicePane.id),
      (state) => state?.enabled === true && (state.scale ?? 0) > 0,
      'device pane fit emulation'
    )
    await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.closePane(${JSON.stringify(devicePane.id)})`
    )
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes.length === 2 && !state.panes.some((pane) => pane.id === devicePane.id),
      'device pane cleanup'
    )
    await waitForAlignedBounds(app)

    await clickAppMenuCommand(app, 'pane-maximize')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(1)
    await clickAppMenuCommand(app, 'pane-maximize')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(2)
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForAlignedBounds(app)
    const resolvedTheme = (await getSnapshot(app as ElectronApplication)).resolvedTheme
    expect(['light', 'dark']).toContain(resolvedTheme)
    await expect(shellPage.locator('html')).toHaveAttribute('data-theme', resolvedTheme)
    expect(
      await shellPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      )
    ).toBe(resolvedTheme === 'dark' ? '#171716' : '#f5f5f3')

    // The address chrome is real UI: type and submit in the Canvas global bar,
    // then use its Back button.
    await focusPane(shellPage, alicePaneId as string)
    const firstAddress = shellPage.locator('.global-pane-bar .address-input')
    await firstAddress.fill(`${fixture.url}/other?from=e2e`)
    await firstAddress.press('Enter')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/other?from=e2e') ?? false,
      'address bar navigation'
    )
    await shellPage
      .locator('.global-pane-bar')
      .getByRole('button', { name: 'Go back' })
      .click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/pane/one') ?? false,
      'back navigation'
    )
    expect(bobPage.url()).toContain('/pane/two')

    // Main-process validation rejects unsupported schemes and unknown panes;
    // renderer-side validation alone is not the security boundary.
    const rejectedNavigation = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.navigate(${JSON.stringify(alicePaneId)}, 'javascript:alert(1)')`
    )
    expect(rejectedNavigation.ok).toBe(false)

    const rejectedBounds = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.setPaneBounds([{ paneId: 'unknown-pane', rect: { x: 0, y: 0, width: 400, height: 300 }, visible: true }])`
    )
    expect(rejectedBounds.ok).toBe(false)

    // Address errors are visible in the live status region and Escape recovers.
    const firstInput = shellPage.locator('.global-pane-bar .address-input')
    await firstInput.fill('javascript:alert(1)')
    await firstInput.press('Enter')
    await expect(shellPage.locator('.global-pane-bar .global-pane-status')).toContainText(
      'Only http'
    )
    expect(await firstInput.getAttribute('aria-invalid')).toBe('true')
    await firstInput.press('Escape')
    await expect(firstInput).toHaveValue(`${fixture.url}/pane/one?user=alice`)

    // Resize the native window; shell and browser bounds must realign.
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.setSize(1100, 780)
    })
    await waitFor(
      async () => shellEvaluate<number>(app as ElectronApplication, 'window.innerWidth'),
      (width) => width !== shellViewport.width,
      'window resize to propagate to the shell'
    )
    await waitForAlignedBounds(app)

    // Phase 1 exit criterion: two profiles authenticate independently on the
    // same local origin, with a HttpOnly persistent session per profile.
    await alicePage.goto(`${fixture.url}/login`)
    await bobPage.goto(`${fixture.url}/login`)
    await alicePage.getByRole('button', { name: 'Sign in as Alice' }).click()
    await bobPage.getByRole('button', { name: 'Sign in as Bob' }).click()
    await expect(alicePage.locator('#account-name')).toHaveText('alice')
    await expect(bobPage.locator('#account-name')).toHaveText('bob')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        (state.panes[0]?.url.includes('/account') ?? false) &&
        (state.panes[1]?.url.includes('/account') ?? false),
      'pane URLs after sign-in'
    )

    const aliceAccountText = await alicePage.locator('main').innerText()
    const bobAccountText = await bobPage.locator('main').innerText()
    expect(aliceAccountText).toContain('Signed in as Alice')
    expect(aliceAccountText).not.toContain('Signed in as Bob')
    expect(bobAccountText).toContain('Signed in as Bob')
    expect(bobAccountText).not.toContain('Signed in as Alice')
    expect(await alicePage.evaluate(() => document.cookie)).not.toContain('paneflow_session')
    expect(await bobPage.evaluate(() => document.cookie)).not.toContain('paneflow_session')

    // Signing out of one profile must not affect the other profile.
    await bobPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(bobPage).toHaveURL(/\/login$/)
    await expect(alicePage.locator('#account-name')).toHaveText('alice')
    await bobPage.getByRole('button', { name: 'Sign in as Bob' }).click()
    await expect(bobPage.locator('#account-name')).toHaveText('bob')

    // Close the second pane and verify its native webContents is gone.
    const bobWebContentsId = await app.evaluate((_electron, paneId) => {
      const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
      return hook ? hook.webContentsId(paneId) : null
    }, bobPaneId as string)
    expect(bobWebContentsId).not.toBeNull()

    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(app)
    await shellPage
      .locator('.pane-card')
      .nth(1)
      .getByRole('button', { name: 'Close pane' })
      .click()
    const afterClose = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 1,
      'pane close'
    )
    expect(afterClose.panes[0]?.id).toBe(alicePaneId)

    await expect
      .poll(() => shellPage.evaluate(() => document.activeElement?.className ?? ''))
      .toContain('address-input')
    await waitForAlignedBounds(app)

    const destroyed = await app.evaluate(({ webContents }, id) => {
      const target = id === null ? null : webContents.fromId(id)
      return target === undefined || target === null || target.isDestroyed()
    }, bobWebContentsId)
    expect(destroyed).toBe(true)

    const fixtureWebContentsCount = await app.evaluate(({ webContents }, url) => {
      return webContents
        .getAllWebContents()
        .filter((contents) => !contents.isDestroyed() && contents.getURL().includes(url)).length
    }, fixture.url)
    expect(fixtureWebContentsCount).toBe(1)

    // Remaining pane is untouched by the close, including its authenticated session.
    expect(await readCookie(app, alicePaneId as string)).toContain('alice')
    await expect(alicePage.locator('#account-name')).toHaveText('alice')

    // Add a pane: it must receive a fresh profile and its own native view.
    await shellEvaluate<{ ok: boolean }>(app, 'window.paneflow.addPane()')
    const afterAdd = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'new pane creation'
    )
    const newPane = afterAdd.panes.find((pane) => pane.id !== alicePaneId)
    expect(newPane?.profileId).toBeTruthy()
    expect(firstProfileIds).not.toContain(newPane?.profileId)
    expect(newPane?.url).toBe('about:blank')

    await expect
      .poll(() =>
        shellPage.locator('.pane-card-active').getAttribute('data-pane-id')
      )
      .toBe(newPane?.id)
    await expect
      .poll(() =>
        shellPage.evaluate(() => document.activeElement?.className ?? '')
      )
      .toContain('address-input')
    await waitForAlignedBounds(app)

    // A page can destroy its own webContents. The manager must remove the pane
    // rather than leave a stale control surface whose commands throw.
    const newPaneWebContentsId = await app.evaluate((_electron, paneId) => {
      const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
      return hook ? hook.webContentsId(paneId) : null
    }, newPane?.id as string)
    expect(newPaneWebContentsId).not.toBeNull()
    await app.evaluate(({ webContents }, id) => {
      webContents.fromId(id)?.close()
    }, newPaneWebContentsId as number)
    const afterSelfClose = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 1,
      'self-closed pane removal'
    )
    expect(afterSelfClose.panes[0]?.id).toBe(alicePaneId)

    const aliceProfileId = firstProfileIds[0] as string
    const bobProfileId = firstProfileIds[1] as string
    const remainingAliceCard = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"]`
    )

    // Make the persisted workspace distinctive: an iPhone SE viewport and a
    // horizontal canvas move. The restart must restore both.
    await shellPage.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForAlignedBounds(app)
    await focusPane(shellPage, alicePaneId as string)
    await shellPage.locator('.global-pane-bar .viewport-select').selectOption('iphone-se')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'iphone-se',
      'iPhone SE viewport before restart'
    )

    const canvasBeforeDrag = (await getSnapshot(app as ElectronApplication)).layout.canvas?.[
      alicePaneId as string
    ]
    const canvasHeader = await remainingAliceCard.locator('.pane-title-row').boundingBox()
    if (!canvasHeader || !canvasBeforeDrag) {
      throw new Error('Canvas pane header is unavailable before restart')
    }
    await shellPage.mouse.move(
      canvasHeader.x + 30,
      canvasHeader.y + canvasHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      canvasHeader.x + 130,
      canvasHeader.y + canvasHeader.height / 2,
      { steps: 10 }
    )
    await shellPage.mouse.up()
    await waitForAlignedBounds(app)

    const persisted = await waitFor(
      () => readPersistedWorkspace(userDataDir),
      (workspace) => {
        const position = workspace?.layout.canvas?.[alicePaneId as string]
        return (
          workspace !== null &&
          workspace.panes.length === 1 &&
          workspace.panes[0]?.id === alicePaneId &&
          workspace.panes[0]?.profileId === aliceProfileId &&
          (workspace.panes[0]?.url.includes('/account') ?? false) &&
          workspace.panes[0]?.viewport.preset === 'iphone-se' &&
          workspace.layout.mode === 'canvas' &&
          workspace.layout.gridOrder.length === 1 &&
          position !== undefined &&
          (position.x !== canvasBeforeDrag.x || position.y !== canvasBeforeDrag.y)
        )
      },
      'workspace layout and pane state to persist'
    )
    if (!persisted) {
      throw new Error('Persisted workspace is unavailable')
    }
    const persistedCanvas = persisted.layout.canvas?.[alicePaneId as string]
    if (!persistedCanvas) {
      throw new Error('Persisted canvas position is unavailable')
    }

    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.setBounds({ x: 80, y: 70, width: 1120, height: 820 })
    })
    const savedWindowBounds = await waitFor(
      () => getWindowBounds(app as ElectronApplication),
      (bounds) =>
        bounds.width === 1120 &&
        bounds.height === 820 &&
        Math.abs(bounds.x - 80) <= 2 &&
        Math.abs(bounds.y - 70) <= 2,
      'window bounds to apply'
    )
    await waitFor(
      () => readPersistedAppState(userDataDir),
      (state) =>
        state?.windowBounds !== undefined &&
        state.windowBounds.width === savedWindowBounds.width &&
        state.windowBounds.height === savedWindowBounds.height &&
        Math.abs(state.windowBounds.x - savedWindowBounds.x) <= 1 &&
        Math.abs(state.windowBounds.y - savedWindowBounds.y) <= 1,
      'window bounds to persist'
    )

    await clickAppMenuCommand(app as ElectronApplication, 'theme-dark')
    await waitFor(
      () => readPersistedAppState(userDataDir),
      (state) => state?.theme === 'dark',
      'dark theme preference to persist'
    )
    await expect
      .poll(() =>
        shellEvaluate<string>(
          app as ElectronApplication,
          "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"
        )
      )
      .toBe('#171716')
    await expect
      .poll(() =>
        evaluateInPane<boolean>(
          app as ElectronApplication,
          alicePaneId as string,
          "matchMedia('(prefers-color-scheme: dark)').matches"
        )
      )
      .toBe(true)

    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.maximize()
    })
    await waitFor(
      () =>
        (app as ElectronApplication).evaluate(({ BaseWindow }) => {
          const window = BaseWindow.getAllWindows()[0]
          return window?.isMaximized() ?? false
        }),
      (maximized) => maximized === true,
      'window to maximize'
    )
    await waitFor(
      () => readPersistedAppState(userDataDir),
      (state) => state?.maximized === true,
      'maximized state to persist'
    )

    await app.evaluate(async ({ session }, profileIds) => {
      for (const profileId of profileIds) {
        await session.fromPartition(`persist:paneflow-profile-${profileId}`).cookies.flushStore()
      }
    }, firstProfileIds)

    await app.close()
    app = null

    // Relaunch with the same user data. The workspace, pane identity, profile,
    // URL, viewport, and freeform arrangement must restore before new activity.
    const restartApp = await launchApp(userDataDir, `${fixture.url}/account,${fixture.url}/account`)
    app = restartApp

    await waitFor(
      () => getWindowBounds(restartApp),
      (bounds) =>
        bounds.width === savedWindowBounds.width &&
        bounds.height === savedWindowBounds.height &&
        Math.abs(bounds.x - savedWindowBounds.x) <= 2 &&
        Math.abs(bounds.y - savedWindowBounds.y) <= 2,
      'window bounds to restore'
    )
    await waitFor(
      () =>
        restartApp.evaluate(({ BaseWindow }) => {
          const window = BaseWindow.getAllWindows()[0]
          return window?.isMaximized() ?? false
        }),
      (maximized) => maximized === true,
      'maximized window state to restore'
    )
    await restartApp.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.unmaximize()
    })
    await waitFor(
      () =>
        restartApp.evaluate(({ BaseWindow }) => {
          const window = BaseWindow.getAllWindows()[0]
          return window?.isMaximized() ?? false
        }),
      (maximized) => maximized === false,
      'window to unmaximize'
    )
    await waitFor(
      () => readPersistedAppState(userDataDir),
      (state) => state?.maximized !== true,
      'maximized state to clear'
    )

    const restarted = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.length === 1 &&
        state.panes[0]?.id === alicePaneId &&
        state.panes[0]?.profileId === aliceProfileId &&
        (state.panes[0]?.url.includes('/account') ?? false) &&
        !state.panes[0]?.isLoading &&
        state.panes[0]?.customTitle === 'Alice QA' &&
        state.panes[0]?.title === 'Alice QA' &&
        state.panes[0]?.viewport.preset === 'iphone-se' &&
        state.layout.mode === 'canvas' &&
        state.layout.gridOrder[0] === alicePaneId &&
        state.layout.canvas?.[alicePaneId as string] !== undefined,
      'restored workspace and authenticated pane'
    )
    expect(restarted.panes.map((pane) => pane.profileId)).toEqual([aliceProfileId])
    expect(restarted.panes[0]?.url).toContain('/account')
    expect(await restartApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
    await expect
      .poll(() =>
        shellEvaluate<string>(
          restartApp,
          "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"
        )
      )
      .toBe('#171716')
    await expect
      .poll(() =>
        evaluateInPane<boolean>(
          restartApp,
          restarted.panes[0]?.id as string,
          "matchMedia('(prefers-color-scheme: dark)').matches"
        )
      )
      .toBe(true)
    await clickAppMenuCommand(restartApp, 'theme-system')
    await waitFor(
      () => readPersistedAppState(userDataDir),
      (state) => state?.theme === 'system',
      'theme preference reset to system'
    )

    const restartedAliceText = await readPaneBodyText(
      restartApp,
      restarted.panes[0]?.id as string
    )
    expect(restartedAliceText).toContain('Signed in as Alice')
    expect(restartedAliceText).not.toContain('Signed in as Bob')

    expect(
      await evaluateInPane<string | null>(
        restartApp,
        restarted.panes[0]?.id as string,
        "localStorage.getItem('paneflow_fixture')"
      )
    ).toBe(aliceStorageBeforeRestart)

    expect(await readCookie(restartApp, restarted.panes[0]?.id as string)).toContain(
      'paneflow_user=alice'
    )

    // The closed Bob pane's profile was retained. Its persistent partition must
    // still hold the isolated Bob cookies even though no pane references it.
    const bobProfileCookies = await restartApp.evaluate(
      async ({ session }, args) => {
        const cookies = await session
          .fromPartition(`persist:paneflow-profile-${args.profileId}`)
          .cookies.get({ url: args.url })
        return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
      },
      { profileId: bobProfileId, url: fixture.url }
    )
    expect(bobProfileCookies).toContain('paneflow_user=bob')
    expect(bobProfileCookies).toContain('paneflow_session=')

    const restartedLayout = await waitFor(
      async () => restartApp.windows(),
      (windows) => windows.some((page) => isShellPage(page.url())),
      'restarted shell page'
    )
    const restartShell = restartedLayout.find((page) => isShellPage(page.url()))
    if (!restartShell) {
      throw new Error('Restarted shell page is unavailable')
    }

    await restartShell.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(restartApp)
    const restartedAliceCard = restartShell.locator(
      `.pane-card[data-pane-id="${alicePaneId}"]`
    )
    await expect(restartedAliceCard.locator('.pane-title')).toHaveText('Alice QA')
    await restartedAliceCard.locator('.pane-title').dblclick()
    const restartedTitleInput = restartedAliceCard.locator('.pane-title-input')
    await expect(restartedTitleInput).toBeVisible()
    await restartedTitleInput.fill('')
    await restartedTitleInput.press('Enter')
    await expect(restartedAliceCard.locator('.pane-title')).toHaveText('Signed in as Alice')
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes[0]?.customTitle === null && state.panes[0]?.title === 'Signed in as Alice',
      'pane title reset to the page title'
    )
    await waitFor(
      () => readPersistedWorkspace(userDataDir),
      (workspace) =>
        workspace?.panes.find((pane) => pane.id === alicePaneId)?.title === undefined,
      'custom pane title to clear from persistence'
    )

    await expect(restartShell.locator('.workspace')).toHaveClass(/workspace-canvas/)
    expect(restarted.layout.canvas?.[alicePaneId as string]).toEqual(persistedCanvas)
    await expect
      .poll(async () =>
        evaluateInPane<{ width: number; height: number; dpr: number }>(
          restartApp,
          alicePaneId as string,
          '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })'
        )
      )
      .toMatchObject({ width: 375, height: 667, dpr: 2 })

    // Continue the workspace tests from a responsive Canvas pane.
    await focusPane(restartShell, alicePaneId as string)
    await restartShell.locator('.global-pane-bar .viewport-select').selectOption('responsive')
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes[0]?.viewport.preset === 'responsive',
      'responsive viewport after restart verification'
    )
    await restartShell.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(restartApp)

    // Profile manager: usage, rename, clear, and safe delete.
    await restartShell
      .locator('.toolbar')
      .getByRole('button', { name: 'Profiles' })
      .click()
    const profilesDialog = restartShell.getByRole('dialog', { name: 'Browser profiles' })
    await expect(profilesDialog).toBeVisible()
    await expect
      .poll(async () => (await getViewStates(restartApp)).filter((state) => state.visible).length)
      .toBe(0)

    const aliceProfileRow = profilesDialog.locator(
      `.profile-row[data-profile-id="${aliceProfileId}"]`
    )
    const bobProfileRow = profilesDialog.locator(
      `.profile-row[data-profile-id="${bobProfileId}"]`
    )
    await expect(aliceProfileRow).toContainText('In use by')
    await expect(aliceProfileRow.getByRole('button', { name: /^Clear/ })).toBeEnabled()
    await expect(aliceProfileRow.getByRole('button', { name: /^Delete/ })).toBeEnabled()
    await expect(bobProfileRow).toContainText('Unused')
    await expect(bobProfileRow.getByRole('button', { name: /^Clear/ })).toBeEnabled()

    await bobProfileRow.getByRole('button', { name: /^Rename/ }).click()
    const renameInput = bobProfileRow.getByLabel('Profile name')
    await expect(renameInput).toHaveValue('Profile 2')
    await renameInput.fill('Bob QA')
    await bobProfileRow.getByRole('button', { name: 'Save' }).click()
    await expect(bobProfileRow.locator('.profile-label')).toHaveText('Bob QA')
    await expect
      .poll(async () => (await readPersistedProfiles(userDataDir)).find((p) => p.id === bobProfileId)?.label)
      .toBe('Bob QA')

    await bobProfileRow.getByRole('button', { name: /^Clear/ }).click()
    await expect(
      bobProfileRow.getByRole('group', { name: /Confirm clear/ })
    ).toContainText('Clear cookies')
    await bobProfileRow.getByRole('button', { name: 'Clear data' }).click()
    const fixtureUrl = (fixture as FixtureServer).url
    await expect
      .poll(async () => {
        const cookies = await restartApp.evaluate(
          async ({ session }, args) => {
            return session
              .fromPartition(`persist:paneflow-profile-${args.profileId}`)
              .cookies.get({ url: args.url })
          },
          { profileId: bobProfileId, url: fixtureUrl }
        )
        return cookies.length
      })
      .toBe(0)
    await expect(profilesDialog.getByRole('status')).toContainText('Cleared browser data')

    await bobProfileRow.getByRole('button', { name: /^Delete/ }).click()
    await bobProfileRow.getByRole('button', { name: 'Delete profile', exact: true }).click()
    await expect(bobProfileRow).toHaveCount(0)
    await expect(profilesDialog.getByRole('status')).toContainText('Deleted profile')
    await expect
      .poll(async () => (await readPersistedProfiles(userDataDir)).some((p) => p.id === bobProfileId))
      .toBe(false)

    // Explicitly share an existing profile across two new panes.
    const sharedProfileId = newPane?.profileId
    expect(sharedProfileId).toBeTruthy()
    expect(sharedProfileId).not.toBe(aliceProfileId)

    const sharedProfileRow = profilesDialog.locator(
      `.profile-row[data-profile-id="${sharedProfileId}"]`
    )
    await sharedProfileRow.getByRole('button', { name: /^Open pane/ }).click()
    await expect(profilesDialog).toHaveCount(0)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.filter((pane) => pane.profileId === sharedProfileId).length === 1,
      'first shared-profile pane'
    )

    await restartShell.locator('.toolbar').getByRole('button', { name: 'Profiles' }).click()
    await sharedProfileRow.getByRole('button', { name: /^Open pane/ }).click()
    await expect(profilesDialog).toHaveCount(0)
    const sharedState = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.filter((pane) => pane.profileId === sharedProfileId).length === 2,
      'second shared-profile pane'
    )
    const sharedPanes = sharedState.panes.filter((pane) => pane.profileId === sharedProfileId)
    expect(new Set(sharedPanes.map((pane) => pane.id)).size).toBe(2)
    for (const pane of sharedPanes) {
      await expect(
        restartShell.locator(`.pane-card[data-pane-id="${pane.id}"] .pane-profile`)
      ).toContainText('2 panes')
    }

    await restartShell.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(restartApp)
    for (const [index, pane] of sharedPanes.entries()) {
      await setPaneAddress(restartShell, pane.id, `${fixture.url}/pane/shared?slot=${index}`)
    }
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        sharedPanes.every((pane) => {
          const current = state.panes.find((entry) => entry.id === pane.id)
          return current?.url.includes('/pane/shared') && !current.isLoading
        }),
      'shared panes to navigate'
    )
    await evaluateInPane(
      restartApp,
      sharedPanes[0]?.id as string,
      "localStorage.setItem('paneflow_shared_probe', 'shared')"
    )
    expect(
      await evaluateInPane<string | null>(
        restartApp,
        sharedPanes[1]?.id as string,
        "localStorage.getItem('paneflow_shared_probe')"
      )
    ).toBe('shared')

    await restartShell.locator('.toolbar').getByRole('button', { name: 'Profiles' }).click()
    await expect(sharedProfileRow).toContainText('2 panes:')
    await expect(sharedProfileRow.getByRole('button', { name: /^Clear/ })).toBeEnabled()
    await expect(sharedProfileRow.getByRole('button', { name: /^Delete/ })).toBeEnabled()
    await sharedProfileRow.getByRole('button', { name: /^Delete/ }).click()
    await expect(
      sharedProfileRow.getByRole('group', { name: /Confirm delete/ })
    ).toContainText('Close 2 panes')
    await sharedProfileRow.getByRole('button', { name: 'Close panes & delete' }).click()
    await expect(sharedProfileRow).toHaveCount(0)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 1 && state.panes[0]?.id === alicePaneId,
      'shared panes closed with profile delete'
    )
    await expect(profilesDialog.getByRole('status')).toContainText('Closed its panes')
    await profilesDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(profilesDialog).toHaveCount(0)
    await waitForAlignedBounds(restartApp)

    // Workspace management: create, switch, rename, duplicate, and delete.
    const originalWorkspaceId = (await getSnapshot(restartApp)).workspace.id
    expect(await readAppMenuItem(restartApp, 'workspace-next')).toEqual({
      id: 'workspace-next',
      accelerator: 'CmdOrCtrl+Shift+]',
      enabled: false
    })
    expect(await readAppMenuItem(restartApp, 'workspace-previous')).toEqual({
      id: 'workspace-previous',
      accelerator: 'CmdOrCtrl+Shift+[',
      enabled: false
    })
    await restartShell.locator('.workspace-switcher').click()
    const workspacesDialog = restartShell.getByRole('dialog', { name: 'Workspaces' })
    await expect(workspacesDialog).toBeVisible()
    await expect
      .poll(async () => (await getViewStates(restartApp)).filter((state) => state.visible).length)
      .toBe(0)
    const originalWorkspaceRow = workspacesDialog.locator(
      `.workspace-row[data-workspace-id="${originalWorkspaceId}"]`
    )
    await expect(originalWorkspaceRow).toContainText('Active')
    await expect(originalWorkspaceRow).toContainText('1 pane')

    const workspaceIdByName = async (name: string): Promise<string> => {
      const result = await shellEvaluate<{
        ok: boolean
        workspaces?: Array<{ id: string; name: string }>
      }>(restartApp, 'window.paneflow.listWorkspaces()')
      const id = result.ok ? result.workspaces?.find((workspace) => workspace.name === name)?.id : null
      if (!id) {
        throw new Error(`Workspace ${name} is unavailable`)
      }
      return id
    }
    const workspaceRowById = (id: string) =>
      workspacesDialog.locator(`.workspace-row[data-workspace-id="${id}"]`)

    await workspacesDialog.getByLabel('New workspace name').fill('Second Workspace')
    await workspacesDialog.getByRole('button', { name: 'Create' }).click()
    const secondWorkspaceId = await waitFor(
      () => workspaceIdByName('Second Workspace').catch(() => ''),
      (id) => id.length > 0,
      'second workspace creation'
    )
    const secondWorkspaceRow = workspaceRowById(secondWorkspaceId)
    await expect(secondWorkspaceRow).toHaveCount(1)
    await expect(secondWorkspaceRow).toContainText('0 panes')
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-next'))?.enabled)
      .toBe(true)
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-previous'))?.enabled)
      .toBe(true)

    await secondWorkspaceRow.getByRole('button', { name: /^Switch/ }).click()
    await expect(workspacesDialog).toHaveCount(0)
    await expect(restartShell.locator('.workspace-switcher')).toContainText('Second Workspace')
    await expect(restartShell.locator('.empty-state')).toBeVisible()
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.name === 'Second Workspace' && state.panes.length === 0,
      'second workspace to become active'
    )

    await shellEvaluate<{ ok: boolean }>(restartApp, 'window.paneflow.addPane()')
    const populatedSecond = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.name === 'Second Workspace' && state.panes.length === 1,
      'pane in the second workspace'
    )
    const secondPane = populatedSecond.panes[0]
    expect(secondPane).toBeTruthy()

    await restartShell.locator('.workspace-switcher').click()
    await expect(workspacesDialog).toBeVisible()
    const renamedWorkspaceRow = workspaceRowById(secondWorkspaceId)
    await renamedWorkspaceRow.getByRole('button', { name: /^Rename/ }).click()
    await renamedWorkspaceRow.getByLabel('Workspace name').fill('Responsive QA')
    await renamedWorkspaceRow.getByRole('button', { name: 'Save' }).click()
    await expect(renamedWorkspaceRow.locator('.workspace-label-text')).toHaveText('Responsive QA')
    await workspacesDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(restartShell.locator('.workspace-switcher')).toContainText('Responsive QA')

    await restartShell.locator('.workspace-switcher').click()
    await expect(workspacesDialog).toBeVisible()
    await workspaceRowById(secondWorkspaceId)
      .getByRole('button', { name: /^Duplicate/ })
      .click()
    const copyWorkspaceId = await waitFor(
      () => workspaceIdByName('Responsive QA copy').catch(() => ''),
      (id) => id.length > 0,
      'workspace duplicate'
    )
    await expect(workspaceRowById(copyWorkspaceId)).toHaveCount(1)
    await expect(workspaceRowById(copyWorkspaceId)).toContainText('1 pane')
    await workspacesDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(workspacesDialog).toHaveCount(0)

    // Native Workspace menu shortcuts cycle in name order and restore the
    // target workspace's panes. Both items re-enable after each switch.
    const expectWorkspaceMenuEnabled = async (enabled: boolean): Promise<void> => {
      await expect
        .poll(async () => (await readAppMenuItem(restartApp, 'workspace-next'))?.enabled)
        .toBe(enabled)
      await expect
        .poll(async () => (await readAppMenuItem(restartApp, 'workspace-previous'))?.enabled)
        .toBe(enabled)
    }
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-next')
    const copyActivated = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.id === copyWorkspaceId && state.panes.length === 1,
      'copy workspace activation from the menu'
    )
    const copyPane = copyActivated.panes[0]
    expect(copyPane).toBeTruthy()
    expect(copyPane?.id).not.toBe(secondPane?.id)
    expect(copyPane?.profileId).not.toBe(secondPane?.profileId)
    expect(copyPane?.url).toBe(secondPane?.url)
    expect(copyPane?.id ? copyActivated.layout.canvas?.[copyPane.id] : null).toBeTruthy()
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-next')
    const originalViaMenu = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === originalWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === alicePaneId &&
        state.panes[0]?.profileId === aliceProfileId &&
        (state.panes[0]?.url.includes('/account') ?? false),
      'original workspace activation from the menu'
    )
    expect(originalViaMenu.panes[0]?.id).toBe(alicePaneId)
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-previous')
    const copyRestored = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === copyWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === copyPane?.id,
      'copy workspace restore from the menu'
    )
    expect(copyRestored.panes[0]?.url).toBe(secondPane?.url)
    await waitForAlignedBounds(restartApp)
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-previous')
    const secondRestored = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === secondWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === secondPane?.id,
      'second workspace restore from the menu'
    )
    expect(secondRestored.panes[0]?.profileId).toBe(secondPane?.profileId)
    expect(secondRestored.panes[0]?.url).toBe(secondPane?.url)
    await waitForAlignedBounds(restartApp)
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-previous')
    const wrappedOriginal = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === originalWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === alicePaneId,
      'workspace previous wraparound'
    )
    expect(wrappedOriginal.panes[0]?.profileId).toBe(aliceProfileId)
    await waitForAlignedBounds(restartApp)
    await expectWorkspaceMenuEnabled(true)

    await clickAppMenuCommand(restartApp, 'workspace-next')
    const wrappedSecond = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === secondWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === secondPane?.id,
      'workspace next wraparound'
    )
    expect(wrappedSecond.panes[0]?.id).toBe(secondPane?.id)
    await waitForAlignedBounds(restartApp)
    await expectWorkspaceMenuEnabled(true)

    await restartShell.locator('.workspace-switcher').click()
    await expect(workspacesDialog).toBeVisible()
    await originalWorkspaceRow.getByRole('button', { name: /^Switch/ }).click()
    await expect(workspacesDialog).toHaveCount(0)
    await expect(restartShell.locator('.workspace-switcher')).toContainText('Workspace')
    const restoredOriginal = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.workspace.id === originalWorkspaceId &&
        state.panes.length === 1 &&
        state.panes[0]?.id === alicePaneId &&
        (state.panes[0]?.url.includes('/account') ?? false),
      'original workspace restore'
    )
    expect(restoredOriginal.panes[0]?.profileId).toBe(aliceProfileId)
    await waitForAlignedBounds(restartApp)
    await expect
      .poll(async () => (await readPersistedAppState(userDataDir))?.activeWorkspaceId)
      .toBe(originalWorkspaceId)

    await restartShell.locator('.workspace-switcher').click()
    await expect(workspacesDialog).toBeVisible()
    for (const id of [copyWorkspaceId, secondWorkspaceId]) {
      const row = workspaceRowById(id)
      await row.getByRole('button', { name: /^Delete workspace/ }).click()
      await row.getByRole('button', { name: 'Delete workspace', exact: true }).click()
      await expect(row).toHaveCount(0)
    }
    await expect(workspacesDialog.locator('.workspace-row')).toHaveCount(1)
    await workspacesDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect(workspacesDialog).toHaveCount(0)
    await waitForAlignedBounds(restartApp)
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-next'))?.enabled)
      .toBe(false)
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-previous'))?.enabled)
      .toBe(false)

    // Repeated workspace switching and pane churn must not leak webContents
    // or native views.
    const baselineWebContents = await getWebContentsCount(restartApp)
    const baselineWorkingSetMb = await getWorkingSetMb(restartApp)
    expect(
      await shellEvaluate<{ ok: boolean; error?: string }>(
        restartApp,
        "window.paneflow.createWorkspace('Stress Workspace')"
      )
    ).toMatchObject({ ok: true })
    const stressWorkspaceId = await waitFor(
      () => workspaceIdByName('Stress Workspace').catch(() => ''),
      (id) => id.length > 0,
      'stress workspace creation'
    )
    await shellEvaluate(restartApp, `window.paneflow.switchWorkspace(${JSON.stringify(stressWorkspaceId)})`)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.id === stressWorkspaceId && state.panes.length === 0,
      'stress workspace activation'
    )
    for (let count = 1; count <= 4; count += 1) {
      await shellEvaluate(restartApp, 'window.paneflow.addPane()')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.workspace.id === stressWorkspaceId && state.panes.length === count,
        `${count} stress panes`
      )
    }
    expect(await getViewStates(restartApp)).toHaveLength(4)

    await shellEvaluate(
      restartApp,
      `window.paneflow.switchWorkspace(${JSON.stringify(originalWorkspaceId)})`
    )
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.id === originalWorkspaceId && state.panes.length === 1,
      'original workspace after stress pane creation'
    )
    await waitForAlignedBounds(restartApp)
    await waitFor(
      () => getWebContentsCount(restartApp),
      (count) => count === baselineWebContents,
      'webContents cleanup after stress pane teardown'
    )

    const stressCycles = Number.parseInt(process.env.PANEFLOW_STRESS_CYCLES ?? '3', 10) || 3
    for (let cycle = 0; cycle < stressCycles; cycle += 1) {
      await shellEvaluate(
        restartApp,
        `window.paneflow.switchWorkspace(${JSON.stringify(stressWorkspaceId)})`
      )
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.workspace.id === stressWorkspaceId && state.panes.length === 4,
        `stress workspace cycle ${cycle + 1}`
      )
      expect(await getViewStates(restartApp)).toHaveLength(4)

      await shellEvaluate(
        restartApp,
        `window.paneflow.switchWorkspace(${JSON.stringify(originalWorkspaceId)})`
      )
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.workspace.id === originalWorkspaceId && state.panes.length === 1,
        `original workspace cycle ${cycle + 1}`
      )
      await waitForAlignedBounds(restartApp)
      expect(await getViewStates(restartApp)).toHaveLength(1)
      await waitFor(
        () => getWebContentsCount(restartApp),
        (count) => count === baselineWebContents,
        `webContents cleanup after cycle ${cycle + 1}`
      )
    }

    const finalWorkingSetMb = await getWorkingSetMb(restartApp)
    console.log(
      `[soak] cycles=${stressCycles} webContents=${baselineWebContents} workingSetMb=${baselineWorkingSetMb}->${finalWorkingSetMb}`
    )

    expect(
      await shellEvaluate<{ ok: boolean; error?: string }>(
        restartApp,
        `window.paneflow.deleteWorkspace(${JSON.stringify(stressWorkspaceId)})`
      )
    ).toMatchObject({ ok: true })

    // Canvas stress: grow to eight panes, keep every card in the layout, then
    // close back to the original pane without leaking native views.
    await waitFor(
      async () => restartApp.windows(),
      (windows) => windows.some((page) => isShellPage(page.url())),
      'restarted shell page'
    )

    for (const expectedCount of [2, 3, 4]) {
      await shellEvaluate<{ ok: boolean }>(restartApp, 'window.paneflow.addPane()')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.panes.length === expectedCount,
        `${expectedCount} panes after restart additions`
      )
    }
    const fourPanes = await getSnapshot(restartApp)
    for (const [offset, path] of ['/pane/three', '/pane/four'].entries()) {
      const pane = fourPanes.panes[2 + offset]
      if (!pane) {
        throw new Error('Added Canvas pane is unavailable')
      }
      await shellEvaluate<{ ok: boolean }>(
        restartApp,
        `window.paneflow.navigate(${JSON.stringify(pane.id)}, ${JSON.stringify(
          `${fixture.url}${path}`
        )})`
      )
    }
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.slice(2).every((pane) => pane.url.includes('/pane/') && !pane.isLoading),
      'new panes to load'
    )
    expect(await readPaneCardRects(restartShell)).toHaveLength(4)

    for (let count = 5; count <= 8; count += 1) {
      await shellEvaluate<{ ok: boolean }>(restartApp, 'window.paneflow.addPane()')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.panes.length === count,
        `${count} panes in the Canvas stress workspace`
      )
    }
    expect(await readPaneCardRects(restartShell)).toHaveLength(8)
    expect(await getViewStates(restartApp)).toHaveLength(8)

    const stressPanesToClose = (await getSnapshot(restartApp)).panes.slice(2)
    for (const pane of stressPanesToClose) {
      await shellEvaluate<{ ok: boolean }>(
        restartApp,
        `window.paneflow.closePane(${JSON.stringify(pane.id)})`
      )
    }
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 2,
      'Canvas stress panes to close'
    )
    await restartShell.getByRole('button', { name: 'Fit all panes to view' }).click()
    await waitForVisibleAlignedBounds(restartApp)

    // The active pane is visible in chrome and exposed to assistive tech.
    await expect(restartShell.locator('.pane-card-active')).toHaveCount(1)
    const secondPaneId = (await getSnapshot(restartApp)).panes[1]?.id
    expect(secondPaneId).toBeTruthy()
    await focusPane(restartShell, secondPaneId as string)
    await expect(
      restartShell.locator(`.pane-card[data-pane-id="${secondPaneId}"]`)
    ).toHaveAttribute('aria-current', 'true')
  } finally {
    if (app) {
      await app.close().catch(() => undefined)
    }
    if (fixture) {
      await fixture.close().catch(() => undefined)
    }
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
})
