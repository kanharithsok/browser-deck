import { isValidCanvasPosition, type CanvasPosition } from './canvas'
import {
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  type NormalizedRect
} from './layout'
import { isAllowedNavigationUrl } from './url'
import { parsePaneViewport, type PaneViewport } from './viewports'
import {
  MAX_WORKSPACE_NAME_LENGTH,
  MAX_WORKSPACE_PANES,
  WORKSPACE_STORE_VERSION,
  normalizeWorkspaceName,
  parsePaneTitle,
  type WorkspaceData,
  type WorkspaceLayoutMode,
  type WorkspacePaneDefinition
} from './workspace'

export const WORKSPACE_TRANSFER_FORMAT = 'paneflow-workspace'
export const WORKSPACE_TRANSFER_VERSION = 1
export const MAX_WORKSPACE_TRANSFER_BYTES = 1_000_000

export interface WorkspaceTransferPane {
  url: string
  viewport: PaneViewport
  title?: string
}

export interface WorkspaceTransferLayout {
  mode: WorkspaceLayoutMode
  columns: number
  gridOrder: number[]
  freeform: Record<string, NormalizedRect>
  freeformOrder: number[]
  canvas?: Record<string, CanvasPosition>
}

export interface WorkspaceTransfer {
  format: typeof WORKSPACE_TRANSFER_FORMAT
  version: typeof WORKSPACE_TRANSFER_VERSION
  name: string
  panes: WorkspaceTransferPane[]
  layout: WorkspaceTransferLayout
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
    !Number.isFinite(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1.0001 ||
    y + height > 1.0001
  ) {
    return null
  }
  return { x, y, width, height }
}

function validIndexOrder(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value) || value.length !== count) {
    return null
  }
  const seen = new Set<number>()
  const order: number[] = []
  for (const entry of value) {
    if (
      typeof entry !== 'number' ||
      !Number.isInteger(entry) ||
      entry < 0 ||
      entry >= count ||
      seen.has(entry)
    ) {
      return null
    }
    seen.add(entry)
    order.push(entry)
  }
  return order.length === count ? order : null
}

export function serializeWorkspaceTransfer(workspace: WorkspaceData): WorkspaceTransfer {
  const indices = new Map(workspace.panes.map((pane, index) => [pane.id, index]))
  const mapOrder = (order: string[]): number[] =>
    order.map((paneId) => indices.get(paneId)).filter((index): index is number => index !== undefined)
  const freeform: Record<string, NormalizedRect> = {}
  for (const [paneId, rect] of Object.entries(workspace.layout.freeform)) {
    const index = indices.get(paneId)
    if (index !== undefined) {
      freeform[String(index)] = { ...rect }
    }
  }
  const canvas: Record<string, CanvasPosition> = {}
  for (const [paneId, position] of Object.entries(workspace.layout.canvas ?? {})) {
    const index = indices.get(paneId)
    if (index !== undefined) {
      canvas[String(index)] = { ...position }
    }
  }

  return {
    format: WORKSPACE_TRANSFER_FORMAT,
    version: WORKSPACE_TRANSFER_VERSION,
    name: workspace.name,
    panes: workspace.panes.map((pane) => ({
      url: pane.url,
      viewport: { ...pane.viewport },
      ...(pane.title ? { title: pane.title } : {})
    })),
    layout: {
      mode: 'canvas',
      columns: workspace.layout.columns,
      gridOrder: mapOrder(workspace.layout.gridOrder),
      freeform,
      freeformOrder: mapOrder(workspace.layout.freeformOrder),
      canvas
    }
  }
}

