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
import {
  CANVAS_GAP,
  CANVAS_ORIGIN,
  canvasFrameSize
} from '../../src/shared/canvas'
import { IPC_CHANNELS, type PaneViewRect, type ShellState } from '../../src/shared/ipc'
import {
  SHELL_ENTRY_URL,
  SHELL_MINIMAP_URL,
  SHELL_ZOOM_URL
} from '../../src/shared/shell'
import { CANVAS_ZOOM_BAR_WIDTH } from '../../src/shared/zoom'
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
  env.BROWSERDECK_TEST = '1'
  env.BROWSERDECK_USER_DATA_DIR = userDataDir
  env.BROWSERDECK_START_URLS = startUrls
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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

async function selectViewportPreset(shellPage: Page, preset: string): Promise<void> {
  await shellPage.locator('.pane-card-active .pane-viewport-trigger').click()
  const menu = shellPage.getByRole('menu', { name: 'Viewport preset' })
  await expect(menu).toBeVisible()
  await menu.locator(`[data-menu-item-id="viewport:${preset}"]`).click()
  await expect(menu).toHaveCount(0)
}

async function fitAllDevices(app: ElectronApplication): Promise<void> {
  const minimap = app
    .windows()
    .find((page) => page.url() === SHELL_MINIMAP_URL)
  if (!minimap) {
    throw new Error('Canvas overview is unavailable')
  }
  await minimap.getByRole('button', { name: 'Fit all browsers' }).click()
}

async function getMinimapState(app: ElectronApplication): Promise<{
  visible: boolean
  bounds: PaneViewRect
  loaded: boolean
  collapsed: boolean
} | null> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
      throw new Error('BrowserDeck window is unavailable')
    }
    return window.getNormalBounds()
  })
}

