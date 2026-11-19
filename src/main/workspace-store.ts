import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink } from 'node:fs/promises'
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
  isValidWorkspaceId,
  normalizeWindowBounds,
  normalizeWorkspaceLayout,
  parseAppStateData,
  parsePaneTitle,
  parseWorkspaceData,
  createEmptyWorkspace,
  isThemePreference,
  normalizeWorkspaceName,
  type AppStateData,
  type ThemePreference,
  type WindowBounds,
  type WindowPresentation,
  type WorkspaceData,
  type WorkspaceLayout,
  type WorkspacePaneDefinition,
  type WorkspaceSummary
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
    throw new Error('Too many workspace devices.')
  }
  const seen = new Set<string>()
  return panes.map((pane) => {
    if (!isValidPaneId(pane.id) || seen.has(pane.id)) {
      throw new Error('Invalid or duplicated device ID.')
    }
    if (!isValidProfileId(pane.profileId)) {
      throw new Error('Invalid profile ID.')
    }
    if (!isAllowedNavigationUrl(pane.url)) {
      throw new Error('Invalid device URL.')
    }
    const viewport = parsePaneViewport(pane.viewport)
    if (!viewport.ok) {
      throw new Error(viewport.error)
    }
    let title: string | undefined
    if (pane.title !== undefined && pane.title !== null) {
      const parsedTitle = parsePaneTitle(pane.title)
      if (!parsedTitle.ok) {
        throw new Error(parsedTitle.error)
      }
      if (parsedTitle.title) {
        title = parsedTitle.title
      }
    }
    seen.add(pane.id)
    return {
      id: pane.id,
      profileId: pane.profileId,
      url: pane.url,
      viewport: viewport.viewport,
      ...(title ? { title } : {})
    }
  })
}

function copyPane(pane: WorkspacePaneDefinition): WorkspacePaneDefinition {
  return {
    id: pane.id,
    profileId: pane.profileId,
    url: pane.url,
    viewport: { ...pane.viewport },
    ...(pane.title ? { title: pane.title } : {})
  }
}

