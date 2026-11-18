/// <reference lib="dom" />

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import type { PaneViewRect, ShellState } from '../../src/shared/ipc'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.cjs'

interface TestHook {
  snapshot(): ShellState
  viewBounds(): Array<{ paneId: string; rect: PaneViewRect }>
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

test('Phase 0 native views: isolation, bounds, lifecycle, and restart persistence', async () => {
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
      .toBe('1')
    expect(await bobPage.evaluate(() => localStorage.getItem('paneflow_fixture'))).toBeNull()

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

    // System light/dark appearance uses the shared design tokens.
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

    // Main-process validation rejects unsupported schemes and unknown panes;
    // renderer-side validation alone is not the security boundary.
    const rejectedNavigation = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.navigate(${JSON.stringify(alicePaneId)}, 'javascript:alert(1)')`
    )
    expect(rejectedNavigation.ok).toBe(false)

    const rejectedBounds = await shellEvaluate<{ ok: boolean }>(
      app,
      `window.paneflow.setPaneBounds([{ paneId: 'unknown-pane', rect: { x: 0, y: 0, width: 400, height: 300 } }])`
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

    // Remaining pane is untouched by the close.
    expect(await readCookie(app, alicePaneId as string)).toContain('alice')

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

    // Relaunch with the same user data and no ?user query: persistent cookies
    // and the same profile partitions must survive.
    const restartApp = await launchApp(userDataDir, `${fixture.url}/pane/check,${fixture.url}/pane/check`)
    app = restartApp

    const restarted = await waitFor(
      () => getSnapshot(restartApp),
      (state) =>
        state.panes.length === 2 &&
        state.panes.every((pane) => pane.url.includes('/pane/check') && !pane.isLoading),
      'restarted panes to load'
    )
    expect(restarted.panes.map((pane) => pane.profileId)).toEqual(firstProfileIds)

    await waitFor(
      async () => ({
        first: await readCookie(restartApp, restarted.panes[0]?.id as string),
        second: await readCookie(restartApp, restarted.panes[1]?.id as string)
      }),
      ({ first, second }) =>
        (first ?? '').includes('paneflow_user=alice') &&
        (second ?? '').includes('paneflow_user=bob'),
      'persistent cookies after restart'
    )

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
