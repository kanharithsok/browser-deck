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

async function findShellPage(app: ElectronApplication): Promise<Page> {
  const pages = await waitFor(
    async () => app.windows(),
    (windows) => windows.some((page) => page.url().startsWith('paneflow://shell/index.html')),
    'shell page'
  )
  const shellPage = pages.find((page) => page.url().startsWith('paneflow://shell/index.html'))
  if (!shellPage) {
    throw new Error('Shell page is unavailable')
  }
  return shellPage
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

async function auditWithAxe(page: Page): Promise<AxeViolation[]> {
  const result = await page.evaluate(async () => {
    const axeApi = (window as unknown as { axe?: AxeApi }).axe
    if (!axeApi) {
      throw new Error('axe is not installed')
    }
    return axeApi.run(document, {
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
  })

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
    userDataDir = await mkdtemp(join(tmpdir(), 'paneflow-a11y-'))
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
        banner.getByRole('heading', { level: 1, name: 'PaneFlow' })
      ).toBeVisible()
      await expect(shellPage.getByRole('main', { name: 'Browser workspace' })).toBeVisible()

      const workspaceTrigger = banner.getByRole('button', {
        name: 'Switch workspace, current Workspace'
      })
      await expect(workspaceTrigger).toHaveAccessibleName('Switch workspace, current Workspace')
      await expect(workspaceTrigger).toHaveAttribute('aria-haspopup', 'dialog')
      await expect(workspaceTrigger).toHaveAttribute('aria-expanded', 'false')

      await expect(banner.getByRole('group', { name: 'Layout mode' })).toHaveCount(0)
      await expect(banner.getByLabel('Grid columns')).toHaveCount(0)
      await expect(shellPage.locator('.workspace')).toHaveClass(/workspace-canvas/)

      const paneCount = banner.getByRole('status')
      await expect(paneCount).toHaveText('2 panes')

      const profilesTrigger = banner.getByRole('button', { name: 'Profiles' })
      await expect(profilesTrigger).toHaveAccessibleName('Profiles')
      await expect(profilesTrigger).toHaveAttribute('aria-haspopup', 'dialog')
      await expect(profilesTrigger).toHaveAttribute('aria-expanded', 'false')
      await expect(profilesTrigger).toHaveAttribute('title', 'Manage browser profiles')

      const addPaneButton = banner.getByRole('button', { name: 'Add pane', exact: true })
      await expect(addPaneButton).toBeEnabled()
      await expect(addPaneButton).toHaveAttribute('aria-haspopup', 'menu')
      await expect(addPaneButton).toHaveAttribute('aria-expanded', 'false')
      const reloadAll = banner.getByRole('button', { name: 'Reload all panes' })
      await expect(reloadAll).toHaveAccessibleName('Reload all panes')
      await expect(reloadAll).toHaveAttribute('title', 'Reload all panes')

      const appearanceTrigger = banner.getByRole('button', { name: /^Appearance:/ })
      await expect(appearanceTrigger).toHaveAccessibleName('Appearance: System')
      await expect(appearanceTrigger).toHaveAttribute('aria-haspopup', 'menu')
      await expect(appearanceTrigger).toHaveAttribute('aria-expanded', 'false')

      await shellPage.evaluate(() => document.body.focus())
      await shellPage.keyboard.press('Tab')
      const tabFocus = await readFocus(shellPage)
      expect(tabFocus.ariaLabel).toBe('Switch workspace, current Workspace')
      expect(tabFocus.focusVisible).toBe(true)
      expect(tabFocus.outlineStyle).toBe('solid')
      expect(Number.parseFloat(tabFocus.outlineWidth)).toBeGreaterThanOrEqual(2)

      const axPairs = await readAccessibilityTree(shellPage)
      expect(axPairs).toContain('banner:')
      expect(axPairs).toContain('main:Browser workspace')
      expect(axPairs).toContain('button:Switch workspace, current Workspace')
      expect(axPairs).toContain('button:Profiles')
      expect(axPairs).toContain('button:Add pane')
      expect(axPairs).toContain('button:Reload all panes')
      expect(axPairs).toContain('button:Appearance: System')
    })

    await test.step('canvas add menu exposes menu semantics and keyboard close', async () => {
      const addButton = shellPage.locator('.toolbar .add-pane-button')
      await addButton.click()
      const menu = shellPage.getByRole('menu', { name: 'Add pane' })
      await expect(menu).toBeVisible()
      await expect(addButton).toHaveAttribute('aria-expanded', 'true')
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
        name: `Browser pane: ${firstPane.title}`
      })
      const secondCard = shellPage.getByRole('article', {
        name: `Browser pane: ${secondPane.title}`
      })
      await expect(firstCard).toHaveAttribute('data-pane-id', firstPane.id)
      await expect(secondCard).toHaveAttribute('data-pane-id', secondPane.id)
      await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
      await firstCard.locator('.pane-title').click()
      await expect(firstCard).toHaveAttribute('aria-current', 'true')
      await expect(secondCard).not.toHaveAttribute('aria-current', 'true')
      const globalBar = shellPage.locator('.global-pane-bar')
      const firstAddress = globalBar.getByRole('textbox', {
        name: `Address for ${firstPane.title}`
      })
      await firstAddress.focus()

      for (const card of [firstCard, secondCard]) {
        await expect(card.getByRole('button', { name: 'Maximize pane' })).toHaveAttribute(
          'title',
          'Maximize pane'
        )
        await expect(card.getByRole('button', { name: 'Pane actions' })).toHaveAttribute(
          'title',
          'Pane actions'
        )
        await expect(card.getByRole('button', { name: 'Close pane' })).toHaveAttribute(
          'title',
          'Close pane'
        )
      }
      await expect(globalBar.getByRole('button', { name: 'Go back' })).toBeDisabled()
      await expect(globalBar.getByRole('button', { name: 'Go forward' })).toBeDisabled()
      await expect(globalBar.getByRole('button', { name: 'Reload pane' })).toHaveAttribute(
        'title',
        'Reload pane'
      )
      await expect(
        globalBar.getByRole('combobox', { name: `Viewport preset for ${firstPane.title}` })
      ).toHaveValue('responsive')

      const axPairs = await readAccessibilityTree(shellPage)
      expect(axPairs).toContain(`article:Browser pane: ${firstPane.title}`)
      expect(axPairs).toContain(`textbox:Address for ${firstPane.title}`)
      expect(axPairs).toContain(`combobox:Viewport preset for ${firstPane.title}`)

      await firstAddress.focus()
      await shellPage.keyboard.press('Shift+Tab')
      const previousFocus = await readFocus(shellPage)
      expect(previousFocus.ariaLabel).toBe('Reload pane')
      expect(previousFocus.focusVisible).toBe(true)
      expect(previousFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Tab')
      const addressFocus = await readFocus(shellPage)
      expect(addressFocus.ariaLabel).toBe(`Address for ${firstPane.title}`)

      await shellPage.keyboard.press('Tab')
      const viewportFocus = await readFocus(shellPage)
      expect(viewportFocus.ariaLabel).toBe(`Viewport preset for ${firstPane.title}`)
      expect(viewportFocus.focusVisible).toBe(true)
      expect(viewportFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Fit all panes to view')

      await shellPage.keyboard.press('Tab')
      const actionFocus = await readFocus(shellPage)
      expect(actionFocus.ariaLabel).toBe('Maximize pane')
      await expect(firstCard).toHaveAttribute('aria-current', 'true')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Pane actions')

      await shellPage.keyboard.press('Tab')
      expect((await readFocus(shellPage)).ariaLabel).toBe('Close pane')

      await shellPage.keyboard.press('Tab')
      const nextCardFocus = await readFocus(shellPage)
      expect(nextCardFocus.ariaLabel).toBe('Maximize pane')
      await expect(secondCard).toHaveAttribute('aria-current', 'true')
      await expect(firstCard).not.toHaveAttribute('aria-current', 'true')
      await expect(shellPage.locator('.pane-card-active')).toHaveCount(1)
      await expect(shellPage.locator('.pane-card-active')).toHaveAttribute(
        'data-pane-id',
        secondPane.id
      )
    })

    await test.step('profile dialog names, focus trap, axe audit, and focus return', async () => {
      const profilesTrigger = shellPage
        .locator('.toolbar')
        .getByRole('button', { name: 'Profiles' })
      await profilesTrigger.focus()
      await shellPage.keyboard.press('Enter')
      await expect(profilesTrigger).toHaveAttribute('aria-expanded', 'true')

      const dialog = shellPage.getByRole('dialog', { name: 'Browser profiles' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
      await expect(dialog).toHaveAccessibleName('Browser profiles')
      await expect(dialog).toHaveAccessibleDescription(/Each profile keeps its own cookies/)

      const dialogFocus = await readFocus(shellPage)
      expect(dialogFocus.tagName).toBe('SECTION')
      expect(dialogFocus.className).toContain('profiles-dialog')
      expect(dialogFocus.focusVisible).toBe(true)
      expect(dialogFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Shift+Tab')
      const lastFocus = await readFocus(shellPage)
      expect(lastFocus.tagName).toBe('BUTTON')
      expect(lastFocus.text).toBe('Close')
      expect(lastFocus.className).toContain('text-button')

      await shellPage.keyboard.press('Tab')
      const firstFocus = await readFocus(shellPage)
      expect(firstFocus.ariaLabel).toBe('Close profiles')

      const rows = dialog.locator('.profile-row')
      await expect(rows).toHaveCount(2)
      const labels: string[] = []
      for (const row of await rows.all()) {
        const label = (await row.locator('.profile-label').innerText()).trim()
        labels.push(label)
        await expect(
          row.getByRole('button', { name: `Open pane with profile ${label}` })
        ).toHaveText('Open pane')
        await expect(
          row.getByRole('button', { name: `Rename profile ${label}` })
        ).toHaveText('Rename')
        await expect(
          row.getByRole('button', { name: `Clear browser data for profile ${label}` })
        ).toHaveText('Clear')
        await expect(
          row.getByRole('button', { name: `Delete profile ${label}` })
        ).toHaveText('Delete')
      }
      expect(new Set(labels).size).toBe(2)

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
      expect(axPairs).toContain('dialog:Browser profiles')
      expect(axPairs).toContain(`button:Open pane with profile ${labels[0]}`)
      expect(axPairs).toContain(`button:Rename profile ${labels[1]}`)

      await shellPage.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(profilesTrigger).toHaveAttribute('aria-expanded', 'false')
      const restoredFocus = await readFocus(shellPage)
      expect(restoredFocus.ariaLabel).toBe('Profiles')
      expect(restoredFocus.focusVisible).toBe(true)
      expect(restoredFocus.outlineStyle).toBe('solid')
    })

    await test.step('workspace dialog names, focus trap, axe audit, and focus return', async () => {
      const workspaceTrigger = shellPage.locator('.workspace-switcher')
      await workspaceTrigger.focus()
      await shellPage.keyboard.press('Enter')
      await expect(workspaceTrigger).toHaveAttribute('aria-expanded', 'true')

      const dialog = shellPage.getByRole('dialog', { name: 'Workspaces' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
      await expect(dialog).toHaveAccessibleName('Workspaces')
      await expect(dialog).toHaveAccessibleDescription(/Each workspace keeps its own panes/)

      const dialogFocus = await readFocus(shellPage)
      expect(dialogFocus.tagName).toBe('SECTION')
      expect(dialogFocus.className).toContain('profiles-dialog')
      expect(dialogFocus.focusVisible).toBe(true)
      expect(dialogFocus.outlineStyle).toBe('solid')

      await shellPage.keyboard.press('Shift+Tab')
      const lastFocus = await readFocus(shellPage)
      expect(lastFocus.tagName).toBe('BUTTON')
      expect(lastFocus.text).toBe('Close')

      await shellPage.keyboard.press('Tab')
      const firstFocus = await readFocus(shellPage)
      expect(firstFocus.ariaLabel).toBe('Close workspaces')

      const activeRow = dialog.locator('.workspace-row:has(.workspace-badge)')
      await expect(activeRow).toHaveCount(1)
      const activeName = (await activeRow.locator('.workspace-label-text').innerText()).trim()
      await expect(
        activeRow.getByRole('button', { name: `Switch to workspace ${activeName}` })
      ).toBeDisabled()
      await expect(
        activeRow.getByRole('button', { name: `Rename workspace ${activeName}` })
      ).toBeEnabled()
      await expect(
        activeRow.getByRole('button', { name: `Duplicate workspace ${activeName}` })
      ).toBeEnabled()
      await expect(
        activeRow.getByRole('button', { name: `Delete workspace ${activeName}` })
      ).toBeDisabled()

      const nameInput = dialog.getByRole('textbox', { name: 'New workspace name' })
      await nameInput.fill('Accessible QA')
      await dialog.getByRole('button', { name: 'Create' }).click()
      const createdRow = dialog.locator('.workspace-row').filter({ hasText: 'Accessible QA' })
      await expect(createdRow).toHaveCount(1)

      await expect(
        createdRow.getByRole('button', { name: 'Switch to workspace Accessible QA' })
      ).toBeEnabled()
      await expect(
        createdRow.getByRole('button', { name: 'Rename workspace Accessible QA' })
      ).toBeEnabled()
      await expect(
        createdRow.getByRole('button', { name: 'Duplicate workspace Accessible QA' })
      ).toBeEnabled()
      await expect(
        createdRow.getByRole('button', { name: 'Delete workspace Accessible QA' })
      ).toBeEnabled()

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
      expect(axPairs).toContain('button:Delete workspace Accessible QA')

      await shellPage.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(workspaceTrigger).toHaveAttribute('aria-expanded', 'false')
      const restoredFocus = await readFocus(shellPage)
      expect(restoredFocus.className).toContain('workspace-switcher')
      expect(restoredFocus.focusVisible).toBe(true)
      expect(restoredFocus.outlineStyle).toBe('solid')
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
