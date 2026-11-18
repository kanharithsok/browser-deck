import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isValidProfileId } from '../shared/profiles'
import { isAllowedNavigationUrl } from '../shared/url'
import { parsePaneViewport } from '../shared/viewports'
import {
  APP_STATE_VERSION,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  MAX_WORKSPACE_PANES,
  WORKSPACE_STORE_VERSION,
  defaultWorkspaceLayout,
  isValidPaneId,
  normalizeWorkspaceLayout,
  parseAppStateData,
  parseWorkspaceData,
  type AppStateData,
  type WorkspaceData,
  type WorkspaceLayout,
  type WorkspacePaneDefinition
} from '../shared/workspace'
import {
  preserveCorruptFile,
  readJsonFile,
  writeJsonAtomically
} from './json-file'

const APP_STATE_FILE = 'app-state.json'
const WORKSPACES_DIRECTORY = 'workspaces'

function validatePanes(panes: WorkspacePaneDefinition[]): WorkspacePaneDefinition[] {
  if (panes.length > MAX_WORKSPACE_PANES) {
    throw new Error('Too many workspace panes.')
  }
  const seen = new Set<string>()
  return panes.map((pane) => {
    if (!isValidPaneId(pane.id) || seen.has(pane.id)) {
      throw new Error('Invalid or duplicated pane ID.')
    }
    if (!isValidProfileId(pane.profileId)) {
      throw new Error('Invalid profile ID.')
    }
    if (!isAllowedNavigationUrl(pane.url)) {
      throw new Error('Invalid pane URL.')
    }
    const viewport = parsePaneViewport(pane.viewport)
    if (!viewport.ok) {
      throw new Error(viewport.error)
    }
    seen.add(pane.id)
    return {
      id: pane.id,
      profileId: pane.profileId,
      url: pane.url,
      viewport: viewport.viewport
    }
  })
}

function copyPane(pane: WorkspacePaneDefinition): WorkspacePaneDefinition {
  return {
    id: pane.id,
    profileId: pane.profileId,
    url: pane.url,
    viewport: { ...pane.viewport }
  }
}

function copyLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    mode: layout.mode,
    columns: layout.columns,
    gridOrder: [...layout.gridOrder],
    freeform: Object.fromEntries(
      Object.entries(layout.freeform).map(([paneId, rect]) => [paneId, { ...rect }])
    ),
    freeformOrder: [...layout.freeformOrder]
  }
}

/**
 * Owns the validated, versioned workspace and app-state JSON. Pane browser
 * partitions and profile metadata stay in ProfileStore; workspace files hold
 * only pane references, URLs, viewport settings, and layout state.
 */
export class WorkspaceStore {
  private appState: AppStateData = {
    version: APP_STATE_VERSION,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID
  }
  private workspace: WorkspaceData | null = null
  private loaded = false
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  private get appStatePath(): string {
    return join(this.directory, APP_STATE_FILE)
  }

  private get workspacePath(): string {
    return join(
      this.directory,
      WORKSPACES_DIRECTORY,
      `${this.appState.activeWorkspaceId}.json`
    )
  }

  async load(): Promise<void> {
    try {
      await mkdir(join(this.directory, WORKSPACES_DIRECTORY), { recursive: true })
    } catch (error) {
      console.error('Could not create the workspace directory.', error)
      this.loaded = true
      return
    }

    try {
      const appRead = await readJsonFile(this.appStatePath)
      if (appRead.status === 'ok') {
        const parsed = parseAppStateData(appRead.value)
        if (parsed.ok) {
          this.appState = parsed.data
        } else {
          await preserveCorruptFile(this.appStatePath)
        }
      } else if (appRead.status === 'invalid') {
        await preserveCorruptFile(this.appStatePath)
      }

      const workspaceRead = await readJsonFile(this.workspacePath)
      if (workspaceRead.status === 'ok') {
        const parsed = parseWorkspaceData(workspaceRead.value)
        if (parsed.ok) {
          this.workspace = parsed.data
        } else {
          await preserveCorruptFile(this.workspacePath)
        }
      } else if (workspaceRead.status === 'invalid') {
        await preserveCorruptFile(this.workspacePath)
      }
    } catch (error) {
      console.error('Could not read workspace state; starting with defaults.', error)
    }

    this.loaded = true
  }

  hasStoredWorkspace(): boolean {
    return this.workspace !== null
  }

  paneDefinitions(): WorkspacePaneDefinition[] {
    return (this.workspace?.panes ?? []).map(copyPane)
  }

  layout(): WorkspaceLayout {
    if (!this.workspace) {
      return defaultWorkspaceLayout([])
    }
    return copyLayout(this.workspace.layout)
  }

  async initialize(panes: WorkspacePaneDefinition[]): Promise<void> {
    this.ensureLoaded()
    const validated = validatePanes(panes)
    const ids = validated.map((pane) => pane.id)
    this.workspace = {
      version: WORKSPACE_STORE_VERSION,
      id: this.appState.activeWorkspaceId,
      name: this.workspace?.name ?? DEFAULT_WORKSPACE_NAME,
      panes: validated.map(copyPane),
      layout: defaultWorkspaceLayout(ids),
      updatedAt: new Date().toISOString()
    }
    await this.save()
  }

  async setPanes(panes: WorkspacePaneDefinition[]): Promise<void> {
    this.ensureLoaded()
    const validated = validatePanes(panes)
    const ids = validated.map((pane) => pane.id)
    this.workspace = {
      version: WORKSPACE_STORE_VERSION,
      id: this.appState.activeWorkspaceId,
      name: this.workspace?.name ?? DEFAULT_WORKSPACE_NAME,
      panes: validated.map(copyPane),
      layout: normalizeWorkspaceLayout(this.workspace?.layout, ids),
      updatedAt: new Date().toISOString()
    }
    await this.save()
  }

  async setLayout(input: unknown): Promise<void> {
    this.ensureLoaded()
    if (!this.workspace) {
      return
    }
    const ids = this.workspace.panes.map((pane) => pane.id)
    this.workspace = {
      ...this.workspace,
      layout: normalizeWorkspaceLayout(input, ids),
      updatedAt: new Date().toISOString()
    }
    await this.save()
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Workspace store has not been loaded.')
    }
  }

  private save(): Promise<void> {
    if (!this.workspace) {
      return Promise.resolve()
    }

    const appState = { ...this.appState }
    const workspace: WorkspaceData = {
      ...this.workspace,
      panes: this.workspace.panes.map(copyPane),
      layout: copyLayout(this.workspace.layout)
    }

    const next = this.saveQueue.then(async () => {
      await writeJsonAtomically(this.appStatePath, appState)
      await writeJsonAtomically(this.workspacePath, workspace)
    })
    this.saveQueue = next.catch(() => undefined)
    return next
  }
}
