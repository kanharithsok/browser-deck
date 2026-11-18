/// <reference lib="dom" />

import { mkdtemp, rm } from 'node:fs/promises'
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
import type { PaneViewRect, ShellState } from '../../src/shared/ipc'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.cjs'

interface TestHook {
  snapshot(): ShellState
  viewBounds(): Array<{ paneId: string; rect: PaneViewRect }>
  viewStates(): Array<{ paneId: string; rect: PaneViewRect; visible: boolean }>
  viewOrder(): string[]
  readCookie(paneId: string): Promise<string | null>
  webContentsId(paneId: string): number | null
  shellWebContentsId(): number | null
  contentBounds(): PaneViewRect | null
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
  env.PANEFLOW_TEST = '1'
  env.PANEFLOW_USER_DATA_DIR = userDataDir
  env.PANEFLOW_START_URLS = startUrls
  return env
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

async function getSnapshot(app: ElectronApplication): Promise<ShellState> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.snapshot()
  })
}

async function getViewBounds(
  app: ElectronApplication
): Promise<Array<{ paneId: string; rect: PaneViewRect }>> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.viewBounds()
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

async function getViewOrder(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const hook = (globalThis as typeof globalThis & { __paneflowTest?: TestHook }).__paneflowTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.viewOrder()
  })
}

async function readPaneZOrder(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll<HTMLElement>('.pane-slot')).map((slot) => [
        slot.querySelector<HTMLElement>('.pane-card')?.dataset.paneId ?? '',
        getComputedStyle(slot).zIndex
      ])
    )
  )
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

