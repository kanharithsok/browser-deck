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
import axe from 'axe-core'
import type { ShellState } from '../../src/shared/ipc'
import { SHELL_ZOOM_URL } from '../../src/shared/shell'
import { startFixtureServer, type FixtureServer } from '../fixtures/server.cjs'

interface TestHook {
  snapshot(): ShellState
}

interface FocusInfo {
  tagName: string
  className: string
  ariaLabel: string | null
  text: string
  focusVisible: boolean
  outlineStyle: string
  outlineWidth: string
}

interface AxeNodeResult {
  target: Array<string | number>
  failureSummary?: string
}

interface AxeViolation {
  id: string
  impact: string | null
  nodes: AxeNodeResult[]
}

interface AxeRunResult {
  violations: AxeViolation[]
}

interface AxeApi {
  run(context: Document | Element, options: Record<string, unknown>): Promise<AxeRunResult>
}

interface AxNode {
  ignored: boolean
  role?: { value?: string }
  name?: { value?: string }
}

function testEnv(userDataDir: string, startUrls: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  env.BROWSERDECK_TEST = '1'
  env.BROWSERDECK_USER_DATA_DIR = userDataDir
  env.BROWSERDECK_START_URLS = startUrls
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
    const hook = (globalThis as typeof globalThis & { __browserdeckTest?: TestHook }).__browserdeckTest
    if (!hook) {
      throw new Error('Test hook is not installed')
    }
    return hook.snapshot()
  })
}

async function findShellPage(app: ElectronApplication): Promise<Page> {
  const pages = await waitFor(
    async () => app.windows(),
    (windows) => windows.some((page) => page.url().startsWith('browserdeck://shell/index.html')),
    'shell page'
  )
  const shellPage = pages.find((page) => page.url().startsWith('browserdeck://shell/index.html'))
  if (!shellPage) {
    throw new Error('Shell page is unavailable')
  }
  return shellPage
}

async function findZoomPage(app: ElectronApplication): Promise<Page> {
  const pages = await waitFor(
    async () => app.windows(),
    (windows) => windows.some((page) => page.url() === SHELL_ZOOM_URL),
    'canvas controls page'
  )
  const zoomPage = pages.find((page) => page.url() === SHELL_ZOOM_URL)
  if (!zoomPage) {
    throw new Error('Canvas controls page is unavailable')
  }
  return zoomPage
}

async function clickAppMenuCommand(
  app: ElectronApplication,
  menuItemId: string
): Promise<void> {
  await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (!item) {
      throw new Error(`Menu item ${id} is unavailable`)
    }
    item.click()
  }, menuItemId)
}

async function readFocus(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      throw new Error('No HTML element has focus')
    }
    const style = getComputedStyle(active)
    return {
      tagName: active.tagName,
      className: active.className,
      ariaLabel: active.getAttribute('aria-label'),
      text: (active.textContent ?? '').trim(),
      focusVisible: active.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    }
  })
}

async function installAxe(page: Page): Promise<void> {
  // The shell CSP blocks inline <script> tags. CDP Runtime.evaluate is not
  // subject to the page CSP, so axe can still be evaluated in the real shell.
  await page.evaluate((source) => {
    const target = window as unknown as { axe?: unknown }
    if (!target.axe) {
      new Function(source)()
    }
  }, axe.source)
}

async function auditWithAxe(page: Page, selector?: string): Promise<AxeViolation[]> {
  const result = await page.evaluate(async (selector) => {
    const axeApi = (window as unknown as { axe?: AxeApi }).axe
    if (!axeApi) {
      throw new Error('axe is not installed')
    }
    const context = selector ? document.querySelector(selector) : document
    if (!context) {
      throw new Error(`Axe context ${selector ?? 'document'} is unavailable`)
    }
    return axeApi.run(context, {
      runOnly: {
        type: 'tag',
        values: [
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22a',
          'wcag22aa',
          'best-practice'
        ]
      }
    })
  }, selector ?? null)

  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary
    }))
  }))
}