function copyWorkspace(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    panes: workspace.panes.map(copyPane),
    layout: copyLayout(workspace.layout)
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
    freeformOrder: [...layout.freeformOrder],
    canvas: Object.fromEntries(
      Object.entries(layout.canvas ?? {}).map(([paneId, position]) => [
        paneId,
        { ...position }
      ])
    )
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

  windowBounds(): WindowBounds | null {
    return this.appState.windowBounds ? { ...this.appState.windowBounds } : null
  }

  windowPresentation(): WindowPresentation {
    return {
      maximized: this.appState.maximized === true,
      fullScreen: this.appState.fullScreen === true
    }
  }

  theme(): ThemePreference {
    return this.appState.theme ?? 'system'
  }

  async setTheme(input: unknown): Promise<void> {
    this.ensureLoaded()
    if (!isThemePreference(input)) {
      return
    }
    if (this.theme() === input) {
      return
    }
    this.appState = { ...this.appState, theme: input }
    await this.save(false)
  }

  async setWindowBounds(
    input: unknown,
    presentation?: WindowPresentation
  ): Promise<void> {
    this.ensureLoaded()
    const bounds = normalizeWindowBounds(input)
    if (!bounds) {
      return
    }
    const currentPresentation = this.windowPresentation()
    const nextPresentation = presentation ?? currentPresentation
    const nextMaximized = nextPresentation.maximized === true
    const nextFullScreen = nextPresentation.fullScreen === true
    if (
      this.appState.windowBounds &&
      this.appState.windowBounds.x === bounds.x &&
      this.appState.windowBounds.y === bounds.y &&
      this.appState.windowBounds.width === bounds.width &&
      this.appState.windowBounds.height === bounds.height &&
      currentPresentation.maximized === nextMaximized &&
      currentPresentation.fullScreen === nextFullScreen
    ) {
      return
    }
    this.appState = {
      ...this.appState,
      windowBounds: bounds,
      ...(nextMaximized ? { maximized: true } : {}),
      ...(nextFullScreen ? { fullScreen: true } : {})
    }
    if (!nextMaximized) {
      delete this.appState.maximized
    }
    if (!nextFullScreen) {
      delete this.appState.fullScreen
    }
    await this.save(false)
  }

  activeWorkspaceId(): string {
    return this.appState.activeWorkspaceId
  }

  activeWorkspaceName(): string {
    return this.workspace?.name ?? DEFAULT_WORKSPACE_NAME
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    await this.flush()
    const activeId = this.appState.activeWorkspaceId
    const byId = new Map<string, WorkspaceData>()

    let entries: string[]
    try {
      entries = await readdir(join(this.directory, WORKSPACES_DIRECTORY))
    } catch {
      entries = []
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const id = entry.slice(0, -'.json'.length)
      if (!isValidWorkspaceId(id)) {
        continue
      }
      try {
        const data = await this.readWorkspaceData(id)
        byId.set(id, data)
      } catch {
        // Invalid workspace files are skipped in the picker; activation reports
        // a concrete error if the user selects one that later becomes invalid.
      }
    }

    if (this.workspace) {
      byId.set(this.workspace.id, copyWorkspace(this.workspace))
    }

    return [...byId.values()]
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        paneCount: workspace.panes.length,
        updatedAt: workspace.updatedAt,
        active: workspace.id === activeId
      }))
      .sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
  }

  async getWorkspaceData(id: string): Promise<WorkspaceData> {
    await this.flush()
    return this.readWorkspaceData(id)
  }

  async createWorkspace(name: string): Promise<WorkspaceSummary> {
    const normalized = normalizeWorkspaceName(name)
    if (!normalized) {
      throw new Error('Enter a workspace name of 80 characters or fewer.')
    }
    const data = createEmptyWorkspace(randomUUID(), normalized)
    await this.writeWorkspaceData(data)
    return this.summarize(data)
  }

  async renameWorkspace(id: string, name: string): Promise<WorkspaceSummary> {
    const normalized = normalizeWorkspaceName(name)
    if (!normalized) {
      throw new Error('Enter a workspace name of 80 characters or fewer.')
    }
    const data = await this.readWorkspaceData(id)
    await this.assertUniqueWorkspaceName(normalized, id)

    const updated: WorkspaceData = {
      ...data,
      name: normalized,
      updatedAt: new Date().toISOString()
    }
    if (id === this.appState.activeWorkspaceId) {
      this.workspace = updated
      await this.save()
    } else {
      await this.queueWorkspaceWrite(updated)
    }
    return this.summarize(updated)
  }

  async writeWorkspaceData(input: WorkspaceData): Promise<void> {
    const parsed = parseWorkspaceData(input)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    if (parsed.data.id === this.appState.activeWorkspaceId) {
      throw new Error('Use the active workspace store for the current workspace.')
    }
    await this.assertUniqueWorkspaceName(parsed.data.name, parsed.data.id)
    await this.queueWorkspaceWrite(parsed.data)
  }

  async switchWorkspace(id: string): Promise<WorkspaceData> {
    if (!isValidWorkspaceId(id)) {
      throw new Error('Invalid workspace ID.')
    }
    if (id === this.appState.activeWorkspaceId && this.workspace) {
      return copyWorkspace(this.workspace)
    }
    await this.flush()
    const data = await this.readWorkspaceData(id)
    this.workspace = copyWorkspace(data)
    this.appState = { ...this.appState, activeWorkspaceId: id }
    await this.save()
    return copyWorkspace(data)
  }

  async deleteWorkspace(id: string): Promise<void> {
    if (!isValidWorkspaceId(id)) {
      throw new Error('Invalid workspace ID.')
    }
    if (id === this.appState.activeWorkspaceId) {
      throw new Error('Switch to another workspace before deleting this one.')
    }
    await this.flush()
    const workspaces = await this.listWorkspaces()
    if (workspaces.length <= 1) {
      throw new Error('At least one workspace must remain.')
    }
    if (!workspaces.some((workspace) => workspace.id === id)) {
      throw new Error('Workspace not found.')
    }
    await unlink(this.workspacePathFor(id))
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

  private workspacePathFor(id: string): string {
    if (!isValidWorkspaceId(id)) {
      throw new Error('Invalid workspace ID.')
    }
    return join(this.directory, WORKSPACES_DIRECTORY, `${id}.json`)
  }

  private summarize(workspace: WorkspaceData): WorkspaceSummary {
    return {
      id: workspace.id,
      name: workspace.name,
      paneCount: workspace.panes.length,
      updatedAt: workspace.updatedAt,
      active: workspace.id === this.appState.activeWorkspaceId
    }
  }

  private async assertUniqueWorkspaceName(name: string, exceptId?: string): Promise<void> {
    const workspaces = await this.listWorkspaces()
    const duplicate = workspaces.some(
      (workspace) =>
        workspace.id !== exceptId && workspace.name.toLowerCase() === name.toLowerCase()
    )
    if (duplicate) {
      throw new Error('A workspace with that name already exists.')
    }
  }

  private async readWorkspaceData(id: string): Promise<WorkspaceData> {
    if (!isValidWorkspaceId(id)) {
      throw new Error('Invalid workspace ID.')
    }
    if (id === this.appState.activeWorkspaceId && this.workspace) {
      return copyWorkspace(this.workspace)
    }

    const path = this.workspacePathFor(id)
    const read = await readJsonFile(path)
    if (read.status === 'missing') {
      throw new Error('Workspace not found.')
    }
    if (read.status === 'invalid') {
      await preserveCorruptFile(path)
      throw new Error('Workspace file is invalid.')
    }
    const parsed = parseWorkspaceData(read.value)
    if (!parsed.ok) {
      await preserveCorruptFile(path)
      throw new Error('Workspace file is invalid.')
    }
    return parsed.data
  }

  private queueWorkspaceWrite(workspace: WorkspaceData): Promise<void> {
    const path = this.workspacePathFor(workspace.id)
    const next = this.saveQueue.then(async () => {
      await writeJsonAtomically(path, workspace)
    })
    this.saveQueue = next.catch(() => undefined)
    return next
  }

  private save(includeWorkspace = true): Promise<void> {
    const appState = { ...this.appState }
    const workspacePath = this.workspacePath
    const workspace: WorkspaceData | null =
      includeWorkspace && this.workspace
        ? {
            ...this.workspace,
            panes: this.workspace.panes.map(copyPane),
            layout: copyLayout(this.workspace.layout)
          }
        : null

    const next = this.saveQueue.then(async () => {
      await writeJsonAtomically(this.appStatePath, appState)
      if (workspace) {
        await writeJsonAtomically(workspacePath, workspace)
      }
    })
    this.saveQueue = next.catch(() => undefined)
    return next
  }
}