async function getContentBounds(app: ElectronApplication): Promise<PaneViewRect> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
      const request = indexedDB.open('browserdeck-fixture', 1)
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
      const request = indexedDB.open('browserdeck-fixture', 1)
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    userDataDir = await mkdtemp(join(tmpdir(), 'browserdeck-e2e-'))
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
      script.textContent = 'window.__browserdeckCspInline = true'
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
          (window as unknown as { __browserdeckCspInline?: boolean }).__browserdeckCspInline
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
        (alice ?? '').includes('browserdeck_user=alice') &&
        (bob ?? '').includes('browserdeck_user=bob'),
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
        [typeof (window as unknown as { browserdeck?: unknown }).browserdeck, typeof require, typeof process].join(',')
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
    // Native page pointer events must remain real browser interactions.
    const selectableHeading = alicePage.locator('h1').first()
    const selectionBox = await selectableHeading.boundingBox()
    if (!selectionBox) {
      throw new Error('Native selection heading is unavailable')
    }
    await alicePage.mouse.move(selectionBox.x + 2, selectionBox.y + selectionBox.height / 2)
    await alicePage.mouse.down()
    await alicePage.mouse.move(
      selectionBox.x + selectionBox.width - 2,
      selectionBox.y + selectionBox.height / 2,
      { steps: 8 }
    )
    await alicePage.mouse.up()
    expect(await alicePage.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(
      'Pane one'
    )
    await alicePage.evaluate(() => window.getSelection()?.removeAllRanges())

    await alicePage.locator('#storage-button').click()
    await expect
      .poll(() => alicePage.evaluate(() => localStorage.getItem('browserdeck_fixture')))
      .not.toBeNull()
    const aliceStorageBeforeRestart = await alicePage.evaluate(() =>
      localStorage.getItem('browserdeck_fixture')
    )
    expect(aliceStorageBeforeRestart).not.toBeNull()
    expect(await bobPage.evaluate(() => localStorage.getItem('browserdeck_fixture'))).toBeNull()

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
        throw new Error('BrowserDeck window is unavailable')
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
      controlsLeft: element.querySelector('.add-pane-button')?.getBoundingClientRect().left ?? 0
    }))
    expect(toolbarChrome.region).toBe('drag')
    expect(toolbarChrome.left).toBe(0)
    expect(toolbarChrome.controlsLeft).toBeGreaterThanOrEqual(76)

    const aliceDomRect = (await readDomPaneRects(app)).find((entry) => entry.paneId === alicePaneId)
    const aliceViewport = await alicePage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    const aliceZoom = await shellPage
      .locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
      .evaluate((element) => Number(getComputedStyle(element).getPropertyValue('--pane-zoom')))
    expect(aliceDomRect).toBeTruthy()
    expect(aliceZoom).toBeGreaterThan(0)
    expect(
      Math.abs(aliceViewport.width * aliceZoom - (aliceDomRect?.rect.width ?? 0))
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(aliceViewport.height * aliceZoom - (aliceDomRect?.rect.height ?? 0))
    ).toBeLessThanOrEqual(1)

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
    expect(startupZoom.bounds.width).toBe(CANVAS_ZOOM_BAR_WIDTH)
    expect(startupZoom.bounds.height).toBe(40)
    expect(startupZoom.bounds.x + startupZoom.bounds.width / 2).toBe(
      Math.round(initialContentBounds.width / 2)
    )
    expect(startupZoom.bounds.y + startupZoom.bounds.height).toBe(
      initialContentBounds.height - 12
    )
    await expect(zoomPage.locator('#value')).toContainText('%')
    const toolbarBorders = await shellPage.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.toolbar button:not(.viewport-select)')
      ).map((button) => getComputedStyle(button).borderTopWidth)
    )
    expect(toolbarBorders.filter((width) => width !== '0px')).toEqual([])
    await expect(shellPage.locator('.pane-card-active .address-input')).toBeVisible()
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

    // Cmd/Ctrl+K opens a searchable device palette. The trusted overlay hides
    // native views and both Canvas overlays while it is open.
    expect(await readAppMenuItem(app, 'pane-find')).toEqual({
      id: 'pane-find',
      accelerator: 'CmdOrCtrl+K',
      enabled: true
    })
    const findDeviceButton = zoomPage.getByRole('button', {
      name: 'Find browser',
      exact: true
    })
    await expect(findDeviceButton).toHaveAttribute('title', 'Find browser (Cmd/Ctrl+K)')
    await clickAppMenuCommand(app, 'pane-find')
    const devicePalette = shellPage.getByRole('dialog', { name: 'Find browser' })
    await expect(devicePalette).toBeVisible()
    const devicePaletteInput = devicePalette.getByRole('combobox', {
      name: 'Find browser'
    })
    await expect(devicePaletteInput).toBeFocused()
    await expect(devicePalette.getByRole('option')).toHaveCount(2)
    await expect(
      devicePalette.getByRole('option').first().locator('.device-palette-viewport')
    ).toHaveText('Responsive')
    await expect(
      devicePalette.getByRole('option').first().locator('.device-palette-detail')
    ).toContainText('127.0.0.1')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).every((state) => !state.visible))
      .toBe(true)
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(false)
    await expect
      .poll(async () => (await getZoomState(app as ElectronApplication))?.visible)
      .toBe(false)

    await devicePaletteInput.fill('Responsive')
    await expect(devicePalette.getByRole('option')).toHaveCount(2)
    await expect(
      devicePalette.getByRole('option').first().locator('.device-palette-viewport mark')
    ).toHaveText('Responsive')
    await devicePaletteInput.fill('Pane two')
    await expect(devicePalette.getByRole('option')).toHaveCount(1)
    await expect(devicePalette.locator('.device-palette-title mark')).toHaveText('Pane two')
    await devicePaletteInput.press('Enter')
    await expect(devicePalette).toHaveCount(0)
    await expect(shellPage.locator('.pane-card-active')).toHaveAttribute(
      'data-pane-id',
      bobPaneId as string
    )
    await expect
      .poll(() =>
        shellPage.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      )
      .toMatch(/^Address for browser /)
    await waitForVisibleAlignedBounds(app)
    await expect
      .poll(async () =>
        (await getViewStates(app as ElectronApplication)).some(
          (state) => state.paneId === bobPaneId && state.visible
        )
      )
      .toBe(true)
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)

    await findDeviceButton.click()
    await expect(devicePalette).toBeVisible()
    await devicePaletteInput.fill('no-such-device')
    await expect(devicePalette.getByText('No matching browsers.')).toBeVisible()
    await devicePaletteInput.press('Escape')
    await expect(devicePalette).toHaveCount(0)
    await expect
      .poll(() =>
        shellPage.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      )
      .toMatch(/^Address for browser /)
    await waitForVisibleAlignedBounds(app)

    // Device actions use the same custom menu component as the + menu, not a
    // native popup. The menu hides the native views it covers.
    const customMenuCard = shellPage.locator(`.pane-card[data-pane-id="${bobPaneId}"]`)
    const deviceActionsTrigger = customMenuCard.getByRole('button', {
      name: 'Browser actions'
    })
    await deviceActionsTrigger.click()
    const paneActionsMenu = shellPage.getByRole('menu', { name: 'Browser actions' })
    await expect(paneActionsMenu).toBeVisible()
    await expect(paneActionsMenu).toHaveClass(/app-menu/)
    await expect(paneActionsMenu.locator('.app-menu-section')).toHaveText([
      'Navigate',
      'Viewport',
      'Manage'
    ])
    await expect(paneActionsMenu.getByRole('menuitem')).toHaveCount(12)
    for (const name of [
      'Back',
      'Forward',
      'Reload',
      'Copy URL',
      'Open in Browser',
      'Rotate Viewport',
      'Capture Screenshot…',
      'Duplicate Browser',
      'Rename Browser…',
      'Clear Site Data…',
      'Open DevTools',
      'Close Browser'
    ]) {
      await expect(paneActionsMenu.getByRole('menuitem', { name })).toBeVisible()
    }
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).some((state) => !state.visible))
      .toBe(true)

    const bobUrl = (await getSnapshot(app as ElectronApplication)).panes.find(
      (pane) => pane.id === bobPaneId
    )?.url
    if (!bobUrl) {
      throw new Error('Bob pane URL is unavailable')
    }
    await paneActionsMenu.getByRole('menuitem', { name: 'Copy URL' }).click()
    await expect(paneActionsMenu).toHaveCount(0)
    await expect
      .poll(() => (app as ElectronApplication).evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(bobUrl)

    await deviceActionsTrigger.click()
    await expect(paneActionsMenu).toBeVisible()
    await shellPage.keyboard.press('Escape')
    await expect(paneActionsMenu).toHaveCount(0)
    await expect(deviceActionsTrigger).toBeFocused()
    await waitForVisibleAlignedBounds(app)

    // Reload All preserves the selected device instead of letting incidental
    // native focus events select the first pane.
    await zoomPage.getByRole('button', { name: 'Reload all browsers' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.every((pane) => !pane.isLoading),
      'all panes after Reload All'
    )
    await expect(shellPage.locator('.pane-card-active')).toHaveAttribute(
      'data-pane-id',
      bobPaneId as string
    )
    await waitForVisibleAlignedBounds(app)

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

    // A wider proximity threshold shows a dashed guide before the pane is
    // close enough to snap. The solid guide still appears only at snap range.
    const proximityFirst = await firstCanvasCard.boundingBox()
    const proximitySecond = await secondCanvasCard.boundingBox()
    const proximityHeader = await secondCanvasCard.locator('.pane-header').boundingBox()
    if (!proximityFirst || !proximitySecond || !proximityHeader) {
      throw new Error('Canvas proximity bounds are unavailable')
    }
    const proximityDelta =
      proximityFirst.x + proximityFirst.width + 50 - proximitySecond.x
    await shellPage.mouse.move(
      proximityHeader.x + proximityHeader.width / 2,
      proximityHeader.y + proximityHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      proximityHeader.x + proximityHeader.width / 2 + proximityDelta,
      proximityHeader.y + proximityHeader.height / 2,
      { steps: 8 }
    )
    await expect
      .poll(() => shellPage.locator('.alignment-guide.proximity').count())
      .toBeGreaterThan(0)
    await shellPage.mouse.up()
    await expect.poll(() => shellPage.locator('.alignment-guide').count()).toBe(0)
    await waitForVisibleAlignedBounds(app)

    // Moving closer engages the first magnetic stop: a 16px gap, before the
    // flush snap. The guide is solid because the pane is actually snapped.
    const gapFirst = await firstCanvasCard.boundingBox()
    const gapSecond = await secondCanvasCard.boundingBox()
    const gapHeader = await secondCanvasCard.locator('.pane-header').boundingBox()
    if (!gapFirst || !gapSecond || !gapHeader) {
      throw new Error('Canvas near-gap bounds are unavailable')
    }
    const gapDelta = gapFirst.x + gapFirst.width + 30 - gapSecond.x
    await shellPage.mouse.move(
      gapHeader.x + gapHeader.width / 2,
      gapHeader.y + gapHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      gapHeader.x + gapHeader.width / 2 + gapDelta,
      gapHeader.y + gapHeader.height / 2,
      { steps: 6 }
    )
    await expect
      .poll(() => shellPage.locator('.alignment-guide:not(.proximity)').count())
      .toBeGreaterThan(0)
    await shellPage.mouse.up()
    await expect.poll(() => shellPage.locator('.alignment-guide').count()).toBe(0)
    await waitForVisibleAlignedBounds(app)
    const gapFirstAfter = await firstCanvasCard.boundingBox()
    const gapSecondAfter = await secondCanvasCard.boundingBox()
    if (!gapFirstAfter || !gapSecondAfter) {
      throw new Error('Canvas near-gap result is unavailable')
    }
    expect(
      Math.abs(gapSecondAfter.x - (gapFirstAfter.x + gapFirstAfter.width) - 16)
    ).toBeLessThanOrEqual(1)

    // Moving closer again snaps flush. Guides clear on release.
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
      .poll(() => shellPage.locator('.alignment-guide:not(.proximity)').count())
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
    await expect(alicePage.locator('#output')).toContainText('Popup denied by BrowserDeck.')
    const aliceNoticeStatus = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"] .pane-status`
    )
    await expect(aliceNoticeStatus).toContainText('Popup blocked')

    await bobPage.locator('#permission-button').click()
    const bobNoticeStatus = shellPage.locator(
      `.pane-card[data-pane-id="${bobPaneId}"] .pane-status`
    )
    await expect(bobNoticeStatus).toContainText('Notifications blocked')

    await evaluateInPane(
      app,
      alicePaneId as string,
      `(() => {
        const anchor = document.createElement('a')
        anchor.href = URL.createObjectURL(new Blob(['blocked'], { type: 'text/plain' }))
        anchor.download = 'blocked.txt'
        anchor.click()
        return true
      })()`
    )
    await expect(aliceNoticeStatus).toContainText('Download blocked')

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
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)
    const fittedWorkspace = await shellPage.locator('.workspace').boundingBox()
    const fittedCards = await shellPage.locator('.pane-card').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().toJSON())
    )
    const zoomBar = await getZoomState(app as ElectronApplication)
    if (!fittedWorkspace || fittedCards.length !== 2 || !zoomBar) {
      throw new Error('Canvas fit-all bounds are unavailable')
    }
    for (const card of fittedCards) {
      expect(card.x).toBeGreaterThanOrEqual(fittedWorkspace.x - 1)
      expect(card.y).toBeGreaterThanOrEqual(fittedWorkspace.y - 1)
      expect(card.x + card.width).toBeLessThanOrEqual(fittedWorkspace.x + fittedWorkspace.width + 1)
      expect(card.y + card.height).toBeLessThanOrEqual(
        fittedWorkspace.y + fittedWorkspace.height + 1
      )
      // Fit all keeps devices above the bottom canvas bar with clearance.
      expect(card.y + card.height).toBeLessThanOrEqual(zoomBar.bounds.y - 8)
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
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')
    await addButton.click()
    const addMenu = shellPage.getByRole('menu', { name: 'Add browser' })
    await expect(addMenu).toBeVisible()
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).some((state) => !state.visible))
      .toBe(true)
    await expect(addMenu.getByRole('menuitem')).toHaveCount(17)
    await expect(addMenu.locator('.app-menu-section')).toHaveText([
      'Start with viewport',
      'Phone viewports',
      'Tablet viewports',
      'Desktop viewports'
    ])
    await expect(
      addMenu.getByRole('menuitem', { name: 'Open multiple browsers…' })
    ).toBeVisible()
    for (const name of [
      'Generic phone',
      'iPhone 15 Pro Max',
      'Samsung Galaxy S24 Ultra',
      'Google Pixel 8 Pro',
      'Generic tablet',
      'Laptop'
    ]) {
      await expect(
        addMenu.getByRole('menuitem', { name: new RegExp(`^${name}`) })
      ).toBeVisible()
    }
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
    // Adding a device reveals it without changing the current Canvas zoom.
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')
    await expect(shellPage.locator('.pane-card-active .pane-viewport-trigger')).toHaveAttribute(
      'data-preset',
      'iphone-15-pro'
    )
    await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.closePane(${JSON.stringify(menuAddedPane?.id)})`
    )
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'device pane from the toolbar menu to close'
    )
    await fitAllDevices(app as ElectronApplication)
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
    // A menu that does not cover the bottom overlays leaves them visible.
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)
    await expect
      .poll(async () => (await getZoomState(app as ElectronApplication))?.visible)
      .toBe(true)
    await expect(canvasMenu.getByText('View', { exact: true })).toBeVisible()
    await expect(canvasMenu.getByText('Manage', { exact: true })).toBeVisible()
    await expect(canvasMenu.getByText('Appearance', { exact: true })).toBeVisible()
    await canvasMenu.getByRole('menuitem', { name: /^Add browser/ }).click()
    await expect(shellPage.getByRole('menu', { name: 'Add browser' })).toBeVisible()
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

    const handTool = zoomPage.getByRole('button', { name: 'Hand tool' })
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
    await fitAllDevices(app as ElectronApplication)
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
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(true)
    await expect
      .poll(async () => (await getMinimapState(app as ElectronApplication))?.visible)
      .toBe(true)
    await expect(zoomMenu.getByRole('menuitemradio')).toHaveCount(7)
    await zoomMenu.getByRole('menuitemradio', { name: '50%', exact: true }).click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('50%')
    await expect.poll(async () => (await getZoomState(app as ElectronApplication))?.visible).toBe(true)
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')

    // Native View-menu zoom shortcuts route to the same Canvas zoom path.
    expect(await readAppMenuItem(app, 'canvas-zoom-in')).toEqual({
      id: 'canvas-zoom-in',
      accelerator: 'CmdOrCtrl+=',
      enabled: true
    })
    expect(await readAppMenuItem(app, 'canvas-zoom-out')).toEqual({
      id: 'canvas-zoom-out',
      accelerator: 'CmdOrCtrl+-',
      enabled: true
    })
    expect(await readAppMenuItem(app, 'canvas-zoom-reset')).toEqual({
      id: 'canvas-zoom-reset',
      accelerator: 'CmdOrCtrl+0',
      enabled: true
    })
    await clickAppMenuCommand(app, 'canvas-zoom-in')
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('110%')
    await clickAppMenuCommand(app, 'canvas-zoom-out')
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')
    await clickAppMenuCommand(app, 'canvas-zoom-in')
    await clickAppMenuCommand(app, 'canvas-zoom-in')
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('120%')
    await clickAppMenuCommand(app, 'canvas-zoom-reset')
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')

    // The bottom-bar Arrange menu lays out every device from scratch. The
    // horizontal row keeps pane order and top-aligns every frame.
    await zoomPage.getByRole('button', { name: 'Arrange browsers' }).click()
    const arrangeMenu = shellPage.getByRole('menu', { name: 'Arrange browsers' })
    await expect(arrangeMenu).toBeVisible()
    await expect(arrangeMenu.getByRole('menuitem')).toHaveCount(4)
    for (const name of [
      'Showcase layout',
      'Horizontal row',
      '2 × 2 grid',
      'Vertical stack'
    ]) {
      await expect(arrangeMenu.getByRole('menuitem', { name })).toBeVisible()
    }
    await arrangeMenu.getByRole('menuitem', { name: 'Horizontal row' }).click()
    await expect(arrangeMenu).toHaveCount(0)
    const arranged = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        Boolean(
          state.layout.canvas?.[alicePaneId as string] &&
            state.layout.canvas?.[bobPaneId as string]
        ),
      'horizontal arrange layout'
    )
    let arrangedX = CANVAS_ORIGIN
    for (const paneId of arranged.layout.gridOrder) {
      const pane = arranged.panes.find((entry) => entry.id === paneId)
      expect(arranged.layout.canvas?.[paneId]).toEqual({
        x: Math.round(arrangedX),
        y: CANVAS_ORIGIN
      })
      if (pane) {
        arrangedX += canvasFrameSize(pane.viewport).width + CANVAS_GAP
      }
    }

    // Clicking empty canvas clears the active pane without moving the
    // workspace; clicking a pane restores the selection and its address.
    const deselectWorkspace = await shellPage.locator('.workspace').boundingBox()
    if (!deselectWorkspace) {
      throw new Error('Canvas deselect workspace bounds are unavailable')
    }
    await shellPage.mouse.click(deselectWorkspace.x + 6, deselectWorkspace.y + 6)
    await expect.poll(() => shellPage.locator('.pane-card-active').count()).toBe(0)
    await expect(shellPage.locator('.toolbar .add-pane-button')).toBeVisible()
    const clearedWorkspace = await shellPage.locator('.workspace').boundingBox()
    expect(clearedWorkspace).toEqual(deselectWorkspace)
    await shellPage.locator('.pane-title').first().click()
    await waitForVisibleAlignedBounds(app)
    await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
    await expect(shellPage.locator('.pane-card-active .address-input')).toBeVisible()
    const reselectedWorkspace = await shellPage.locator('.workspace').boundingBox()
    expect(reselectedWorkspace).toEqual(deselectWorkspace)

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
    await expect(shellPage.locator('.scale-select')).toHaveCount(0)
    const paneMetrics = (paneId: string) =>
      evaluateInPane<{ width: number; height: number; dpr: number }>(
        app as ElectronApplication,
        paneId,
        '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })'
      )
    const paneInputMedia = (paneId: string) =>
      evaluateInPane<{
        scrollbarWidth: number
        maxTouchPoints: number
        hover: boolean
        pointerCoarse: boolean
      }>(
        app as ElectronApplication,
        paneId,
        `({
          scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
          maxTouchPoints: navigator.maxTouchPoints,
          hover: matchMedia('(hover: hover)').matches,
          pointerCoarse: matchMedia('(pointer: coarse)').matches
        })`
      )
    const aliceMetrics = () => paneMetrics(alicePaneId as string)
    const bobMetrics = () => paneMetrics(bobPaneId as string)

    // The viewport selector uses the same custom menu language and the same
    // complete preset catalog as Add, instead of the native select popup.
    const viewportTrigger = shellPage.locator('.pane-card-active .pane-viewport-trigger')
    await expect(viewportTrigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(viewportTrigger).toHaveAttribute('aria-expanded', 'false')
    await viewportTrigger.click()
    const viewportMenu = shellPage.getByRole('menu', { name: 'Viewport preset' })
    await expect(viewportMenu).toBeVisible()
    const viewportTriggerBox = await viewportTrigger.boundingBox()
    const viewportMenuBox = await viewportMenu.boundingBox()
    expect(viewportTriggerBox).toBeTruthy()
    expect(viewportMenuBox).toBeTruthy()
    if (viewportTriggerBox && viewportMenuBox) {
      expect(viewportMenuBox.x).toBeGreaterThanOrEqual(viewportTriggerBox.x - 1)
      expect(viewportMenuBox.y).toBeGreaterThanOrEqual(
        viewportTriggerBox.y + viewportTriggerBox.height
      )
    }
    await expect(viewportTrigger).toHaveAttribute('aria-expanded', 'true')
    await expect(viewportMenu.getByRole('menuitemradio')).toHaveCount(17)
    await expect(viewportMenu.locator('.app-menu-section')).toHaveText([
      'Phone viewports',
      'Tablet viewports',
      'Desktop viewports'
    ])
    for (const name of [
      'Generic phone',
      'iPhone 15 Pro Max',
      'Samsung Galaxy S24 Ultra',
      'Google Pixel 8 Pro',
      'Generic tablet',
      'Laptop'
    ]) {
      await expect(
        viewportMenu.getByRole('menuitemradio', { name: new RegExp(`^${name}`) })
      ).toBeVisible()
    }
    await expect(
      viewportMenu.locator('[data-menu-item-id="viewport:custom"]')
    ).toHaveText('Custom…')
    await viewportMenu.locator('[data-menu-item-id="viewport:mobile"]').click()
    await expect(viewportMenu).toHaveCount(0)
    await expect(viewportTrigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'mobile',
      'mobile viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 390, height: 844, dpr: 3 })
    await expect
      .poll(() =>
        evaluateInPane<string>(app as ElectronApplication, alicePaneId as string, 'navigator.userAgent')
      )
      .toContain('iPhone')
    const mobileHeader = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"] .pane-header`
    )
    await expect(mobileHeader.locator('.pane-viewport-trigger')).toHaveAttribute(
      'data-preset',
      'mobile'
    )
    await expect(mobileHeader.locator('.pane-device-type')).toHaveText('Phone')
    await expect(mobileHeader.locator('.pane-resolution')).toHaveText('390 × 844')
    await expect.poll(() => paneInputMedia(alicePaneId as string)).toMatchObject({
      scrollbarWidth: 0,
      maxTouchPoints: 5,
      hover: false,
      pointerCoarse: true
    })
    await expect
      .poll(() =>
        mobileHeader.evaluate((header) => {
          const bounds = header.getBoundingClientRect()
          return Array.from(header.querySelectorAll('button')).every((button) => {
            const rect = button.getBoundingClientRect()
            return rect.left >= bounds.left && rect.right <= bounds.right + 0.5
          })
        })
      )
      .toBe(true)
    const mobileFitEmulation = await getEmulationState(app, alicePaneId as string)
    expect(mobileFitEmulation?.enabled).toBe(true)
    expect(mobileFitEmulation?.scale).toBeGreaterThan(0)
    expect(mobileFitEmulation?.scale).toBeLessThanOrEqual(1)

    // A second pane can hold a different emulated viewport at the same time.
    await fitAllDevices(app as ElectronApplication)
    await focusPane(shellPage, bobPaneId as string)
    await selectViewportPreset(shellPage, 'tablet')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[1]?.viewport.preset === 'tablet',
      'tablet viewport state for the second pane'
    )
    await expect.poll(bobMetrics).toMatchObject({ width: 820, height: 1180, dpr: 2 })
    await expect
      .poll(() =>
        evaluateInPane<string>(app as ElectronApplication, bobPaneId as string, 'navigator.userAgent')
      )
      .toContain('iPad')
    await expect.poll(aliceMetrics).toMatchObject({ width: 390, height: 844, dpr: 3 })

    // Device presets use their real CSS dimensions and device pixel ratios.
    await fitAllDevices(app as ElectronApplication)
    await focusPane(shellPage, alicePaneId as string)
    await selectViewportPreset(shellPage, 'pixel-8')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'pixel-8',
      'Pixel viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 412, height: 915, dpr: 2.625 })
    await expect
      .poll(() =>
        evaluateInPane<string>(app as ElectronApplication, alicePaneId as string, 'navigator.userAgent')
      )
      .toContain('Android 14')
    const pixelEmulation = await getEmulationState(app, alicePaneId as string)
    expect(pixelEmulation?.enabled).toBe(true)
    expect(pixelEmulation?.scale).toBeGreaterThan(0)
    expect(pixelEmulation?.scale).toBeLessThanOrEqual(1)
    // The per-pane viewport trigger carries the preset name; the full
    // dimensions stay in the tooltip and second-row resolution.
    const aliceViewportTrigger = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"] .pane-viewport-trigger`
    )
    const viewportBox = await aliceViewportTrigger.boundingBox()
    expect(viewportBox?.width).toBeLessThanOrEqual(190)
    await expect(
      aliceViewportTrigger.locator('.viewport-trigger-label')
    ).toHaveText('Google Pixel 8')
    await expect(aliceViewportTrigger).toHaveAttribute('data-preset', 'pixel-8')
    await expect(aliceViewportTrigger).toHaveAttribute('title', /412 × 915/)

    await selectViewportPreset(shellPage, 'custom')
    const customRow = shellPage.locator('.pane-card-active .viewport-custom')
    await expect(customRow).toBeVisible()
    await expect(customRow.getByLabel('Custom viewport width')).toBeFocused()
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
    await expect.poll(() => paneInputMedia(alicePaneId as string)).toMatchObject({
      maxTouchPoints: 0,
      hover: true,
      pointerCoarse: false
    })
    const customFitEmulation = await getEmulationState(app, alicePaneId as string)
    expect(customFitEmulation?.enabled).toBe(true)
    expect(customFitEmulation?.scale).toBeGreaterThan(0)
    expect(customFitEmulation?.scale).toBeLessThanOrEqual(1)
    await expect(
      shellPage.getByRole('button', { name: 'Edit custom viewport' })
    ).toBeVisible()
    await shellPage.getByRole('button', { name: 'Edit custom viewport' }).click()
    await expect(customRow).toBeVisible()
    await expect(customRow.getByLabel('Custom viewport width')).toHaveValue('500')
    await customRow.getByRole('button', { name: 'Cancel' }).click()
    await expect(customRow).toHaveCount(0)

    // Rotating a fixed viewport swaps the emulated dimensions and the canvas
    // frame until it is rotated back.
    const rotateResult = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.rotatePaneViewport(${JSON.stringify(alicePaneId)})`
    )
    expect(rotateResult.ok).toBe(true)
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes[0]?.viewport.rotated === true &&
        state.panes[0]?.viewport.width === 500 &&
        state.panes[0]?.viewport.height === 1000,
      'rotated custom viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 1000, height: 500, dpr: 2 })
    const rotatedEmulation = await getEmulationState(app, alicePaneId as string)
    expect(rotatedEmulation?.viewport.rotated).toBe(true)
    const rotatedCard = shellPage.locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
    await expect
      .poll(async () => (await rotatedCard.boundingBox())?.width ?? 0)
      .toBeGreaterThan((await rotatedCard.boundingBox())?.height ?? 0)
    await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.rotatePaneViewport(${JSON.stringify(alicePaneId)})`
    )
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.rotated !== true,
      'restored upright viewport state'
    )
    await expect.poll(aliceMetrics).toMatchObject({ width: 500, height: 1000, dpr: 2 })

    await selectViewportPreset(shellPage, 'responsive')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'responsive',
      'responsive viewport state'
    )
    await expect
      .poll(() =>
        evaluateInPane<string>(app as ElectronApplication, alicePaneId as string, 'navigator.userAgent')
      )
      .not.toContain('iPhone')
    await expect.poll(() => paneInputMedia(alicePaneId as string)).toMatchObject({
      maxTouchPoints: 0,
      hover: true,
      pointerCoarse: false
    })

    // The other pane keeps its emulated viewport until changed.
    await expect.poll(bobMetrics).toMatchObject({ width: 820, height: 1180, dpr: 2 })
    await focusPane(shellPage, bobPaneId as string)
    await selectViewportPreset(shellPage, 'responsive')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[1]?.viewport.preset === 'responsive',
      'responsive viewport state for the second pane'
    )
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)

    // Device actions must stay available at every canvas zoom. At 80% these two
    // iPhone frames straddle the old 340 px breakpoint that hid actions.
    await focusPane(shellPage, alicePaneId as string)
    await selectViewportPreset(shellPage, 'iphone-15-pro-max')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'iphone-15-pro-max',
      'iPhone 15 Pro Max viewport for action visibility'
    )
    await focusPane(shellPage, bobPaneId as string)
    await selectViewportPreset(shellPage, 'iphone-15-pro')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[1]?.viewport.preset === 'iphone-15-pro',
      'iPhone 15 Pro viewport for action visibility'
    )
    await fitAllDevices(app as ElectronApplication)
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await zoomPage.getByRole('button', { name: 'Zoom out' }).click()
    await zoomPage.getByRole('button', { name: 'Zoom out' }).click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('80%')
    const aliceActionCard = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"]`
    )
    const bobActionCard = shellPage.locator(`.pane-card[data-pane-id="${bobPaneId}"]`)
    expect((await aliceActionCard.boundingBox())?.width ?? 0).toBeGreaterThan(340)
    expect((await bobActionCard.boundingBox())?.width ?? 0).toBeLessThanOrEqual(340)
    for (const card of [aliceActionCard, bobActionCard]) {
      await expect(card.locator('.pane-actions')).toBeVisible()
      await expect(card.getByRole('button', { name: 'Go back' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Go forward' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Reload browser' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Browser actions' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Close browser' })).toBeVisible()
    }

    // Restore responsive panes for the remaining zoom/emulation checks.
    await focusPane(shellPage, alicePaneId as string)
    await selectViewportPreset(shellPage, 'responsive')
    await focusPane(shellPage, bobPaneId as string)
    await selectViewportPreset(shellPage, 'responsive')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes[0]?.viewport.preset === 'responsive' &&
        state.panes[1]?.viewport.preset === 'responsive',
      'responsive viewports before zoom emulation check'
    )
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)

    // Responsive panes scale their live views through canvas zoom. Returning
    // the canvas to 100% disables device emulation and restores the responsive
    // page viewport to the pane content rectangle.
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await zoomPage.getByRole('button', { name: 'Zoom out' }).click()
    await zoomPage.getByRole('button', { name: 'Zoom out' }).click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('80%')
    const responsiveEmulation = await getEmulationState(app, alicePaneId as string)
    expect(responsiveEmulation?.enabled).toBe(true)
    expect(responsiveEmulation?.scale).toBeGreaterThan(0)
    expect(responsiveEmulation?.scale).toBeLessThanOrEqual(1)

    // Reloading a pane can reset Chromium emulation. The zoom scale must be
    // reapplied after navigation without changing the declared viewport.
    await shellPage
      .locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
      .getByRole('button', { name: 'Reload browser' })
      .click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.isLoading === false,
      'zoomed pane reload'
    )
    await expect
      .poll(async () => getEmulationState(app as ElectronApplication, alicePaneId as string))
      .toMatchObject({ enabled: true })
    await expect
      .poll(async () => (await getEmulationState(app as ElectronApplication, alicePaneId as string))?.scale)
      .toBeCloseTo(0.8, 2)
    await expect.poll(aliceMetrics).toMatchObject({ width: 560, height: 700 })
    await waitForVisibleAlignedBounds(app)

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

    // Screen capture writes a real PNG through the validated IPC path. Patch
    // the native save dialog so the test does not need to drive OS chrome.
    const screenshotPath = join(tmpdir(), `browserdeck-screenshot-${Date.now()}.png`)
    await app.evaluate(({ dialog }, targetPath) => {
      const original = dialog.showSaveDialog
      ;(
        globalThis as typeof globalThis & {
          __browserdeckOriginalSaveDialog?: typeof dialog.showSaveDialog
        }
      ).__browserdeckOriginalSaveDialog = original
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: targetPath
      })) as typeof dialog.showSaveDialog
    }, screenshotPath)
    const screenshot = await shellEvaluate<{ ok: boolean; filePath?: string; error?: string }>(
      app,
      `window.browserdeck.capturePaneScreenshot(${JSON.stringify(alicePaneId)})`
    )
    await app.evaluate(({ dialog }) => {
      const original = (
        globalThis as typeof globalThis & {
          __browserdeckOriginalSaveDialog?: typeof dialog.showSaveDialog
        }
      ).__browserdeckOriginalSaveDialog
      if (original) {
        dialog.showSaveDialog = original
      }
    })
    expect(screenshot.ok, screenshot.error).toBe(true)
    expect(screenshot.filePath).toBe(screenshotPath)
    const screenshotBytes = await readFile(screenshotPath)
    expect(
      screenshotBytes.subarray(0, 8)
    ).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    await rm(screenshotPath, { force: true })

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
    expect(await readAppMenuItem(app, 'pane-duplicate')).toEqual({
      id: 'pane-duplicate',
      accelerator: 'CmdOrCtrl+D',
      enabled: true
    })
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

    // Duplicates land directly beside their source and stay top-aligned.
    if (!duplicatedPane) {
      throw new Error('Duplicated pane is unavailable')
    }
    const duplicateLayout = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        Boolean(
          state.layout.canvas?.[alicePaneId as string] &&
            state.layout.canvas?.[duplicatedPane.id]
        ),
      'duplicate canvas placement'
    )
    const sourcePosition = duplicateLayout.layout.canvas?.[alicePaneId as string]
    if (!sourcePosition) {
      throw new Error('Duplicate source position is unavailable')
    }
    expect(duplicateLayout.layout.canvas?.[duplicatedPane.id]).toEqual({
      x: sourcePosition.x,
      y: sourcePosition.y + canvasFrameSize(duplicateSource.viewport).height + CANVAS_GAP
    })

    // The pane header can hand the current page to the system browser. Stub
    // Electron's shell so the test can verify the exact validated URL without
    // launching the user's real browser.
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)
    const externalButton = shellPage
      .locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
      .getByRole('button', { name: 'Open in browser' })
    await expect(externalButton).toBeEnabled()
    await (app as ElectronApplication).evaluate(({ shell }) => {
      ;(globalThis as typeof globalThis & { __browserdeckOpenedExternal?: string | null })
        .__browserdeckOpenedExternal = null
      shell.openExternal = async (url: string) => {
        ;(globalThis as typeof globalThis & { __browserdeckOpenedExternal?: string | null })
          .__browserdeckOpenedExternal = url
      }
    })
    await externalButton.click()
    await expect
      .poll(() =>
        (app as ElectronApplication).evaluate(
          () =>
            (globalThis as typeof globalThis & { __browserdeckOpenedExternal?: string | null })
              .__browserdeckOpenedExternal ?? null
        )
      )
      .toBe(duplicateSource.url)

    // Delete closes the selected device from shell focus, but never while the
    // user is editing pane chrome such as the address field.
    await focusPane(shellPage, duplicatedPane?.id as string)
    const addressField = shellPage.locator(
      `.pane-card[data-pane-id="${duplicatedPane?.id}"] .address-input`
    )
    await addressField.focus()
    await shellPage.keyboard.press('Backspace')
    await expect
      .poll(async () => (await getSnapshot(app as ElectronApplication)).panes.length)
      .toBe(3)
    await shellPage.keyboard.press('Escape')
    await focusPane(shellPage, duplicatedPane?.id as string)
    await shellPage.keyboard.press('Delete')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 2,
      'delete-shortcut pane close'
    )

    // Custom pane titles are edited inline. Invalid or unknown-pane renames
    // are rejected in main, and whitespace around a valid name is normalized.
    const rejectedTitle = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.renamePane(${JSON.stringify(alicePaneId)}, ${JSON.stringify('x'.repeat(81))})`
    )
    expect(rejectedTitle.ok).toBe(false)
    const rejectedUnknownRename = await shellEvaluate<{ ok: boolean }>(
      app,
      "window.browserdeck.renamePane('unknown-pane', 'Nope')"
    )
    expect(rejectedUnknownRename.ok).toBe(false)

    await fitAllDevices(app as ElectronApplication)
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
    const commandAddMenu = shellPage.getByRole('menu', { name: 'Add browser' })
    await expect(commandAddMenu).toBeVisible()
    expect((await getSnapshot(app as ElectronApplication)).panes).toHaveLength(2)
    await commandAddMenu.locator('[data-menu-item-id="preset:responsive"]').click()
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
      "window.browserdeck.addPaneWithViewport({ preset: 'watch' })"
    )
    expect(rejectedDeviceAdd.ok).toBe(false)
    const deviceAdd = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.addPaneWithViewport(${JSON.stringify({
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
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)
    await expect(
      shellPage.locator('.pane-card-active .pane-viewport-trigger')
    ).toHaveAttribute('data-preset', 'pixel-8')
    await waitFor(
      () => getEmulationState(app as ElectronApplication, devicePane.id),
      (state) => state?.enabled === true && (state.scale ?? 0) > 0,
      'device pane fit emulation'
    )
    await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.closePane(${JSON.stringify(devicePane.id)})`
    )
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes.length === 2 && !state.panes.some((pane) => pane.id === devicePane.id),
      'device pane cleanup'
    )
    await waitForAlignedBounds(app)

    await fitAllDevices(app as ElectronApplication)
    await waitForAlignedBounds(app)
    const resolvedTheme = (await getSnapshot(app as ElectronApplication)).resolvedTheme
    expect(['light', 'dark']).toContain(resolvedTheme)
    await expect(shellPage.locator('html')).toHaveAttribute('data-theme', resolvedTheme)
    expect(
      await shellPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      )
    ).toBe(resolvedTheme === 'dark' ? '#171716' : '#f5f5f3')

    // The address chrome is real UI: type and submit in the device header,
    // then use its Back button.
    await focusPane(shellPage, alicePaneId as string)
    const firstAddress = shellPage.locator('.pane-card-active .address-input')
    await firstAddress.fill(`${fixture.url}/other?from=e2e`)
    await firstAddress.press('Enter')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/other?from=e2e') ?? false,
      'address bar navigation'
    )
    await shellPage
      .locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
      .getByRole('button', { name: 'Go back' })
      .click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/pane/one') ?? false,
      'back navigation'
    )
    expect(bobPage.url()).toContain('/pane/two')

    // The pane header owns per-device back, forward, and reload controls.
    const aliceHeader = shellPage.locator(`.pane-card[data-pane-id="${alicePaneId}"]`)
    await aliceHeader.getByRole('button', { name: 'Go forward' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/other?from=e2e') ?? false,
      'pane header forward navigation'
    )
    await aliceHeader.getByRole('button', { name: 'Go back' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/pane/one') ?? false,
      'pane header back navigation'
    )
    await aliceHeader.getByRole('button', { name: 'Reload browser' }).click()
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.isLoading === false,
      'pane header reload'
    )

    // Main-process validation rejects unsupported schemes and unknown panes;
    // renderer-side validation alone is not the security boundary.
    const rejectedNavigation = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.navigate(${JSON.stringify(alicePaneId)}, 'javascript:alert(1)')`
    )
    expect(rejectedNavigation.ok).toBe(false)

    const rejectedBounds = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.browserdeck.setPaneBounds([{ paneId: 'unknown-pane', rect: { x: 0, y: 0, width: 400, height: 300 }, visible: true }])`
    )
    expect(rejectedBounds.ok).toBe(false)

    // Address errors are visible in the toolbar and announced through the live
    // status region; Escape restores the current URL.
    expect(await readAppMenuItem(app, 'pane-reload')).toEqual({
      id: 'pane-reload',
      accelerator: 'CmdOrCtrl+R',
      enabled: true
    })
    expect(await readAppMenuItem(app, 'pane-focus-address')).toEqual({
      id: 'pane-focus-address',
      accelerator: 'CmdOrCtrl+L',
      enabled: true
    })
    const firstInput = shellPage.locator('.pane-card-active .address-input')
    await firstInput.fill('javascript:alert(1)')
    await firstInput.press('Enter')
    await expect(shellPage.locator('.pane-card-active .address-error')).toHaveText(
      /Only http/
    )
    await expect(shellPage.locator('.pane-card-active .pane-status')).toContainText(
      'Only http'
    )
    expect(await firstInput.getAttribute('aria-invalid')).toBe('true')
    await firstInput.press('Escape')
    await expect(firstInput).toHaveValue(`${fixture.url}/pane/one?user=alice`)

    await clickAppMenuCommand(app, 'pane-focus-address')
    await expect
      .poll(() =>
        shellPage.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      )
      .toMatch(/^Address for browser /)
    await shellPage.keyboard.press('Escape')

    // Resize the native window; shell and browser bounds must realign.
    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('BrowserDeck window not found')
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
    expect(await alicePage.evaluate(() => document.cookie)).not.toContain('browserdeck_session')
    expect(await bobPage.evaluate(() => document.cookie)).not.toContain('browserdeck_session')

    // Signing out of one profile must not affect the other profile.
    await bobPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(bobPage).toHaveURL(/\/login$/)
    await expect(alicePage.locator('#account-name')).toHaveText('alice')
    await bobPage.getByRole('button', { name: 'Sign in as Bob' }).click()
    await expect(bobPage.locator('#account-name')).toHaveText('bob')

    // Close the second pane and verify its native webContents and exclusive
    // profile are released with it.
    const aliceProfileId = firstProfileIds[0] as string
    const bobProfileId = firstProfileIds[1] as string
    const bobWebContentsId = await app.evaluate((_electron, paneId) => {
      const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
      return hook ? hook.webContentsId(paneId) : null
    }, bobPaneId as string)
    expect(bobWebContentsId).not.toBeNull()

    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(app)
    await shellPage
      .locator('.pane-card')
      .nth(1)
      .getByRole('button', { name: 'Close browser' })
      .click()
    const afterClose = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 1,
      'pane close'
    )
    expect(afterClose.panes[0]?.id).toBe(alicePaneId)
    await expect
      .poll(async () =>
        (await readPersistedProfiles(userDataDir)).some((profile) => profile.id === bobProfileId)
      )
      .toBe(false)

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
    expect(await readAppMenuItem(app, 'pane-add')).toEqual({
      id: 'pane-add',
      accelerator: 'CmdOrCtrl+N',
      enabled: true
    })
    await shellEvaluate<{ ok: boolean }>(app, 'window.browserdeck.addPane()')
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
      const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
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
    if (newPane?.profileId) {
      await expect
        .poll(async () =>
          (await readPersistedProfiles(userDataDir)).some(
            (profile) => profile.id === newPane.profileId
          )
        )
        .toBe(false)
    }

    const remainingAliceCard = shellPage.locator(
      `.pane-card[data-pane-id="${alicePaneId}"]`
    )

    // Make the persisted workspace distinctive: an iPhone SE viewport and a
    // horizontal canvas move. The restart must restore both.
    await fitAllDevices(app as ElectronApplication)
    await waitForAlignedBounds(app)
    await focusPane(shellPage, alicePaneId as string)
    await selectViewportPreset(shellPage, 'iphone-se')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.viewport.preset === 'iphone-se',
      'iPhone SE viewport before restart'
    )
    await waitForAlignedBounds(app)

    const canvasBeforeDrag = (await getSnapshot(app as ElectronApplication)).layout.canvas?.[
      alicePaneId as string
    ]
    const canvasHeader = await remainingAliceCard.locator('.pane-title').boundingBox()
    if (!canvasHeader || !canvasBeforeDrag) {
      throw new Error('Canvas pane header is unavailable before restart')
    }
    const dragStartX = canvasHeader.x + Math.min(10, canvasHeader.width / 2)
    await shellPage.mouse.move(
      dragStartX,
      canvasHeader.y + canvasHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      dragStartX + 100,
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
    const persistedCanvas = (await getSnapshot(app as ElectronApplication)).layout.canvas?.[
      alicePaneId as string
    ]
    if (!persistedCanvas) {
      throw new Error('Persisted canvas position is unavailable')
    }
    await waitFor(
      () => readPersistedWorkspace(userDataDir),
      (workspace) => {
        const position = workspace?.layout.canvas?.[alicePaneId as string]
        return (
          position?.x === persistedCanvas.x &&
          position.y === persistedCanvas.y
        )
      },
      'final canvas position to persist'
    )

    // The last camera and selected device must survive a relaunch. Use a
    // distinctive 50% zoom and a non-zero pan, then verify both after restart.
    await resetCanvasZoomFromBar(shellPage, zoomPage)
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('100%')
    await zoomPage.getByRole('button', { name: 'Choose zoom level' }).click()
    await shellPage
      .getByRole('menu', { name: 'Zoom' })
      .getByRole('menuitemradio', { name: '50%', exact: true })
      .click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('50%')
    await shellPage.locator('.workspace').dispatchEvent('wheel', { deltaX: 120, deltaY: 80 })
    const persistedWithCamera = await waitFor(
      () => readPersistedWorkspace(userDataDir),
      (workspace) =>
        workspace?.layout.view?.zoom === 0.5 &&
        workspace.layout.view.activePaneId === alicePaneId,
      'camera and selected device to persist'
    )
    const persistedView = persistedWithCamera?.layout.view
    if (!persistedView) {
      throw new Error('Persisted camera view is unavailable')
    }

    await app.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('BrowserDeck window not found')
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
        throw new Error('BrowserDeck window not found')
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
        await session.fromPartition(`persist:browserdeck-profile-${profileId}`).cookies.flushStore()
      }
    }, firstProfileIds)

    // Change the camera immediately before quitting. The proactive save must
    // capture this final state even though the debounce has not elapsed.
    await zoomPage.getByRole('button', { name: 'Choose zoom level' }).click()
    await shellPage
      .getByRole('menu', { name: 'Zoom' })
      .getByRole('menuitemradio', { name: '75%', exact: true })
      .click()
    await expect.poll(() => zoomPage.locator('#value').textContent()).toBe('75%')

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
        throw new Error('BrowserDeck window not found')
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
        "localStorage.getItem('browserdeck_fixture')"
      )
    ).toBe(aliceStorageBeforeRestart)

    expect(await readCookie(restartApp, restarted.panes[0]?.id as string)).toContain(
      'browserdeck_user=alice'
    )

    // Closing Bob's last pane released his exclusive profile and session data.
    await expect
      .poll(async () =>
        (await readPersistedProfiles(userDataDir)).some(
          (profile) => profile.id === bobProfileId
        )
      )
      .toBe(false)
    const bobProfileCookies = await restartApp.evaluate(
      async ({ session }, args) => {
        const cookies = await session
          .fromPartition(`persist:browserdeck-profile-${args.profileId}`)
          .cookies.get({ url: args.url })
        return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
      },
      { profileId: bobProfileId, url: fixture.url }
    )
    expect(bobProfileCookies).toBe('')

    const restartedLayout = await waitFor(
      async () => restartApp.windows(),
      (windows) => windows.some((page) => isShellPage(page.url())),
      'restarted shell page'
    )
    const restartShell = restartedLayout.find((page) => isShellPage(page.url()))
    if (!restartShell) {
      throw new Error('Restarted shell page is unavailable')
    }
    const restartZoomPage = restartedLayout.find((page) => page.url() === SHELL_ZOOM_URL)
    if (!restartZoomPage) {
      throw new Error('Restarted Canvas zoom bar is unavailable')
    }

    // The restored camera and selection must match the state at close, before
    // any later test step runs Fit all.
    const restoredView = restarted.layout.view
    if (!restoredView) {
      throw new Error('Restored camera view is unavailable')
    }
    expect(restoredView.zoom).toBe(0.75)
    expect(restoredView.activePaneId).toBe(alicePaneId)
    await expect.poll(() => restartZoomPage.locator('#value').textContent()).toBe('75%')
    await expect
      .poll(() => restartShell.locator('.pane-card-active').getAttribute('data-pane-id'))
      .toBe(alicePaneId)
    const restoredFrame = restarted.layout.canvas?.[alicePaneId as string]
    if (!restoredFrame) {
      throw new Error('Restored Canvas frame is unavailable')
    }
    const restoredSlot = await restartShell.evaluate((paneId) => {
      const card = document.querySelector(`.pane-card[data-pane-id="${paneId}"]`)
      const slot = card?.parentElement
      if (!(slot instanceof HTMLElement)) {
        return null
      }
      return {
        left: Number.parseFloat(slot.style.left),
        top: Number.parseFloat(slot.style.top)
      }
    }, alicePaneId as string)
    expect(restoredSlot).not.toBeNull()
    expect(restoredSlot?.left).toBeCloseTo(
      restoredView.pan.x + restoredFrame.x * restoredView.zoom,
      0
    )
    expect(restoredSlot?.top).toBeCloseTo(
      restoredView.pan.y + restoredFrame.y * restoredView.zoom,
      0
    )

    await fitAllDevices(app as ElectronApplication)
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
    await selectViewportPreset(restartShell, 'responsive')
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes[0]?.viewport.preset === 'responsive',
      'responsive viewport after restart verification'
    )
    await fitAllDevices(app as ElectronApplication)
    await waitForVisibleAlignedBounds(restartApp)

    // Profiles are internal and per-pane. The manager and sharing UI are gone.
    expect(await readAppMenuItem(restartApp, 'profiles-manage')).toBeNull()

    // Clear Site Data is a confirmed per-pane action. Use a temporary pane so
    // Alice's authenticated session stays intact for the workspace tests.
    const clearPaneUrl = `${fixture.url}/pane/one?user=clear`
    expect(
      await shellEvaluate<{ ok: boolean }>(
        restartApp,
        `window.browserdeck.addPane(${JSON.stringify(clearPaneUrl)})`
      )
    ).toMatchObject({ ok: true })
    const clearPaneState = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.length === 2 &&
        state.panes.some(
          (pane) => pane.id !== alicePaneId && pane.url.includes('user=clear') && !pane.isLoading
        ),
      'clear-site-data pane'
    )
    const clearPane = clearPaneState.panes.find((pane) => pane.id !== alicePaneId)
    if (!clearPane) {
      throw new Error('Clear-site-data pane is unavailable')
    }
    const clearPaneCard = restartShell.locator(
      `.pane-card[data-pane-id="${clearPane.id}"]`
    )
    await focusPane(restartShell, clearPane.id)
    await evaluateInPane(
      restartApp,
      clearPane.id,
      "localStorage.setItem('browserdeck_clear_probe', 'present')"
    )
    await clearPaneCard.getByRole('button', { name: 'Browser actions' }).click()
    const clearPaneMenu = restartShell.getByRole('menu', { name: 'Browser actions' })
    await expect(
      clearPaneMenu.getByRole('menuitem', { name: 'Clear Site Data…' })
    ).toBeVisible()
    await clearPaneMenu.getByRole('menuitem', { name: 'Clear Site Data…' }).click()
    const clearConfirm = restartShell.getByRole('menu', { name: /Clear site data/ })
    await expect(clearConfirm).toBeVisible()
    await clearConfirm.getByRole('menuitem', { name: 'Cancel' }).click()
    await expect(clearConfirm).toHaveCount(0)
    await expect
      .poll(() =>
        evaluateInPane<string | null>(
          restartApp,
          clearPane.id,
          "localStorage.getItem('browserdeck_clear_probe')"
        )
      )
      .toBe('present')

    await clearPaneCard.getByRole('button', { name: 'Browser actions' }).click()
    await clearPaneMenu.getByRole('menuitem', { name: 'Clear Site Data…' }).click()
    await clearConfirm.getByRole('menuitem', { name: 'Clear Site Data and Reload' }).click()
    await expect(clearConfirm).toHaveCount(0)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => {
        const pane = state.panes.find((entry) => entry.id === clearPane.id)
        return Boolean(pane && !pane.isLoading)
      },
      'clear-site-data reload'
    )
    await expect
      .poll(() =>
        evaluateInPane<string | null>(
          restartApp,
          clearPane.id,
          "localStorage.getItem('browserdeck_clear_probe')"
        )
      )
      .toBeNull()

    await shellEvaluate(restartApp, `window.browserdeck.closePane(${JSON.stringify(clearPane.id)})`)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 1 && state.panes[0]?.id === alicePaneId,
      'clear-site-data pane close'
    )
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
    await clickAppMenuCommand(restartApp, 'workspace-manage')
    const workspacesDialog = restartShell.getByRole('dialog', { name: 'Workspaces' })
    await expect(workspacesDialog).toBeVisible()
    await expect
      .poll(async () => (await getViewStates(restartApp)).filter((state) => state.visible).length)
      .toBe(0)
    const originalWorkspaceRow = workspacesDialog.locator(
      `.workspace-row[data-workspace-id="${originalWorkspaceId}"]`
    )
    await expect(originalWorkspaceRow).toContainText('Active')
    await expect(originalWorkspaceRow).toContainText('1 browser')

    const workspaceIdByName = async (name: string): Promise<string> => {
      const result = await shellEvaluate<{
        ok: boolean
        workspaces?: Array<{ id: string; name: string }>
      }>(restartApp, 'window.browserdeck.listWorkspaces()')
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
    await expect(secondWorkspaceRow).toContainText('0 browsers')
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-next'))?.enabled)
      .toBe(true)
    await expect
      .poll(async () => (await readAppMenuItem(restartApp, 'workspace-previous'))?.enabled)
      .toBe(true)

    await secondWorkspaceRow.getByRole('button', { name: /^Switch/ }).click()
    await expect(workspacesDialog).toHaveCount(0)
    await expect(restartShell.locator('.empty-state')).toBeVisible()
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.name === 'Second Workspace' && state.panes.length === 0,
      'second workspace to become active'
    )

    await restartShell
      .locator('.empty-state')
      .getByRole('button', { name: 'Add browser', exact: true })
      .click()
    const emptyAddMenu = restartShell.getByRole('menu', { name: 'Add browser' })
    await expect(emptyAddMenu).toBeVisible()
    await restartShell.keyboard.press('Escape')
    await expect(emptyAddMenu).toHaveCount(0)

    await restartShell.getByRole('button', { name: 'Open multiple browsers…' }).click()
    const bulkDialog = restartShell.getByRole('dialog', { name: 'Open multiple browsers' })
    await expect(bulkDialog).toBeVisible()
    await bulkDialog.getByLabel('URLs, one per line').fill(
      [
        `${fixture.url}/pane/one?user=alice`,
        `${fixture.url}/pane/two?user=bob`,
        `${fixture.url}/login`
      ].join('\n')
    )
    await bulkDialog.getByLabel('Default viewport').selectOption('iphone-se')
    await bulkDialog.getByRole('button', { name: 'Open 3 browsers' }).click()
    const populatedSecond = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.name === 'Second Workspace' && state.panes.length === 3,
      'bulk browsers in the second workspace'
    )
    expect(new Set(populatedSecond.panes.map((pane) => pane.profileId)).size).toBe(3)
    expect(populatedSecond.panes.every((pane) => pane.viewport.preset === 'iphone-se')).toBe(true)
    for (const pane of populatedSecond.panes.slice(1)) {
      await shellEvaluate(restartApp, `window.browserdeck.closePane(${JSON.stringify(pane.id)})`)
    }
    const populatedSecondOne = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.name === 'Second Workspace' && state.panes.length === 1,
      'single browser after bulk creation'
    )
    const secondPane = populatedSecondOne.panes[0]
    expect(secondPane).toBeTruthy()

    await clickAppMenuCommand(restartApp, 'workspace-manage')
    await expect(workspacesDialog).toBeVisible()
    const renamedWorkspaceRow = workspaceRowById(secondWorkspaceId)
    await renamedWorkspaceRow
      .getByRole('button', { name: /^Workspace actions for/ })
      .click()
    await restartShell.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await renamedWorkspaceRow.getByLabel('Workspace name').fill('Responsive QA')
    await renamedWorkspaceRow.getByRole('button', { name: 'Save' }).click()
    await expect(renamedWorkspaceRow.locator('.workspace-label-text')).toHaveText('Responsive QA')
    await workspacesDialog.getByRole('button', { name: 'Close' }).last().click()
    await expect
      .poll(async () => (await getSnapshot(restartApp)).workspace.name)
      .toBe('Responsive QA')

    await clickAppMenuCommand(restartApp, 'workspace-manage')
    await expect(workspacesDialog).toBeVisible()
    await workspaceRowById(secondWorkspaceId)
      .getByRole('button', { name: /^Workspace actions for/ })
      .click()
    await restartShell.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
    const copyWorkspaceId = await waitFor(
      () => workspaceIdByName('Responsive QA copy').catch(() => ''),
      (id) => id.length > 0,
      'workspace duplicate'
    )
    await expect(workspaceRowById(copyWorkspaceId)).toHaveCount(1)
    await expect(workspaceRowById(copyWorkspaceId)).toContainText('1 browser')
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

    await clickAppMenuCommand(restartApp, 'workspace-manage')
    await expect(workspacesDialog).toBeVisible()
    await originalWorkspaceRow.getByRole('button', { name: /^Switch/ }).click()
    await expect(workspacesDialog).toHaveCount(0)
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

    await clickAppMenuCommand(restartApp, 'workspace-manage')
    await expect(workspacesDialog).toBeVisible()
    for (const id of [copyWorkspaceId, secondWorkspaceId]) {
      const row = workspaceRowById(id)
      await row.getByRole('button', { name: /^Workspace actions for/ }).click()
      await restartShell.getByRole('menuitem', { name: 'Delete', exact: true }).click()
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
        "window.browserdeck.createWorkspace('Stress Workspace')"
      )
    ).toMatchObject({ ok: true })
    const stressWorkspaceId = await waitFor(
      () => workspaceIdByName('Stress Workspace').catch(() => ''),
      (id) => id.length > 0,
      'stress workspace creation'
    )
    await shellEvaluate(restartApp, `window.browserdeck.switchWorkspace(${JSON.stringify(stressWorkspaceId)})`)
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.workspace.id === stressWorkspaceId && state.panes.length === 0,
      'stress workspace activation'
    )
    for (let count = 1; count <= 4; count += 1) {
      await shellEvaluate(restartApp, 'window.browserdeck.addPane()')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.workspace.id === stressWorkspaceId && state.panes.length === count,
        `${count} stress panes`
      )
    }
    expect(await getViewStates(restartApp)).toHaveLength(4)

    // The bottom-bar Select tool draws a marquee, rings every intersecting
    // device, and closes the selected set with Delete.
    await fitAllDevices(restartApp)
    await expect
      .poll(async () => {
        const workspaceBox = await restartShell.locator('.workspace').boundingBox()
        if (!workspaceBox) {
          return false
        }
        const cardBoxes = await restartShell
          .locator('.pane-card')
          .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()))
        return (
          cardBoxes.length === 4 &&
          cardBoxes.every(
            (box) =>
              box.x >= workspaceBox.x - 1 &&
              box.y >= workspaceBox.y - 1 &&
              box.x + box.width <= workspaceBox.x + workspaceBox.width + 1 &&
              box.y + box.height <= workspaceBox.y + workspaceBox.height + 1
          )
        )
      })
      .toBe(true)
    const stressSnapshot = await getSnapshot(restartApp)
    const stressTargets = stressSnapshot.panes.slice(0, 2)
    const stressTargetIds = new Set(stressTargets.map((pane) => pane.id))
    const firstStressCard = restartShell.locator(
      `.pane-card[data-pane-id="${stressTargets[0]?.id}"]`
    )
    const secondStressCard = restartShell.locator(
      `.pane-card[data-pane-id="${stressTargets[1]?.id}"]`
    )
    const firstStressBox = await firstStressCard.boundingBox()
    const secondStressBox = await secondStressCard.boundingBox()
    if (!firstStressBox || !secondStressBox) {
      throw new Error('Stress pane bounds are unavailable')
    }
    const selectModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    const stressWorkspace = await restartShell.locator('.workspace').boundingBox()
    if (!stressWorkspace) {
      throw new Error('Stress workspace bounds are unavailable')
    }
    await restartShell.mouse.click(stressWorkspace.x + 8, stressWorkspace.y + 8)
    await restartShell.keyboard.down(selectModifier)
    await expect(restartShell.locator('.workspace')).toHaveClass(/canvas-select/)
    await restartShell.mouse.move(firstStressBox.x - 8, firstStressBox.y + 12)
    await restartShell.mouse.down()
    await restartShell.mouse.move(
      secondStressBox.x + secondStressBox.width + 8,
      secondStressBox.y + secondStressBox.height + 8,
      { steps: 8 }
    )
    await restartShell.mouse.up()
    await restartShell.keyboard.up(selectModifier)
    await expect(restartShell.locator('.workspace')).not.toHaveClass(/canvas-select/)
    await expect(restartShell.locator('.selection-summary')).toContainText('2 selected')
    await expect(restartShell.locator('.pane-slot-selected')).toHaveCount(2)
    await restartShell.locator('.selection-viewport').click()
    const selectionViewportMenu = restartShell.getByRole('menu', {
      name: 'Viewport for 2 selected browsers'
    })
    await expect(selectionViewportMenu).toBeVisible()
    await selectionViewportMenu.locator('[data-menu-item-id="selection:viewport:iphone-se"]').click()
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        stressTargets.every(
          (pane) => state.panes.find((entry) => entry.id === pane.id)?.viewport.preset === 'iphone-se'
        ),
      'selected browser viewport update'
    )
    await expect(restartShell.locator('.selection-summary')).toContainText('2 selected')
    await restartShell.keyboard.press('Delete')
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.length === 2 &&
        state.panes.every((pane) => !stressTargetIds.has(pane.id)),
      'marquee multi-delete'
    )
    await expect(restartShell.locator('.selection-summary')).toHaveCount(0)
    await expect(
      restartZoomPage.getByRole('button', { name: 'Select browsers' })
    ).toHaveAttribute('aria-pressed', 'false')

    // Restore the four-pane stress workspace expected by the leak cycles.
    for (let count = 3; count <= 4; count += 1) {
      await shellEvaluate(restartApp, 'window.browserdeck.addPane()')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) =>
          state.workspace.id === stressWorkspaceId && state.panes.length === count,
        `${count} stress panes after multi-delete`
      )
    }

    await shellEvaluate(
      restartApp,
      `window.browserdeck.switchWorkspace(${JSON.stringify(originalWorkspaceId)})`
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

    const stressCycles = Number.parseInt(process.env.BROWSERDECK_STRESS_CYCLES ?? '3', 10) || 3
    for (let cycle = 0; cycle < stressCycles; cycle += 1) {
      await shellEvaluate(
        restartApp,
        `window.browserdeck.switchWorkspace(${JSON.stringify(stressWorkspaceId)})`
      )
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.workspace.id === stressWorkspaceId && state.panes.length === 4,
        `stress workspace cycle ${cycle + 1}`
      )
      expect(await getViewStates(restartApp)).toHaveLength(4)

      await shellEvaluate(
        restartApp,
        `window.browserdeck.switchWorkspace(${JSON.stringify(originalWorkspaceId)})`
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
        `window.browserdeck.deleteWorkspace(${JSON.stringify(stressWorkspaceId)})`
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
      await shellEvaluate<{ ok: boolean }>(restartApp, 'window.browserdeck.addPane()')
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
        `window.browserdeck.navigate(${JSON.stringify(pane.id)}, ${JSON.stringify(
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
      await shellEvaluate<{ ok: boolean }>(restartApp, 'window.browserdeck.addPane()')
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
        `window.browserdeck.closePane(${JSON.stringify(pane.id)})`
      )
    }
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 2,
      'Canvas stress panes to close'
    )
    await fitAllDevices(app as ElectronApplication)
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
