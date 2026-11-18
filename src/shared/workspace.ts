import {
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  type NormalizedRect
} from './layout'
import { isValidProfileId } from './profiles'
import { isAllowedNavigationUrl } from './url'
import { parsePaneViewport, type PaneViewport } from './viewports'

export const WORKSPACE_STORE_VERSION = 1
export const APP_STATE_VERSION = 1
export const DEFAULT_WORKSPACE_ID = 'default'
export const DEFAULT_WORKSPACE_NAME = 'Workspace'
export const MAX_WORKSPACE_NAME_LENGTH = 80
export const MAX_WORKSPACE_PANES = 512

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const PANE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export type WorkspaceLayoutMode = 'grid' | 'freeform'

export interface WorkspacePaneDefinition {
  id: string
  profileId: string
  url: string
  viewport: PaneViewport
}

export interface WorkspaceLayout {
  mode: WorkspaceLayoutMode
  columns: number
  gridOrder: string[]
  freeform: Record<string, NormalizedRect>
  freeformOrder: string[]
}

export interface WorkspaceData {
  version: typeof WORKSPACE_STORE_VERSION
  id: string
  name: string
  panes: WorkspacePaneDefinition[]
  layout: WorkspaceLayout
  updatedAt: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  paneCount: number
  updatedAt: string
  active: boolean
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_APP_WINDOW_WIDTH = 720
export const MIN_APP_WINDOW_HEIGHT = 520
export const MAX_APP_WINDOW_DIMENSION = 10_000
const MAX_WINDOW_POSITION = 100_000

export interface AppStateData {
  version: typeof APP_STATE_VERSION
  activeWorkspaceId: string
  windowBounds?: WindowBounds
}

export function isValidWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value)
}

export function isValidPaneId(value: unknown): value is string {
  return typeof value === 'string' && PANE_ID_PATTERN.test(value)
}

export function normalizeWorkspaceName(name: string): string | null {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed.length > MAX_WORKSPACE_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    return null
  }
  return trimmed
}

export function normalizeWindowBounds(input: unknown): WindowBounds | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null
  }
  const record = input as Record<string, unknown>
  const { x, y, width, height } = record
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null
  }
  if (
    width < MIN_APP_WINDOW_WIDTH ||
    height < MIN_APP_WINDOW_HEIGHT ||
    width > MAX_APP_WINDOW_DIMENSION ||
    height > MAX_APP_WINDOW_DIMENSION ||
    Math.abs(x) > MAX_WINDOW_POSITION ||
    Math.abs(y) > MAX_WINDOW_POSITION
  ) {
    return null
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export function defaultWorkspaceLayout(paneIds: readonly string[] = []): WorkspaceLayout {
  const ids = paneIds.filter(isValidPaneId)
  return {
    mode: 'grid',
    columns: 2,
    gridOrder: [...ids],
    freeform: {},
    freeformOrder: [...ids]
  }
}

function validOrder(
  value: unknown,
  allowedIds: ReadonlySet<string>
): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const order: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowedIds.has(entry) || seen.has(entry)) {
      return null
    }
    seen.add(entry)
    order.push(entry)
  }
  for (const paneId of allowedIds) {
    if (!seen.has(paneId)) {
      order.push(paneId)
    }
  }
  return order
}

function validNormalizedRect(value: unknown): NormalizedRect | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const rect = value as Record<string, unknown>
  const { x, y, width, height } = rect
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    return null
  }
  if (x + width > 1.0001 || y + height > 1.0001) {
    return null
  }
  return { x, y, width, height }
}

/**
 * Sanitizes renderer or persisted layout state against the current pane IDs.
 * Unknown pane references are dropped, missing panes are appended, and invalid
 * freeform geometry is removed so a bad layout cannot hide a pane forever.
 */