async function readPaneCardOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.pane-card')).map(
      (element) => element.getAttribute('data-pane-id') ?? ''
    )
  )
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
    async () => ({
      dom: await readDomPaneRects(app),
      native: await getViewBounds(app)
    }),
    ({ dom, native }) => dom.length > 0 && rectsAlign(dom, native),
    'native view bounds to align with the shell DOM',
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
        windows.some((page) => page.url().startsWith('file:')) &&
        windows.some((page) => page.url().includes('/pane/one')) &&
        windows.some((page) => page.url().includes('/pane/two')),
      'shell and native pane pages'
    )
    const shellPage = pages.find((page) => page.url().startsWith('file:'))
    const alicePage = pages.find((page) => page.url().includes('/pane/one'))
    const bobPage = pages.find((page) => page.url().includes('/pane/two'))
    if (!shellPage || !alicePage || !bobPage) {
      throw new Error('Expected the shell and both native pane pages')
    }

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

    const aliceDomRect = (await readDomPaneRects(app)).find((entry) => entry.paneId === alicePaneId)
    const aliceViewport = await alicePage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    expect(aliceDomRect).toBeTruthy()
    expect(Math.abs(aliceViewport.width - (aliceDomRect?.rect.width ?? 0))).toBeLessThanOrEqual(1)
    expect(Math.abs(aliceViewport.height - (aliceDomRect?.rect.height ?? 0))).toBeLessThanOrEqual(1)

    // Grid mode: the column control reflows cards and native views together.
    const columnSelect = shellPage.getByLabel('Grid columns')
    await expect(columnSelect).toHaveValue('2')
    const twoColumnCards = await readPaneCardRects(shellPage)
    expect(twoColumnCards).toHaveLength(2)
    expect(Math.abs((twoColumnCards[0]?.y ?? 0) - (twoColumnCards[1]?.y ?? 0))).toBeLessThanOrEqual(1)
    expect(twoColumnCards[1]?.x ?? 0).toBeGreaterThan(twoColumnCards[0]?.x ?? 0)

    await columnSelect.selectOption('5')
    await expect
      .poll(async () => {
        const cards = await readPaneCardRects(shellPage)
        return (
          cards.length === 2 &&
          Math.abs((cards[0]?.y ?? 0) - (cards[1]?.y ?? 0)) <= 1 &&
          Math.abs((cards[0]?.width ?? 0) - (cards[1]?.width ?? 0)) <= 1 &&
          (cards[0]?.width ?? 0) < (twoColumnCards[0]?.width ?? 0)
        )
      })
      .toBe(true)
    await waitForAlignedBounds(app)

    await columnSelect.selectOption('1')
    await expect
      .poll(async () => {
        const cards = await readPaneCardRects(shellPage)
        return (
          cards.length === 2 &&
          Math.abs((cards[0]?.x ?? 0) - (cards[1]?.x ?? 0)) <= 1 &&
          (cards[1]?.y ?? 0) > (cards[0]?.y ?? 0)
        )
      })
      .toBe(true)
    await waitForAlignedBounds(app)

    await columnSelect.selectOption('2')
    await expect
      .poll(async () => {
        const cards = await readPaneCardRects(shellPage)
        return (
          cards.length === 2 &&
          Math.abs((cards[0]?.y ?? 0) - (cards[1]?.y ?? 0)) <= 1 &&
          (cards[1]?.x ?? 0) > (cards[0]?.x ?? 0)
        )
      })
      .toBe(true)
    await waitForAlignedBounds(app)

    // Dragging a pane title row reorders the grid. Native views must hide
    // during the drag so pointer events keep reaching the shell.
    const bobHeader = await shellPage
      .locator('.pane-card')
      .nth(1)
      .locator('.pane-title-row')
      .boundingBox()
    const aliceCard = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!bobHeader || !aliceCard) {
      throw new Error('Pane drag bounds are unavailable')
    }
    await shellPage.mouse.move(bobHeader.x + 30, bobHeader.y + bobHeader.height / 2)
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      aliceCard.x + aliceCard.width / 2,
      aliceCard.y + aliceCard.height / 2,
      { steps: 10 }
    )
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(0)
    await shellPage.mouse.up()
    await expect.poll(() => readPaneCardOrder(shellPage)).toEqual([bobPaneId, alicePaneId])
    await waitForAlignedBounds(app)

    const bobHeaderAgain = await shellPage
      .locator('.pane-card')
      .nth(0)
      .locator('.pane-title-row')
      .boundingBox()
    const aliceCardAgain = await shellPage.locator('.pane-card').nth(1).boundingBox()
    if (!bobHeaderAgain || !aliceCardAgain) {
      throw new Error('Pane drag bounds are unavailable')
    }
    await shellPage.mouse.move(
      bobHeaderAgain.x + 30,
      bobHeaderAgain.y + bobHeaderAgain.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      aliceCardAgain.x + aliceCardAgain.width / 2,
      aliceCardAgain.y + aliceCardAgain.height / 2,
      { steps: 10 }
    )
    await shellPage.mouse.up()
    await expect.poll(() => readPaneCardOrder(shellPage)).toEqual([alicePaneId, bobPaneId])
    await waitForAlignedBounds(app)

    // Freeform mode: move and resize a pane, preserve geometry across mode
    // switches, and keep native views hidden during active manipulation.
    const freeformButton = shellPage.getByRole('button', { name: 'Freeform' })
    const gridButton = shellPage.getByRole('button', { name: 'Grid' })
    const gridAliceRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    const gridBobRect = await shellPage.locator('.pane-card').nth(1).boundingBox()
    if (!gridAliceRect || !gridBobRect) {
      throw new Error('Grid pane bounds are unavailable')
    }

    await freeformButton.click()
    await expect
      .poll(async () => (await readPaneCardOrder(shellPage)).length)
      .toBe(2)
    await waitForAlignedBounds(app)

    const freeformAliceHeader = await shellPage
      .locator('.pane-card')
      .nth(0)
      .locator('.pane-title-row')
      .boundingBox()
    if (!freeformAliceHeader) {
      throw new Error('Freeform pane header is unavailable')
    }
    await shellPage.mouse.move(
      freeformAliceHeader.x + 30,
      freeformAliceHeader.y + freeformAliceHeader.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(
      freeformAliceHeader.x + 110,
      freeformAliceHeader.y + 75,
      { steps: 10 }
    )
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(0)
    await shellPage.mouse.up()
    await waitForAlignedBounds(app)

    const movedAliceRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!movedAliceRect) {
      throw new Error('Moved freeform pane bounds are unavailable')
    }
    expect(movedAliceRect.x).toBeGreaterThan(gridAliceRect.x + 20)

    const resizeHandle = await shellPage
      .locator('.pane-card')
      .nth(0)
      .locator('[data-resize="se"]')
      .boundingBox()
    if (!resizeHandle) {
      throw new Error('Freeform resize handle is unavailable')
    }
    await shellPage.mouse.move(
      resizeHandle.x + resizeHandle.width / 2,
      resizeHandle.y + resizeHandle.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(resizeHandle.x + 70, resizeHandle.y + 50, { steps: 8 })
    await shellPage.mouse.up()
    await waitForAlignedBounds(app)

    const resizedAliceRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!resizedAliceRect) {
      throw new Error('Resized freeform pane bounds are unavailable')
    }
    expect(resizedAliceRect.width).toBeGreaterThan(movedAliceRect.width + 20)
    expect(resizedAliceRect.height).toBeGreaterThanOrEqual(movedAliceRect.height - 1)

    const shrinkHandle = await shellPage
      .locator('.pane-card')
      .nth(0)
      .locator('[data-resize="nw"]')
      .boundingBox()
    if (!shrinkHandle) {
      throw new Error('Freeform shrink handle is unavailable')
    }
    await shellPage.mouse.move(
      shrinkHandle.x + shrinkHandle.width / 2,
      shrinkHandle.y + shrinkHandle.height / 2
    )
    await shellPage.mouse.down()
    await shellPage.mouse.move(shrinkHandle.x + 55, shrinkHandle.y + 45, { steps: 8 })
    await shellPage.mouse.up()
    await waitForAlignedBounds(app)

    const shrunkAliceRect = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!shrunkAliceRect) {
      throw new Error('Shrunk freeform pane bounds are unavailable')
    }
    expect(shrunkAliceRect.width).toBeLessThan(resizedAliceRect.width - 20)
    expect(shrunkAliceRect.height).toBeLessThan(resizedAliceRect.height - 20)

    await shellPage
      .locator('.pane-card')
      .nth(1)
      .getByRole('button', { name: 'Bring pane to front' })
      .click()
    await expect.poll(() => getViewOrder(app as ElectronApplication)).toEqual([alicePaneId, bobPaneId])
    await expect
      .poll(async () => {
        const order = await readPaneZOrder(shellPage)
        return Number(order[bobPaneId as string] ?? 0) > Number(order[alicePaneId as string] ?? 0)
      })
      .toBe(true)

    await shellPage
      .locator('.pane-card')
      .nth(1)
      .getByRole('button', { name: 'Send pane to back' })
      .click()
    await expect.poll(() => getViewOrder(app as ElectronApplication)).toEqual([bobPaneId, alicePaneId])
    await expect
      .poll(async () => {
        const order = await readPaneZOrder(shellPage)
        return Number(order[bobPaneId as string] ?? 0) < Number(order[alicePaneId as string] ?? 0)
      })
      .toBe(true)

    await gridButton.click()
    await waitForAlignedBounds(app)
    const restoredGridAlice = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!restoredGridAlice) {
      throw new Error('Restored grid pane bounds are unavailable')
    }
    expect(Math.abs(restoredGridAlice.x - gridAliceRect.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(restoredGridAlice.width - gridAliceRect.width)).toBeLessThanOrEqual(2)

    await freeformButton.click()
    await waitForAlignedBounds(app)
    const restoredFreeformAlice = await shellPage.locator('.pane-card').nth(0).boundingBox()
    if (!restoredFreeformAlice) {
      throw new Error('Restored freeform pane bounds are unavailable')
    }
    expect(Math.abs(restoredFreeformAlice.x - shrunkAliceRect.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(restoredFreeformAlice.width - shrunkAliceRect.width)).toBeLessThanOrEqual(2)
    await gridButton.click()
    await waitForAlignedBounds(app)

    // Maximize temporarily fills the workspace; unrelated native views hide,
    // and restore returns to the prior grid geometry.
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
    await clickAppMenuCommand(app, 'pane-maximize')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(1)
    await clickAppMenuCommand(app, 'pane-maximize')
    await expect
      .poll(async () => (await getViewStates(app as ElectronApplication)).filter((s) => s.visible).length)
      .toBe(2)
    await clickAppMenuCommand(app, 'pane-layout')
    await expect(freeformButton).toHaveAttribute('aria-pressed', 'true')
    await clickAppMenuCommand(app, 'pane-layout')
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true')
    await waitForAlignedBounds(app)
    await shellPage.emulateMedia({ colorScheme: 'light' })
    expect(
      await shellPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      )
    ).toBe('#f5f5f3')
    await shellPage.emulateMedia({ colorScheme: 'dark' })
    expect(
      await shellPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      )
    ).toBe('#171716')

    // The address chrome is real UI: type and submit in the native pane header,
    // then use the Back button in the shell.
    const firstAddress = shellPage.locator('.pane-card').first().locator('.address-input')
    await firstAddress.fill(`${fixture.url}/other?from=e2e`)
    await firstAddress.press('Enter')
    await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes[0]?.url.includes('/other?from=e2e') ?? false,
      'address bar navigation'
    )
    await shellPage
      .locator('.pane-card')
      .first()
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
    const firstInput = shellPage.locator('.pane-card').first().locator('.address-input')
    await firstInput.fill('javascript:alert(1)')
    await firstInput.press('Enter')
    await expect(shellPage.locator('.pane-card').first().locator('.pane-status')).toContainText(
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
    await shellPage.locator('.toolbar .toolbar-button.primary').click()
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
        shellPage.evaluate(
          () => document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? null
        )
      )
      .toBe(newPane?.id)
    await waitForAlignedBounds(app)

    // A page can destroy its own webContents. The manager must remove the pane
    // rather than leave a stale control surface whose commands throw.
    const blankPage = (app as ElectronApplication)
      .windows()
      .find((page) => page.url() === 'about:blank')
    expect(blankPage).toBeTruthy()
    await blankPage?.evaluate(() => {
      setTimeout(() => window.close(), 0)
      return true
    })
    const afterSelfClose = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) => state.panes.length === 1,
      'self-closed pane removal'
    )
    expect(afterSelfClose.panes[0]?.id).toBe(alicePaneId)

    await app.evaluate(async ({ session }, profileIds) => {
      for (const profileId of profileIds) {
        await session.fromPartition(`persist:paneflow-profile-${profileId}`).cookies.flushStore()
      }
    }, firstProfileIds)

    await app.close()
    app = null

    // Relaunch with the same user data and open the account page directly:
    // persistent profile cookies and the same authenticated sessions must survive.
    const restartApp = await launchApp(userDataDir, `${fixture.url}/account,${fixture.url}/account`)
    app = restartApp

    const restarted = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.length === 2 &&
        state.panes.every((pane) => pane.url.includes('/account') && !pane.isLoading),
      'restarted panes to load account pages'
    )
    expect(restarted.panes.map((pane) => pane.profileId)).toEqual(firstProfileIds)

    const restartedAliceText = await readPaneBodyText(
      restartApp,
      restarted.panes[0]?.id as string
    )
    const restartedBobText = await readPaneBodyText(
      restartApp,
      restarted.panes[1]?.id as string
    )
    expect(restartedAliceText).toContain('Signed in as Alice')
    expect(restartedAliceText).not.toContain('Signed in as Bob')
    expect(restartedBobText).toContain('Signed in as Bob')
    expect(restartedBobText).not.toContain('Signed in as Alice')

    expect(
      await evaluateInPane<string | null>(
        restartApp,
        restarted.panes[0]?.id as string,
        "localStorage.getItem('paneflow_fixture')"
      )
    ).toBe(aliceStorageBeforeRestart)
    expect(
      await evaluateInPane<string | null>(
        restartApp,
        restarted.panes[1]?.id as string,
        "localStorage.getItem('paneflow_fixture')"
      )
    ).toBeNull()

    await waitFor(
      async () => ({
        first: await readCookie(restartApp, restarted.panes[0]?.id as string),
        second: await readCookie(restartApp, restarted.panes[1]?.id as string)
      }),
      ({ first, second }) =>
        (first ?? '').includes('paneflow_user=alice') &&
        (second ?? '').includes('paneflow_user=bob'),
      'persistent profile cookies after restart'
    )

    await waitForAlignedBounds(restartApp)

    // Native-aware scrolling: add panes, force an overflowing single-column
    // grid, and verify native views are hidden when partially off-screen.
    const restartedPages = await waitFor(
      async () => restartApp.windows(),
      (windows) =>
        windows.some((page) => page.url().startsWith('file:')) &&
        windows.filter((page) => page.url().includes('/account')).length === 2,
      'restarted shell and account pages'
    )
    const restartShell = restartedPages.find((page) => page.url().startsWith('file:'))
    if (!restartShell) {
      throw new Error('Restarted shell page is unavailable')
    }

    await restartShell.locator('.toolbar .toolbar-button.primary').click()
    await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 3,
      'third pane creation'
    )
    await restartShell.locator('.toolbar .toolbar-button.primary').click()
    const fourPanes = await waitFor(
      () => getSnapshot(restartApp),
      (state) => state.panes.length === 4,
      'fourth pane creation'
    )

    for (const [offset, path] of ['/pane/three', '/pane/four'].entries()) {
      const index = fourPanes.panes.length - 2 + offset
      const input = restartShell.locator('.pane-card').nth(index).locator('.address-input')
      await input.fill(`${fixture.url}${path}`)
      await input.press('Enter')
    }
    await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.slice(2).every((pane) => pane.url.includes('/pane/') && !pane.isLoading),
      'new panes to load'
    )

    await restartShell.getByLabel('Grid columns').selectOption('1')
    await restartApp.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.setSize(760, 540)
    })

    await expect
      .poll(() =>
        restartShell.evaluate(() => {
          const workspace = document.querySelector('.workspace')
          const grid = document.querySelector('.pane-grid')
          return Boolean(
            workspace &&
              grid &&
              grid.getBoundingClientRect().height > workspace.clientHeight + 4
          )
        })
      )
      .toBe(true)
    await waitForVisibleAlignedBounds(restartApp)

    const workspaceBounds = await shellEvaluate<{ top: number; height: number }>(
      restartApp,
      `(() => {
        const element = document.querySelector('.workspace')
        if (!element) return { top: 0, height: 0 }
        const rect = element.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      })()`
    )
    await expect
      .poll(async () => (await getViewStates(restartApp)).some((state) => !state.visible))
      .toBe(true)
    const topStates = await getViewStates(restartApp)
    expect(topStates).toHaveLength(4)
    expect(topStates.some((state) => state.visible)).toBe(true)
    expect(topStates.some((state) => !state.visible)).toBe(true)
    for (const state of topStates.filter((entry) => entry.visible)) {
      expect(state.rect.y).toBeGreaterThanOrEqual(workspaceBounds.top - 1)
      expect(state.rect.y + state.rect.height).toBeLessThanOrEqual(
        workspaceBounds.top + workspaceBounds.height + 1
      )
    }
    const topHidden = topStates
      .filter((state) => !state.visible)
      .map((state) => state.paneId)
      .sort()
      .join(',')

    await restartShell.evaluate(() => {
      const workspace = document.querySelector('.workspace')
      if (workspace instanceof HTMLElement) {
        workspace.scrollTop = workspace.scrollHeight
      }
    })

    await expect
      .poll(async () => {
        const states = await getViewStates(restartApp)
        return states
          .filter((state) => !state.visible)
          .map((state) => state.paneId)
          .sort()
          .join(',')
      })
      .not.toBe(topHidden)

    await waitForVisibleAlignedBounds(restartApp)
    const bottomStates = await getViewStates(restartApp)
    expect(bottomStates.some((state) => state.visible)).toBe(true)
    expect(bottomStates.some((state) => !state.visible)).toBe(true)
    for (const state of bottomStates.filter((entry) => entry.visible)) {
      expect(state.rect.y).toBeGreaterThanOrEqual(workspaceBounds.top - 1)
      expect(state.rect.y + state.rect.height).toBeLessThanOrEqual(
        workspaceBounds.top + workspaceBounds.height + 1
      )
    }

    // Eight-pane Phase 2 stress check: reset to a comfortable two-column grid,
    // add four more panes, and verify all native views remain aligned.
    await restartShell.getByLabel('Grid columns').selectOption('2')
    await restartApp.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('PaneFlow window not found')
      }
      window.setSize(1280, 860)
    })
    await restartShell.evaluate(() => {
      const workspace = document.querySelector('.workspace')
      if (workspace instanceof HTMLElement) {
        workspace.scrollTop = 0
      }
    })
    for (let count = 5; count <= 8; count += 1) {
      await clickAppMenuCommand(restartApp, 'pane-add')
      await waitFor(
        () => getSnapshot(restartApp),
        (state) => state.panes.length === count,
        `${count} panes after menu add`
      )
    }
    await waitForAlignedBounds(restartApp)
    const eightPaneRects = await readPaneCardRects(restartShell)
    expect(eightPaneRects).toHaveLength(8)
    expect(new Set(eightPaneRects.map((rect) => Math.round(rect.y))).size).toBeGreaterThanOrEqual(4)

    // Exercise the full 8-pane workspace in freeform: tidy, drag/overlap,
    // resize, explicit z-order, and maximize/restore with alignment intact.
    await restartShell.getByRole('button', { name: 'Freeform' }).click()
    await waitForAlignedBounds(restartApp)
    const eightHeader = await restartShell
      .locator('.pane-card')
      .nth(0)
      .locator('.pane-title-row')
      .boundingBox()
    if (!eightHeader) {
      throw new Error('Eight-pane freeform header is unavailable')
    }
    await restartShell.mouse.move(eightHeader.x + 30, eightHeader.y + eightHeader.height / 2)
    await restartShell.mouse.down()
    await restartShell.mouse.move(eightHeader.x + 130, eightHeader.y + 80, { steps: 10 })
    await restartShell.mouse.up()
    await waitForAlignedBounds(restartApp)

    const eightResize = await restartShell
      .locator('.pane-card')
      .nth(0)
      .locator('[data-resize="se"]')
      .boundingBox()
    if (!eightResize) {
      throw new Error('Eight-pane freeform resize handle is unavailable')
    }
    await restartShell.mouse.move(
      eightResize.x + eightResize.width / 2,
      eightResize.y + eightResize.height / 2
    )
    await restartShell.mouse.down()
    await restartShell.mouse.move(eightResize.x + 45, eightResize.y + 35, { steps: 8 })
    await restartShell.mouse.up()
    await waitForAlignedBounds(restartApp)

    await restartShell
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Send pane to back' })
      .click()
    await restartShell
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Bring pane to front' })
      .click()
    const visibleBeforeMaximize = (await getViewStates(restartApp)).filter(
      (state) => state.visible
    ).length
    expect(visibleBeforeMaximize).toBeGreaterThan(0)
    await restartShell
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Maximize pane' })
      .click()
    await expect
      .poll(async () => (await getViewStates(restartApp)).filter((s) => s.visible).length)
      .toBe(1)
    await restartShell
      .locator('.pane-card')
      .nth(0)
      .getByRole('button', { name: 'Restore pane' })
      .click()
    await expect
      .poll(async () => (await getViewStates(restartApp)).filter((s) => s.visible).length)
      .toBe(visibleBeforeMaximize)
    await waitForAlignedBounds(restartApp)
    await restartShell.getByRole('button', { name: 'Grid' }).click()
    await waitForAlignedBounds(restartApp)
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
