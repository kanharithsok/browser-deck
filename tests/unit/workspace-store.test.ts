import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../../src/main/workspace-store'
import { viewportFromPreset } from '../../src/shared/viewports'
import type { WorkspacePaneDefinition } from '../../src/shared/workspace'

const tempDirectories: string[] = []

const PANE_A = '11111111-1111-4111-8111-111111111111'
const PANE_B = '22222222-2222-4222-8222-222222222222'
const PROFILE_A = '33333333-3333-4333-8333-333333333333'
const PROFILE_B = '44444444-4444-4444-8444-444444444444'

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'paneflow-workspace-'))
  tempDirectories.push(directory)
  return directory
}

function pane(
  id: string,
  profileId: string,
  url = 'https://example.com/',
  preset: 'responsive' | 'mobile' = 'responsive'
): WorkspacePaneDefinition {
  return {
    id,
    profileId,
    url,
    viewport: viewportFromPreset(preset)
  }
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('WorkspaceStore', () => {
  it('persists pane definitions and restores them after reload', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    expect(store.hasStoredWorkspace()).toBe(false)

    const panes = [pane(PANE_A, PROFILE_A, 'https://example.com/one', 'mobile')]
    await store.initialize(panes)
    expect(store.hasStoredWorkspace()).toBe(true)

    const appState = JSON.parse(await readFile(join(directory, 'app-state.json'), 'utf8')) as {
      version: number
      activeWorkspaceId: string
    }
    expect(appState).toEqual({ version: 1, activeWorkspaceId: 'default' })

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.hasStoredWorkspace()).toBe(true)
    expect(reloaded.paneDefinitions()).toEqual(panes)
    expect(reloaded.layout()).toMatchObject({
      mode: 'grid',
      columns: 2,
      gridOrder: [PANE_A],
      freeformOrder: [PANE_A]
    })
  })

  it('persists custom pane titles and clears them when omitted', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()

    const namedPane: WorkspacePaneDefinition = {
      ...pane(PANE_A, PROFILE_A),
      title: 'Alice QA'
    }
    await store.initialize([namedPane])

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.paneDefinitions()).toEqual([namedPane])

    await reloaded.setPanes([
      { ...pane(PANE_A, PROFILE_A), title: 'Renamed again' },
      { ...pane(PANE_B, PROFILE_B), title: '  ' }
    ])
    await reloaded.flush()

    const cleared = new WorkspaceStore(directory)
    await cleared.load()
    expect(cleared.paneDefinitions()[0]).toMatchObject({ title: 'Renamed again' })
    expect(cleared.paneDefinitions()[1]).not.toHaveProperty('title')
  })

  it('persists safe window bounds in app state without rewriting pane layout', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    await store.initialize([pane(PANE_A, PROFILE_A)])

    await store.setWindowBounds({ x: 30, y: 40, width: 1120, height: 760 })
    await store.flush()
    expect(store.windowBounds()).toEqual({ x: 30, y: 40, width: 1120, height: 760 })

    await store.setWindowBounds({ x: 0, y: 0, width: 100, height: 80 })
    expect(store.windowBounds()).toEqual({ x: 30, y: 40, width: 1120, height: 760 })

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.windowBounds()).toEqual({ x: 30, y: 40, width: 1120, height: 760 })
    expect(reloaded.windowPresentation()).toEqual({ maximized: false, fullScreen: false })
    expect(reloaded.paneDefinitions()).toEqual([pane(PANE_A, PROFILE_A)])
  })

  it('persists window presentation and clears flags when restored to normal', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    await store.initialize([pane(PANE_A, PROFILE_A)])

    await store.setWindowBounds(
      { x: 30, y: 40, width: 1120, height: 760 },
      { maximized: true, fullScreen: false }
    )
    await store.flush()
    expect(store.windowPresentation()).toEqual({ maximized: true, fullScreen: false })

    const maximized = new WorkspaceStore(directory)
    await maximized.load()
    expect(maximized.windowPresentation()).toEqual({ maximized: true, fullScreen: false })

    await maximized.setWindowBounds(
      { x: 30, y: 40, width: 1120, height: 760 },
      { maximized: false, fullScreen: true }
    )
    await maximized.flush()
    const fullScreen = new WorkspaceStore(directory)
    await fullScreen.load()
    expect(fullScreen.windowPresentation()).toEqual({ maximized: false, fullScreen: true })

    await fullScreen.setWindowBounds(
      { x: 30, y: 40, width: 1120, height: 760 },
      { maximized: false, fullScreen: false }
    )
    await fullScreen.flush()
    const normal = new WorkspaceStore(directory)
    await normal.load()
    expect(normal.windowPresentation()).toEqual({ maximized: false, fullScreen: false })
    expect(JSON.parse(await readFile(join(directory, 'app-state.json'), 'utf8'))).not.toHaveProperty(
      'maximized'
    )
    expect(JSON.parse(await readFile(join(directory, 'app-state.json'), 'utf8'))).not.toHaveProperty(
      'fullScreen'
    )
  })

  it('reconciles pane additions and persists freeform layout state', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    await store.initialize([pane(PANE_A, PROFILE_A)])

    await store.setPanes([pane(PANE_A, PROFILE_A), pane(PANE_B, PROFILE_B, 'about:blank')])
    expect(store.layout().gridOrder).toEqual([PANE_A, PANE_B])
    expect(store.layout().freeformOrder).toEqual([PANE_A, PANE_B])

    await store.setLayout({
      mode: 'freeform',
      columns: 5,
      gridOrder: [PANE_B, PANE_A],
      freeform: {
        [PANE_A]: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }
      },
      freeformOrder: [PANE_B, PANE_A]
    })
    await store.flush()

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.paneDefinitions()).toHaveLength(2)
    expect(reloaded.layout()).toEqual({
      mode: 'freeform',
      columns: 5,
      gridOrder: [PANE_B, PANE_A],
      freeform: {
        [PANE_A]: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }
      },
      freeformOrder: [PANE_B, PANE_A]
    })
  })

  it('creates, lists, switches, renames, and deletes workspaces', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    await store.initialize([pane(PANE_A, PROFILE_A)])

    await expect(store.createWorkspace('   ')).rejects.toThrow()
    await expect(store.createWorkspace('Workspace')).rejects.toThrow('already exists')
    const created = await store.createWorkspace('Second Workspace')
    expect(created).toMatchObject({
      name: 'Second Workspace',
      paneCount: 0,
      active: false
    })

    let list = await store.listWorkspaces()
    expect(list.map((workspace) => workspace.name)).toEqual(['Workspace', 'Second Workspace'])
    expect(list[0]?.active).toBe(true)

    await store.switchWorkspace(created.id)
    expect(store.activeWorkspaceId()).toBe(created.id)
    expect(store.activeWorkspaceName()).toBe('Second Workspace')
    expect(store.paneDefinitions()).toEqual([])

    await store.renameWorkspace(created.id, 'Responsive QA')
    expect(store.activeWorkspaceName()).toBe('Responsive QA')
    list = await store.listWorkspaces()
    expect(list[0]).toMatchObject({ id: created.id, name: 'Responsive QA', active: true })

    await expect(store.deleteWorkspace(created.id)).rejects.toThrow('Switch to another')
    await store.switchWorkspace('default')
    expect(store.paneDefinitions()).toEqual([pane(PANE_A, PROFILE_A)])

    await store.deleteWorkspace(created.id)
    list = await store.listWorkspaces()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('default')

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.activeWorkspaceId()).toBe('default')
    expect(reloaded.activeWorkspaceName()).toBe('Workspace')
  })

  it('persists a valid theme preference and ignores invalid values', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    expect(store.theme()).toBe('system')

    await store.setTheme('dark')
    expect(store.theme()).toBe('dark')
    await store.setTheme('sepia')
    expect(store.theme()).toBe('dark')

    const reloaded = new WorkspaceStore(directory)
    await reloaded.load()
    expect(reloaded.theme()).toBe('dark')
    await reloaded.setTheme('light')
    const secondReload = new WorkspaceStore(directory)
    await secondReload.load()
    expect(secondReload.theme()).toBe('light')
  })

  it('preserves a corrupt workspace and starts without stored panes', async () => {
    const directory = await makeDirectory()
    await mkdir(join(directory, 'workspaces'), { recursive: true })
    await writeFile(join(directory, 'workspaces', 'default.json'), '{ nope', 'utf8')

    const store = new WorkspaceStore(directory)
    await store.load()

    expect(store.hasStoredWorkspace()).toBe(false)
    const entries = await readdir(join(directory, 'workspaces'))
    expect(entries.some((entry) => entry.includes('.corrupt-'))).toBe(true)
  })

  it('preserves a corrupt app-state file and uses the default workspace', async () => {
    const directory = await makeDirectory()
    await writeFile(join(directory, 'app-state.json'), 'not json', 'utf8')

    const store = new WorkspaceStore(directory)
    await store.load()

    expect(store.hasStoredWorkspace()).toBe(false)
    const entries = await readdir(directory)
    expect(entries.some((entry) => entry.includes('app-state.json.corrupt-'))).toBe(true)
  })

  it('rejects invalid pane references before writing', async () => {
    const directory = await makeDirectory()
    const store = new WorkspaceStore(directory)
    await store.load()
    await store.initialize([pane(PANE_A, PROFILE_A)])

    await expect(
      store.setPanes([{ ...pane(PANE_B, PROFILE_B), url: 'javascript:alert(1)' }])
    ).rejects.toThrow()
    await expect(
      store.setPanes([{ ...pane(PANE_B, PROFILE_B), profileId: 'not-a-profile' }])
    ).rejects.toThrow()

    expect(store.paneDefinitions()).toHaveLength(1)
  })
})