async function readAccessibilityTree(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page)
  try {
    const result = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: AxNode[]
    }
    return result.nodes
      .filter((node) => !node.ignored && node.role?.value)
      .map((node) => `${node.role?.value ?? ''}:${node.name?.value ?? ''}`)
  } finally {
    await session.detach().catch(() => undefined)
  }
}

test('Accessibility: roles, names, focus, dialogs, and axe audit', async () => {
  test.setTimeout(180_000)

  let fixture: FixtureServer | null = null
  let userDataDir = ''
  let app: ElectronApplication | null = null

  try {
    fixture = await startFixtureServer()
    userDataDir = await mkdtemp(join(tmpdir(), 'browserdeck-a11y-'))
    app = await launchApp(
      userDataDir,
      `${fixture.url}/pane/one?user=alice,${fixture.url}/pane/two?user=bob`
    )

    const initial = await waitFor(
      () => getSnapshot(app as ElectronApplication),
      (state) =>
        state.panes.length === 2 &&
        state.panes.every(
          (pane) => pane.url.includes('/pane/') && !pane.isLoading && pane.title.length > 0
        ),
      'two titled fixture panes'
    )
    const firstPane = initial.panes[0]
    const secondPane = initial.panes[1]
    if (!firstPane || !secondPane) {
      throw new Error('Expected two fixture panes')
    }

    const shellPage = await findShellPage(app)
    await installAxe(shellPage)

    await test.step('shell toolbar exposes landmarks, names, states, and focus', async () => {
      const banner = shellPage.getByRole('banner')
      await expect(banner).toBeVisible()
      await expect(
        banner.getByRole('heading', { level: 1, name: 'BrowserDeck' })
      ).toHaveCount(1)
      await expect(shellPage.getByRole('main', { name: 'Browser workspace' })).toBeVisible()

      await expect(banner.getByRole('group', { name: 'Layout mode' })).toHaveCount(0)
      await expect(banner.getByLabel('Grid columns')).toHaveCount(0)
      await expect(shellPage.locator('.workspace')).toHaveClass(/workspace-canvas/)
      await expect(shellPage.locator('.pane-card .address-input')).toHaveCount(2)

      const paneCount = banner.locator('.pane-count')
      await expect(paneCount).toHaveText('2 browsers')

      const addPaneButton = banner.getByRole('button', { name: 'Add browser', exact: true })
      await expect(addPaneButton).toBeEnabled()
      await expect(addPaneButton).toHaveAttribute('aria-haspopup', 'menu')
      await expect(addPaneButton).toHaveAttribute('aria-expanded', 'false')
      await expect(banner.getByRole('button', { name: 'Profiles' })).toHaveCount(0)
      await expect(banner.getByRole('button', { name: 'Hand tool' })).toHaveCount(0)
      await expect(banner.getByRole('button', { name: /^Appearance:/ })).toHaveCount(0)
      await expect(banner.locator('.workspace-switcher')).toHaveCount(0)

      await shellPage.evaluate(() => document.body.focus())
      await shellPage.keyboard.press('Tab')
      const tabFocus = await readFocus(shellPage)
      expect(tabFocus.ariaLabel).toBe('Add browser')
      expect(tabFocus.focusVisible).toBe(true)
      expect(tabFocus.outlineStyle).toBe('solid')
      expect(Number.parseFloat(tabFocus.outlineWidth)).toBeGreaterThanOrEqual(2)

      const axPairs = await readAccessibilityTree(shellPage)
      expect(axPairs).toContain('banner:')
      expect(axPairs).toContain('main:Browser workspace')
      expect(axPairs).toContain('button:Reload browser')
      expect(axPairs).toContain('button:Add browser')
      expect(axPairs.some((pair) => pair.startsWith('textbox:Address for '))).toBe(true)
    })

    await test.step('bottom canvas bar exposes named controls and keyboard menus', async () => {
      const zoomPage = await findZoomPage(app as ElectronApplication)
      await installAxe(zoomPage)

      const bar = zoomPage.getByRole('region', { name: 'Canvas controls' })
      await expect(bar).toBeVisible()
      await expect(zoomPage.getByRole('button', { name: 'Hand tool' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      await expect(zoomPage.getByRole('button', { name: 'Zoom out' })).toBeVisible()
      await expect(zoomPage.getByRole('button', { name: 'Choose zoom level' })).toBeVisible()
      await expect(zoomPage.getByRole('button', { name: 'Zoom in' })).toBeVisible()
      const findDevice = zoomPage.getByRole('button', { name: 'Find browser' })
      await expect(findDevice).toHaveAccessibleName('Find browser')
      await expect(findDevice).toHaveAttribute('title', 'Find browser (Cmd/Ctrl+K)')
      const reloadAll = zoomPage.getByRole('button', { name: 'Reload all browsers' })
      await expect(reloadAll).toHaveAccessibleName('Reload all browsers')
      await expect(reloadAll).toHaveAttribute('title', 'Reload all browsers')
      const selectDevices = zoomPage.getByRole('button', { name: 'Select browsers' })
      await expect(selectDevices).toHaveAccessibleName('Select browsers')
      await expect(selectDevices).toHaveAttribute('aria-pressed', 'false')
      await expect(selectDevices).toHaveAttribute(
        'title',
        'Select browsers (drag to select, Delete to close)'
      )
      const appearanceTrigger = zoomPage.getByRole('button', { name: 'Appearance: System' })
      await expect(appearanceTrigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(await auditWithAxe(zoomPage, '.canvas-bar')).toEqual([])

      const hand = zoomPage.getByRole('button', { name: 'Hand tool' })
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'true')
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'false')

      await appearanceTrigger.click()
      const appearanceMenu = shellPage.getByRole('menu', { name: 'Appearance' })
      await expect(appearanceMenu).toBeVisible()
      await expect
        .poll(() =>
          shellPage.evaluate(
            () => document.activeElement?.classList.contains('app-menu') ?? false
          )
        )
        .toBe(true)
      await shellPage.keyboard.press('ArrowDown')
      const appearanceFocus = await shellPage.evaluate(() => {
        const active = document.activeElement
        return {
          role: active?.getAttribute('role') ?? null,
          text: (active?.textContent ?? '').trim()
        }
      })
      expect(appearanceFocus.role).toBe('menuitemradio')
      expect(appearanceFocus.text).toContain('System')
      await shellPage.keyboard.press('Escape')
      await expect(appearanceMenu).toHaveCount(0)

      await zoomPage.getByRole('button', { name: 'Choose zoom level' }).click()
      const zoomMenu = shellPage.getByRole('menu', { name: 'Zoom' })
      await expect(zoomMenu).toBeVisible()
      await expect
        .poll(() =>
          shellPage.evaluate(
            () => document.activeElement?.classList.contains('app-menu') ?? false
          )
        )
        .toBe(true)
      await shellPage.keyboard.press('ArrowDown')
      const focusedItem = await shellPage.evaluate(() => {
        const active = document.activeElement
        return {
          role: active?.getAttribute('role') ?? null,
          text: (active?.textContent ?? '').trim()
        }
      })
      expect(focusedItem.role).toBe('menuitemradio')
      expect(focusedItem.text).toContain('25%')
      await shellPage.keyboard.press('Escape')
      await expect(zoomMenu).toHaveCount(0)
    })

    await test.step('canvas add menu exposes menu semantics and keyboard close', async () => {
      const addButton = shellPage.locator('.toolbar .add-pane-button')
      await addButton.click()
      const menu = shellPage.getByRole('menu', { name: 'Add browser' })
      await expect(menu).toBeVisible()
      await expect(addButton).toHaveAttribute('aria-expanded', 'true')
      await expect
        .poll(() =>
          shellPage.evaluate(
            () => document.activeElement?.classList.contains('app-menu') ?? false
          )
        )
        .toBe(true)
      await shellPage.keyboard.press('ArrowDown')
      const focusedItem = await shellPage.evaluate(() => {
        const active = document.activeElement
        return {
          role: active?.getAttribute('role') ?? null,
          text: active?.textContent?.trim() ?? ''
        }
      })
      expect(focusedItem.role).toBe('menuitem')
      expect(focusedItem.text).toContain('Responsive')
      await shellPage.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(addButton).toHaveAttribute('aria-expanded', 'false')
    })

    await test.step('pane cards expose named controls and a logical focus order', async () => {
      const firstCard = shellPage.getByRole('article', {
        name: `Browser: ${firstPane.title}`
      })
      const secondCard = shellPage.getByRole('article', {
        name: `Browser: ${secondPane.title}`
      })
      await expect(firstCard).toHaveAttribute('data-pane-id', firstPane.id)
      await expect(secondCard).toHaveAttribute('data-pane-id', secondPane.id)
      await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
      await firstCard.locator('.pane-title').click()
      await expect(firstCard).toHaveAttribute('aria-current', 'true')
      await expect(secondCard).not.toHaveAttribute('aria-current', 'true')
      const firstAddress = firstCard.getByRole('textbox', {
        name: `Address for browser ${firstPane.title}`
      })
      await firstAddress.focus()

      for (const card of [firstCard, secondCard]) {
        await expect(card.getByRole('button', { name: 'Go back' })).toBeDisabled()
        await expect(card.getByRole('button', { name: 'Go forward' })).toBeDisabled()
        await expect(card.getByRole('button', { name: 'Reload browser' })).toHaveAttribute(
          'title',
          'Reload browser'
        )
        await expect(card.getByRole('button', { name: 'Browser actions' })).toHaveAttribute(
          'title',
          'Browser actions'
        )
        await expect(card.getByRole('button', { name: 'Close browser' })).toHaveAttribute(
          'title',
          'Close browser (Delete)'
        )
      }
      const viewportTrigger = firstCard.getByRole('button', {
        name: `Viewport preset for browser ${firstPane.title}`
      })
      await expect(viewportTrigger).toHaveAttribute('data-preset', 'responsive')
      await expect(viewportTrigger).toHaveAttribute('aria-haspopup', 'menu')
      await expect(viewportTrigger).toHaveAttribute('aria-expanded', 'false')

      const axPairs = await readAccessibilityTree(shellPage)
      expect(axPairs).toContain(`article:Browser: ${firstPane.title}`)
      expect(axPairs).toContain(`textbox:Address for browser ${firstPane.title}`)
      expect(
        axPairs.some((pair) =>
          pair.startsWith(`button:Viewport preset for browser ${firstPane.title}`)
        )
      ).toBe(true)

      await firstAddress.focus()
      const addressFocus = await readFocus(shellPage)
      expect(addressFocus.ariaLabel).toBe(`Address for browser ${firstPane.title}`)

      await viewportTrigger.focus()
      const viewportFocus = await readFocus(shellPage)
      expect(viewportFocus.ariaLabel).toContain(`Viewport preset for browser ${firstPane.title}`)
      expect(viewportFocus.focusVisible).toBe(true)
      expect(viewportFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Reload browser')
      await expect(firstCard).toHaveAttribute('aria-current', 'true')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Open in browser')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Browser actions')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Close browser')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe(
        `Address for browser ${firstPane.title}`
      )

      await shellPage.keyboard.press('Tab')
      const nextCardFocus = await readFocus(shellPage)
      expect(nextCardFocus.ariaLabel).toContain(
        `Viewport preset for browser ${secondPane.title}`
      )
      await expect(secondCard).toHaveAttribute('aria-current', 'true')
      await expect(firstCard).not.toHaveAttribute('aria-current', 'true')
      await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
      await expect(shellPage.locator('.pane-card-active')).toHaveAttribute(
        'data-pane-id',
        secondPane.id
      )
    })

    await test.step('workspace dialog names, focus trap, axe audit, and focus return', async () => {
      await clickAppMenuCommand(app as ElectronApplication, 'workspace-manage')

      const dialog = shellPage.getByRole('dialog', { name: 'Workspaces' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
      await expect(dialog).toHaveAccessibleName('Workspaces')
      await expect(dialog).toHaveAccessibleDescription(/Each workspace keeps its own browsers/)

      const dialogFocus = await readFocus(shellPage)
      expect(dialogFocus.tagName).toBe('SECTION')
      expect(dialogFocus.className).toContain('profiles-dialog')
      expect(dialogFocus.focusVisible).toBe(true)
      expect(dialogFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Shift+Tab')
      const lastFocus = await readFocus(shellPage)
      expect(lastFocus.tagName).toBe('BUTTON')
      expect(lastFocus.text).toBe('Export active')

      await shellPage.keyboard.press('Tab')
      const firstFocus = await readFocus(shellPage)
      expect(firstFocus.ariaLabel).toBe('Close workspaces')

      const activeRow = dialog.locator('.workspace-row:has(.workspace-badge)')
      await expect(activeRow).toHaveCount(1)
      const activeName = (await activeRow.locator('.workspace-label-text').innerText()).trim()
      await expect(
        activeRow.getByRole('button', { name: `Workspace ${activeName} is active` })
      ).toHaveAttribute('aria-disabled', 'true')
      const activeActions = activeRow.getByRole('button', {
        name: `Workspace actions for ${activeName}`
      })
      await expect(activeActions).toBeEnabled()
      await activeActions.click()
      const activeMenu = shellPage.getByRole('menu', {
        name: `Workspace actions for ${activeName}`
      })
      await expect(activeMenu).toBeVisible()
      await expect(activeMenu.getByRole('menuitem', { name: 'Switch', exact: true })).toBeDisabled()
      await expect(activeMenu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeEnabled()
      await expect(
        activeMenu.getByRole('menuitem', { name: 'Duplicate', exact: true })
      ).toBeEnabled()
      await expect(activeMenu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled()
      await shellPage.keyboard.press('Escape')
      await expect(activeMenu).toHaveCount(0)
      await expect(dialog).toBeVisible()

      const nameInput = dialog.getByRole('textbox', { name: 'New workspace name' })
      await nameInput.fill('Accessible QA')
      await dialog.getByRole('button', { name: 'Create' }).click()
      const createdRow = dialog.locator('.workspace-row').filter({ hasText: 'Accessible QA' })
      await expect(createdRow).toHaveCount(1)

      await expect(
        createdRow.getByRole('button', { name: 'Switch to workspace Accessible QA' })
      ).toBeEnabled()
      const createdActions = createdRow.getByRole('button', {
        name: 'Workspace actions for Accessible QA'
      })
      await expect(createdActions).toBeEnabled()
      await createdActions.click()
      const createdMenu = shellPage.getByRole('menu', {
        name: 'Workspace actions for Accessible QA'
      })
      await expect(createdMenu).toBeVisible()
      await expect(createdMenu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeEnabled()
      await expect(
        createdMenu.getByRole('menuitem', { name: 'Duplicate', exact: true })
      ).toBeEnabled()
      await expect(createdMenu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeEnabled()
      await shellPage.keyboard.press('Escape')
      await expect(createdMenu).toHaveCount(0)

      const buttonNames = await dialog
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map(
            (button) =>
              button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()
          )
        )
      expect(new Set(buttonNames).size).toBe(buttonNames.length)

      expect(await auditWithAxe(shellPage)).toEqual([])

      const axPairs = await readAccessibilityTree(shellPage)
      expect(axPairs).toContain('dialog:Workspaces')
      expect(axPairs).toContain('textbox:New workspace name')
      expect(axPairs).toContain('button:Switch to workspace Accessible QA')
      expect(axPairs).toContain('button:Workspace actions for Accessible QA')

      await shellPage.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      const restoredFocus = await readFocus(shellPage)
      expect(restoredFocus.tagName).toBe('INPUT')
      expect(restoredFocus.ariaLabel).toMatch(/^Address for /)
    })
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