export function parseWorkspaceTransfer(
  input: unknown
): { ok: true; transfer: WorkspaceTransfer } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Workspace import must be an object.' }
  }
  const record = input as Record<string, unknown>
  if (record.format !== WORKSPACE_TRANSFER_FORMAT || record.version !== WORKSPACE_TRANSFER_VERSION) {
    return { ok: false, error: 'Unsupported workspace import format or version.' }
  }
  if (typeof record.name !== 'string') {
    return { ok: false, error: 'Workspace import name is invalid.' }
  }
  const name = normalizeWorkspaceName(record.name)
  if (!name || name.length > MAX_WORKSPACE_NAME_LENGTH) {
    return { ok: false, error: 'Workspace import name is invalid.' }
  }
  if (!Array.isArray(record.panes) || record.panes.length > MAX_WORKSPACE_PANES) {
    return { ok: false, error: 'Workspace import devices are invalid.' }
  }

  const panes: WorkspaceTransferPane[] = []
  for (const entry of record.panes) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Workspace import device is invalid.' }
    }
    const pane = entry as Record<string, unknown>
    if (typeof pane.url !== 'string' || !isAllowedNavigationUrl(pane.url)) {
      return { ok: false, error: 'Workspace import device URL is invalid.' }
    }
    const viewport = parsePaneViewport(pane.viewport)
    if (!viewport.ok) {
      return { ok: false, error: viewport.error }
    }
    let title: string | undefined
    if (pane.title !== undefined && pane.title !== null) {
      const parsedTitle = parsePaneTitle(pane.title)
      if (!parsedTitle.ok) {
        return { ok: false, error: parsedTitle.error }
      }
      if (parsedTitle.title) {
        title = parsedTitle.title
      }
    }
    panes.push({
      url: pane.url,
      viewport: viewport.viewport,
      ...(title ? { title } : {})
    })
  }

  if (typeof record.layout !== 'object' || record.layout === null || Array.isArray(record.layout)) {
    return { ok: false, error: 'Workspace import layout is invalid.' }
  }
  const layoutRecord = record.layout as Record<string, unknown>
  // Older exports may contain Grid or Freeform; imports open in Canvas.
  const mode: WorkspaceLayoutMode = 'canvas'
  const columns =
    typeof layoutRecord.columns === 'number' &&
    Number.isInteger(layoutRecord.columns) &&
    layoutRecord.columns >= GRID_MIN_COLUMNS &&
    layoutRecord.columns <= GRID_MAX_COLUMNS
      ? layoutRecord.columns
      : null
  if (!columns) {
    return { ok: false, error: 'Workspace import columns are invalid.' }
  }
  const gridOrder = validIndexOrder(layoutRecord.gridOrder, panes.length)
  const freeformOrder = validIndexOrder(layoutRecord.freeformOrder, panes.length)
  if (!gridOrder || !freeformOrder) {
    return { ok: false, error: 'Workspace import device order is invalid.' }
  }

  const freeform: Record<string, NormalizedRect> = {}
  if (
    typeof layoutRecord.freeform !== 'object' ||
    layoutRecord.freeform === null ||
    Array.isArray(layoutRecord.freeform)
  ) {
    return { ok: false, error: 'Workspace import freeform layout is invalid.' }
  }
  for (const [key, value] of Object.entries(
    layoutRecord.freeform as Record<string, unknown>
  )) {
    if (!/^\d+$/.test(key)) {
      return { ok: false, error: 'Workspace import freeform key is invalid.' }
    }
    const index = Number(key)
    if (index < 0 || index >= panes.length) {
      return { ok: false, error: 'Workspace import freeform device is invalid.' }
    }
    const rect = validNormalizedRect(value)
    if (!rect) {
      return { ok: false, error: 'Workspace import freeform geometry is invalid.' }
    }
    freeform[key] = rect
  }

  const canvas: Record<string, CanvasPosition> = {}
  if (layoutRecord.canvas !== undefined) {
    if (
      typeof layoutRecord.canvas !== 'object' ||
      layoutRecord.canvas === null ||
      Array.isArray(layoutRecord.canvas)
    ) {
      return { ok: false, error: 'Workspace import canvas layout is invalid.' }
    }
    for (const [key, value] of Object.entries(
      layoutRecord.canvas as Record<string, unknown>
    )) {
      if (!/^\d+$/.test(key)) {
        return { ok: false, error: 'Workspace import canvas key is invalid.' }
      }
      const index = Number(key)
      if (index < 0 || index >= panes.length) {
        return { ok: false, error: 'Workspace import canvas device is invalid.' }
      }
      if (!isValidCanvasPosition(value)) {
        return { ok: false, error: 'Workspace import canvas position is invalid.' }
      }
      canvas[key] = { x: Math.round(value.x), y: Math.round(value.y) }
    }
  }

  return {
    ok: true,
    transfer: {
      format: WORKSPACE_TRANSFER_FORMAT,
      version: WORKSPACE_TRANSFER_VERSION,
      name,
      panes,
      layout: { mode, columns, gridOrder, freeform, freeformOrder, canvas }
    }
  }
}

export function materializeWorkspaceTransfer(
  transfer: WorkspaceTransfer,
  workspaceId: string,
  name: string,
  paneIds: string[],
  profileIds: string[]
): WorkspaceData {
  if (paneIds.length !== transfer.panes.length || profileIds.length !== transfer.panes.length) {
    throw new Error('Workspace import device mapping is invalid.')
  }
  const panes: WorkspacePaneDefinition[] = transfer.panes.map((pane, index) => ({
    id: paneIds[index] as string,
    profileId: profileIds[index] as string,
    url: pane.url,
    viewport: { ...pane.viewport },
    ...(pane.title ? { title: pane.title } : {})
  }))
  const mapOrder = (order: number[]): string[] =>
    order.map((index) => paneIds[index]).filter((id): id is string => id !== undefined)
  const freeform: Record<string, NormalizedRect> = {}
  for (const [key, rect] of Object.entries(transfer.layout.freeform)) {
    const paneId = paneIds[Number(key)]
    if (paneId) {
      freeform[paneId] = { ...rect }
    }
  }
  const canvas: Record<string, CanvasPosition> = {}
  for (const [key, position] of Object.entries(transfer.layout.canvas ?? {})) {
    const paneId = paneIds[Number(key)]
    if (paneId) {
      canvas[paneId] = { ...position }
    }
  }

  return {
    version: WORKSPACE_STORE_VERSION,
    id: workspaceId,
    name,
    panes,
    layout: {
      mode: 'canvas',
      columns: transfer.layout.columns,
      gridOrder: mapOrder(transfer.layout.gridOrder),
      freeform,
      freeformOrder: mapOrder(transfer.layout.freeformOrder),
      canvas
    },
    updatedAt: new Date().toISOString()
  }
}