export function normalizeWorkspaceLayout(
  input: unknown,
  paneIds: readonly string[]
): WorkspaceLayout {
  const allowedIds = new Set(paneIds.filter(isValidPaneId))
  const fallback = defaultWorkspaceLayout([...allowedIds])
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fallback
  }

  const record = input as Record<string, unknown>
  const mode: WorkspaceLayoutMode =
    record.mode === 'freeform' || record.mode === 'grid' ? record.mode : fallback.mode
  const columns =
    typeof record.columns === 'number' &&
    Number.isInteger(record.columns) &&
    record.columns >= GRID_MIN_COLUMNS &&
    record.columns <= GRID_MAX_COLUMNS
      ? record.columns
      : fallback.columns

  const gridOrder = validOrder(record.gridOrder, allowedIds)
  const freeformOrder = validOrder(record.freeformOrder, allowedIds)
  const freeform: Record<string, NormalizedRect> = {}
  if (typeof record.freeform === 'object' && record.freeform !== null && !Array.isArray(record.freeform)) {
    for (const [paneId, value] of Object.entries(record.freeform)) {
      if (!allowedIds.has(paneId)) {
        continue
      }
      const rect = validNormalizedRect(value)
      if (rect) {
        freeform[paneId] = rect
      }
    }
  }

  return {
    mode,
    columns,
    gridOrder: gridOrder ?? fallback.gridOrder,
    freeform,
    freeformOrder: freeformOrder ?? fallback.freeformOrder
  }
}

export function parseWorkspaceData(
  input: unknown
): { ok: true; data: WorkspaceData } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Workspace must be an object.' }
  }

  const record = input as Record<string, unknown>
  if (record.version !== WORKSPACE_STORE_VERSION) {
    return { ok: false, error: 'Unsupported workspace version.' }
  }
  if (!isValidWorkspaceId(record.id)) {
    return { ok: false, error: 'Workspace ID is invalid.' }
  }
  if (typeof record.name !== 'string') {
    return { ok: false, error: 'Workspace name is invalid.' }
  }
  const name = normalizeWorkspaceName(record.name)
  if (!name) {
    return { ok: false, error: 'Workspace name is invalid.' }
  }
  if (!Array.isArray(record.panes) || record.panes.length > MAX_WORKSPACE_PANES) {
    return { ok: false, error: 'Workspace panes are invalid.' }
  }

  const paneIds: string[] = []
  const panes: WorkspacePaneDefinition[] = []
  const seenPaneIds = new Set<string>()

  for (const entry of record.panes) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Workspace pane is invalid.' }
    }
    const pane = entry as Record<string, unknown>
    if (!isValidPaneId(pane.id) || seenPaneIds.has(pane.id)) {
      return { ok: false, error: 'Workspace pane ID is invalid or duplicated.' }
    }
    if (!isValidProfileId(pane.profileId)) {
      return { ok: false, error: 'Workspace profile ID is invalid.' }
    }
    if (typeof pane.url !== 'string' || !isAllowedNavigationUrl(pane.url)) {
      return { ok: false, error: 'Workspace pane URL is invalid.' }
    }
    const viewport = parsePaneViewport(pane.viewport)
    if (!viewport.ok) {
      return { ok: false, error: viewport.error }
    }

    seenPaneIds.add(pane.id)
    paneIds.push(pane.id)
    panes.push({
      id: pane.id,
      profileId: pane.profileId,
      url: pane.url,
      viewport: viewport.viewport
    })
  }

  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) {
    return { ok: false, error: 'Workspace update date is invalid.' }
  }

  return {
    ok: true,
    data: {
      version: WORKSPACE_STORE_VERSION,
      id: record.id,
      name,
      panes,
      layout: normalizeWorkspaceLayout(record.layout, paneIds),
      updatedAt: new Date(record.updatedAt).toISOString()
    }
  }
}

export function parseAppStateData(
  input: unknown
): { ok: true; data: AppStateData } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'App state must be an object.' }
  }
  const record = input as Record<string, unknown>
  if (record.version !== APP_STATE_VERSION) {
    return { ok: false, error: 'Unsupported app state version.' }
  }
  if (!isValidWorkspaceId(record.activeWorkspaceId)) {
    return { ok: false, error: 'Active workspace ID is invalid.' }
  }
  const windowBounds = normalizeWindowBounds(record.windowBounds)
  return {
    ok: true,
    data: {
      version: APP_STATE_VERSION,
      activeWorkspaceId: record.activeWorkspaceId,
      ...(windowBounds ? { windowBounds } : {})
    }
  }
}

export function createEmptyWorkspace(
  id = DEFAULT_WORKSPACE_ID,
  name = DEFAULT_WORKSPACE_NAME
): WorkspaceData {
  return {
    version: WORKSPACE_STORE_VERSION,
    id,
    name,
    panes: [],
    layout: defaultWorkspaceLayout([]),
    updatedAt: new Date().toISOString()
  }
}
