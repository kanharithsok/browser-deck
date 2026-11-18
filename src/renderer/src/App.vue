<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PaneCard from './components/PaneCard.vue'
import type { PaneCommand, PaneState, ScriptResult, ShellState } from '../../shared/ipc'
import type { ProfileSummary } from '../../shared/profiles'
import type { PaneViewport } from '../../shared/viewports'
import type { WorkspaceLayout, WorkspaceSummary } from '../../shared/workspace'
import {
  DEFAULT_GRID_COLUMNS,
  DEFAULT_MIN_PANE_HEIGHT,
  DEFAULT_MIN_PANE_WIDTH,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  bringToFront,
  isRectFullyVisible,
  layoutGrid,
  moveRect,
  normalizedToRect,
  rectToNormalized,
  reorderPaneIds,
  resizeRect,
  sendToBack,
  snapRect,
  type GridLayout,
  type NormalizedRect,
  type Rect,
  type ResizeHandle,
  type Size,
  type SnapGuides
} from '../../shared/layout'

type LayoutMode = 'grid' | 'freeform'
type ProfileActionKind = 'clear' | 'delete'

interface ProfileActionState {
  kind: ProfileActionKind
  profileId: string
}

const panes = ref<PaneState[]>([])
const paneOrder = ref<string[]>([])
const activePaneId = ref<string | null>(null)
const layoutMode = ref<LayoutMode>('grid')
const freeformGeometries = ref<Record<string, NormalizedRect>>({})
const freeformOrder = ref<string[]>([])
const workspaceEl = ref<HTMLElement | null>(null)
const workspaceSize = ref<Size>({ width: 0, height: 0 })
const gridColumns = ref(DEFAULT_GRID_COLUMNS)
const suspendedPaneIds = ref<ReadonlySet<string>>(new Set())
const maximizedPaneId = ref<string | null>(null)
const actionError = ref<string | null>(null)
const layoutError = ref<string | null>(null)
const addingPane = ref(false)
const guides = ref<SnapGuides>({ vertical: [], horizontal: [] })
const profilesOpen = ref(false)
const profiles = ref<ProfileSummary[]>([])
const profilesLoading = ref(false)
const profileError = ref<string | null>(null)
const profileNotice = ref<string | null>(null)
const profileBusy = ref(false)
const profileAction = ref<ProfileActionState | null>(null)
const renamingProfileId = ref<string | null>(null)
const renameDraft = ref('')
const profilesDialogEl = ref<HTMLElement | null>(null)
const profilesButtonEl = ref<HTMLButtonElement | null>(null)
const profileDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const workspacesOpen = ref(false)
const workspaces = ref<WorkspaceSummary[]>([])
const workspacesLoading = ref(false)
const workspaceError = ref<string | null>(null)
const workspaceNotice = ref<string | null>(null)
const workspaceBusy = ref(false)
const workspaceDeleteId = ref<string | null>(null)
const renamingWorkspaceId = ref<string | null>(null)
const workspaceRenameDraft = ref('')
const newWorkspaceName = ref('')
const workspacesDialogEl = ref<HTMLElement | null>(null)
const workspacesButtonEl = ref<HTMLButtonElement | null>(null)
const workspaceName = ref('Workspace')
const currentWorkspaceId = ref<string | null>(null)

interface DragState {
  kind: 'reorder' | 'move' | 'resize'
  paneId: string
  startX: number
  startY: number
  startRect?: Rect
  handle?: ResizeHandle
}

const dragState = ref<DragState | null>(null)
const dropTargetId = ref<string | null>(null)
const isDragging = ref(false)

let disposeStateListener: (() => void) | null = null
let disposeMeasureListener: (() => void) | null = null
let disposeCommandListener: (() => void) | null = null
let disposeFocusListener: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let measureFrame = 0
let focusManagementEnabled = false
let layoutPersistenceReady = false
let layoutRestored = false
let lastSavedLayoutKey = ''

const paneCountLabel = computed(() => {
  const count = panes.value.length
  return `${count} ${count === 1 ? 'pane' : 'panes'}`
})

const orderedPanes = computed(() => {
  const byId = new Map(panes.value.map((pane) => [pane.id, pane]))
  return paneOrder.value
    .map((paneId) => byId.get(paneId))
    .filter((pane): pane is PaneState => pane !== undefined)
})

const paneLayoutKey = computed(() => orderedPanes.value.map((pane) => pane.id).join('|'))
const errorMessage = computed(() => actionError.value ?? layoutError.value)

const gridLayout = computed<GridLayout | null>(() => {
  if (
    orderedPanes.value.length === 0 ||
    workspaceSize.value.width < 1 ||
    workspaceSize.value.height < 1
  ) {
    return null
  }

  const result = layoutGrid(
    orderedPanes.value.map((pane) => pane.id),
    workspaceSize.value,
    { columns: gridColumns.value, padding: 10, gap: 10 }
  )

  return result.ok ? result.layout : null
})

const placementByPane = computed(() => {
  const placements = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const placement of gridLayout.value?.placements ?? []) {
    placements.set(placement.paneId, placement.rect)
  }
  return placements
})

const gridContentHeight = computed(() => gridLayout.value?.contentHeight ?? 0)

const freeformPixelRects = computed(() => {
  const rects = new Map<string, Rect>()
  if (workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    return rects
  }

  const minSize = {
    width: DEFAULT_MIN_PANE_WIDTH,
    height: DEFAULT_MIN_PANE_HEIGHT
  }
  for (const paneId of freeformOrder.value) {
    const normalized = freeformGeometries.value[paneId]
    if (!normalized) {
      continue
    }
    const rect = normalizedToRect(normalized, workspaceSize.value, minSize)
    if (rect) {
      rects.set(paneId, rect)
    }
  }
  return rects
})

const slotRects = computed(() =>
  layoutMode.value === 'grid' ? placementByPane.value : freeformPixelRects.value
)

const paneGridHeight = computed(() =>
  maximizedPaneId.value
    ? workspaceSize.value.height
    : layoutMode.value === 'grid'
      ? gridContentHeight.value
      : workspaceSize.value.height
)

const gridNotice = computed(() => {
  if (layoutMode.value !== 'grid' || maximizedPaneId.value) {
    return null
  }
  const layout = gridLayout.value
  if (!layout) {
    return null
  }
  if (layout.columnTooNarrow) {
    return 'Columns are narrower than the recommended pane width. Widen the window or use fewer columns.'
  }
  return null
})

function focusPaneAddress(paneId: string): void {
  const input = document.querySelector<HTMLInputElement>(
    `[data-pane-id="${paneId}"] .address-input`
  )
  input?.focus()
  input?.select()
}

function recoverFocus(): void {
  const target =
    document.querySelector<HTMLInputElement>('[data-pane-id] .address-input') ??
    document.querySelector<HTMLButtonElement>('.empty-state .toolbar-button')
  target?.focus()
}

function readWorkspaceSize(): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }

  const width = Math.max(0, Math.round(workspace.clientWidth))
  const height = Math.max(0, Math.round(workspace.clientHeight))
  if (width !== workspaceSize.value.width || height !== workspaceSize.value.height) {
    workspaceSize.value = { width, height }
  }
}

function paneSlotStyle(paneId: string): Record<string, string> {
  const rect = slotRects.value.get(paneId)
  if (!rect) {
    return { visibility: 'hidden' }
  }

  if (maximizedPaneId.value) {
    if (paneId !== maximizedPaneId.value) {
      return {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        visibility: 'hidden'
      }
    }

    return {
      left: '10px',
      top: '10px',
      width: `${Math.max(0, workspaceSize.value.width - 20)}px`,
      height: `${Math.max(0, workspaceSize.value.height - 20)}px`,
      zIndex: '100'
    }
  }

  const style: Record<string, string> = {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }

  if (layoutMode.value === 'freeform') {
    const index = freeformOrder.value.indexOf(paneId)
    style.zIndex = String(10 + Math.max(0, index))
  }

  return style
}

function handleWindowResize(): void {
  readWorkspaceSize()
  scheduleMeasure()
}

function updateSuspendedPanes(next: ReadonlySet<string>): void {
  const current = suspendedPaneIds.value
  if (current.size === next.size && [...next].every((paneId) => current.has(paneId))) {
    return
  }
  suspendedPaneIds.value = next
}

function freeformMinSize(): Size {
  return { width: DEFAULT_MIN_PANE_WIDTH, height: DEFAULT_MIN_PANE_HEIGHT }
}

function defaultFreeformGeometry(index: number): NormalizedRect {
  const offset = Math.min(0.4, 0.08 + index * 0.04)
  return { x: offset, y: offset, width: 0.5, height: 0.5 }
}

function ensureFreeformGeometry(): void {
  if (layoutMode.value !== 'freeform' || workspaceSize.value.width < 1) {
    return
  }

  const next = { ...freeformGeometries.value }
  const paneIds = new Set(orderedPanes.value.map((pane) => pane.id))
  let changed = false

  for (const paneId of Object.keys(next)) {
    if (!paneIds.has(paneId)) {
      delete next[paneId]
      changed = true
    }
  }

  orderedPanes.value.forEach((pane, index) => {
    if (next[pane.id]) {
      return
    }

    const gridRect = placementByPane.value.get(pane.id)
    const normalized = gridRect
      ? rectToNormalized(gridRect, workspaceSize.value)
      : defaultFreeformGeometry(index)
    if (!normalized) {
      return
    }

    const clamped = normalizedToRect(normalized, workspaceSize.value, freeformMinSize())
    if (!clamped) {
      return
    }
    const safe = rectToNormalized(clamped, workspaceSize.value)
    if (safe) {
      next[pane.id] = safe
      changed = true
    }
  })

  if (changed) {
    freeformGeometries.value = next
  }
}

function tidyFreeform(): void {
  if (layoutMode.value !== 'freeform' || workspaceSize.value.width < 1) {
    return
  }

  const result = layoutGrid(
    orderedPanes.value.map((pane) => pane.id),
    workspaceSize.value,
    { columns: gridColumns.value, padding: 10, gap: 10 }
  )
  if (!result.ok) {
    return
  }

  const next: Record<string, NormalizedRect> = {}
  for (const placement of result.layout.placements) {
    const normalized = rectToNormalized(placement.rect, workspaceSize.value)
    if (normalized) {
      next[placement.paneId] = normalized
    }
  }
  freeformGeometries.value = next
  freeformOrder.value = orderedPanes.value.map((pane) => pane.id)
  guides.value = { vertical: [], horizontal: [] }
  void nextTick(scheduleMeasure)
}

function raisePane(paneId: string): void {
  if (layoutMode.value !== 'freeform') {
    return
  }
  const nextOrder = bringToFront(freeformOrder.value, paneId)
  if (nextOrder) {
    freeformOrder.value = nextOrder
  }
  void window.paneflow.bringPaneToFront(paneId).catch(() => undefined)
}

function lowerPane(paneId: string): void {
  if (layoutMode.value !== 'freeform') {
    return
  }
  const nextOrder = sendToBack(freeformOrder.value, paneId)
  if (nextOrder) {
    freeformOrder.value = nextOrder
  }
  void window.paneflow.sendPaneToBack(paneId).catch(() => undefined)
}

function applyFreeformRect(paneId: string, rect: Rect): void {
  const normalized = rectToNormalized(rect, workspaceSize.value)
  if (!normalized) {
    return
  }
  freeformGeometries.value = {
    ...freeformGeometries.value,
    [paneId]: normalized
  }
}

function updateGuidesFromSnap(snapped: SnapGuides): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    guides.value = { vertical: [], horizontal: [] }
    return
  }
  const rect = workspace.getBoundingClientRect()
  guides.value = {
    vertical: snapped.vertical.map((value) => value - rect.x),
    horizontal: snapped.horizontal.map((value) => value - rect.y)
  }
}

function updateFreeformInteraction(event: PointerEvent, state: DragState): void {
  if (!state.startRect || workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    return
  }

  const canvas = workspaceSize.value
  const minSize = freeformMinSize()
  const deltaX = event.clientX - state.startX
  const deltaY = event.clientY - state.startY

  const baseRect =
    state.kind === 'move'
      ? moveRect(state.startRect, deltaX, deltaY, canvas, minSize)
      : state.handle
        ? resizeRect(state.startRect, state.handle, deltaX, deltaY, canvas, minSize)
        : null

  if (!baseRect) {
    return
  }

  const neighbors = [...freeformPixelRects.value.entries()]
    .filter(([paneId]) => paneId !== state.paneId)
    .map(([, rect]) => rect)

  const snapped = snapRect(baseRect, {
    canvas,
    neighbors,
    threshold: 8,
    snapToCanvas: true,
    snapToNeighbors: true
  })
  if (!snapped) {
    return
  }

  updateGuidesFromSnap(snapped.guides)
  applyFreeformRect(state.paneId, snapped.rect)
}

function beginInteraction(state: DragState): void {
  dragState.value = state
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', finishDrag)
}

function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return (
    value === 'n' ||
    value === 's' ||
    value === 'e' ||
    value === 'w' ||
    value === 'ne' ||
    value === 'nw' ||
    value === 'se' ||
    value === 'sw'
  )
}

function buildWorkspaceLayout(): WorkspaceLayout {
  const ids = new Set(panes.value.map((pane) => pane.id))
  // Copy geometry into plain objects. Vue's reactive proxies cannot cross the
  // IPC structured-clone boundary.
  const freeform = Object.fromEntries(
    Object.entries(freeformGeometries.value)
      .filter(([paneId]) => ids.has(paneId))
      .map(([paneId, rect]) => [
        paneId,
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      ])
  )
  return {
    mode: layoutMode.value,
    columns: gridColumns.value,
    gridOrder: paneOrder.value.filter((paneId) => ids.has(paneId)),
    freeform,
    freeformOrder: freeformOrder.value.filter((paneId) => ids.has(paneId))
  }
}

async function saveWorkspaceLayout(): Promise<void> {
  if (!layoutPersistenceReady) {
    return
  }

  const layout = buildWorkspaceLayout()
  const key = JSON.stringify(layout)
  if (key === lastSavedLayoutKey) {
    return
  }
  lastSavedLayoutKey = key

  try {
    const result = await window.paneflow.saveWorkspaceLayout(layout)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not save the workspace layout.'
  }
}

function applyPersistedLayout(layout: WorkspaceLayout): void {
  const ids = new Set(panes.value.map((pane) => pane.id))
  const idsInOrder = panes.value.map((pane) => pane.id)
  const appendMissing = (order: readonly string[]): string[] => {
    const retained = order.filter((paneId) => ids.has(paneId))
    const retainedSet = new Set(retained)
    return [...retained, ...idsInOrder.filter((paneId) => !retainedSet.has(paneId))]
  }

  layoutMode.value = layout.mode === 'freeform' ? 'freeform' : 'grid'
  gridColumns.value = Math.min(
    GRID_MAX_COLUMNS,
    Math.max(GRID_MIN_COLUMNS, Math.round(layout.columns) || DEFAULT_GRID_COLUMNS)
  )
  paneOrder.value = appendMissing(layout.gridOrder)
  freeformGeometries.value = Object.fromEntries(
    Object.entries(layout.freeform).filter(([paneId]) => ids.has(paneId))
  )
  freeformOrder.value = appendMissing(layout.freeformOrder)
  maximizedPaneId.value = null
}

function applyState(state: ShellState): void {
  const workspaceChanged = currentWorkspaceId.value !== state.workspace.id
  if (workspaceChanged) {
    currentWorkspaceId.value = state.workspace.id
    paneOrder.value = []
    freeformGeometries.value = {}
    freeformOrder.value = []
    layoutMode.value = 'grid'
    gridColumns.value = DEFAULT_GRID_COLUMNS
    maximizedPaneId.value = null
    activePaneId.value = null
    layoutRestored = false
    layoutPersistenceReady = false
    suspendedPaneIds.value = new Set()
  }
  workspaceName.value = state.workspace.name

  const previousIds = new Set(panes.value.map((pane) => pane.id))
  const addedPane =
    !workspaceChanged && focusManagementEnabled && state.panes.length > panes.value.length
      ? state.panes.find((pane) => !previousIds.has(pane.id))
      : undefined
  const removedPane =
    !workspaceChanged && focusManagementEnabled && state.panes.length < panes.value.length

  const nextIds = new Set(state.panes.map((pane) => pane.id))
  const retained = paneOrder.value.filter((paneId) => nextIds.has(paneId))
  const retainedIds = new Set(retained)
  const appended = state.panes
    .map((pane) => pane.id)
    .filter((paneId) => !retainedIds.has(paneId))
  paneOrder.value = [...retained, ...appended]

  const retainedZ = freeformOrder.value.filter((paneId) => nextIds.has(paneId))
  const retainedZIds = new Set(retainedZ)
  const appendedZ = state.panes
    .map((pane) => pane.id)
    .filter((paneId) => !retainedZIds.has(paneId))
  freeformOrder.value = [...retainedZ, ...appendedZ]

  if (maximizedPaneId.value && !nextIds.has(maximizedPaneId.value)) {
    maximizedPaneId.value = null
  }
  if (activePaneId.value && !nextIds.has(activePaneId.value)) {
    activePaneId.value = null
  }
  if (addedPane) {
    activePaneId.value = addedPane.id
  }
  if (!activePaneId.value) {
    activePaneId.value = state.panes[0]?.id ?? null
  }

  panes.value = state.panes
  if (
    !layoutRestored &&
    (state.panes.length > 0 || state.layout.gridOrder.length === 0)
  ) {
    applyPersistedLayout(state.layout)
    layoutRestored = true
  }
  void nextTick(() => {
    if (layoutMode.value === 'freeform') {
      ensureFreeformGeometry()
    }
    if (workspaceChanged) {
      // The target workspace already has persisted layout state. Re-enable
      // saves without writing it back during the switch.
      layoutPersistenceReady = true
    }
    if (addedPane) {
      focusPaneAddress(addedPane.id)
    } else if (removedPane && document.activeElement === document.body) {
      recoverFocus()
    }
    scheduleMeasure()
  })
}

async function addPane(): Promise<void> {
  if (addingPane.value) {
    return
  }
  addingPane.value = true
  actionError.value = null
  try {
    const result = await window.paneflow.addPane()
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not add a pane.'
  } finally {
    addingPane.value = false
  }
}

async function closePane(paneId: string): Promise<void> {
  actionError.value = null
  try {
    const result = await window.paneflow.closePane(paneId)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not close the pane.'
  }
}

function formatProfileDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : profileDateFormatter.format(date)
}

function profilePaneTitles(profile: ProfileSummary): string {
  const titles = profile.paneIds
    .map((paneId) => panes.value.find((pane) => pane.id === paneId)?.title)
    .filter((title): title is string => Boolean(title))
  return titles.length > 0 ? titles.join(', ') : `${profile.paneIds.length} pane(s)`
}

async function refreshProfiles(): Promise<void> {
  profilesLoading.value = true
  profileError.value = null
  try {
    const result = await window.paneflow.listProfiles()
    if (result.ok) {
      profiles.value = result.profiles
    } else {
      profileError.value = result.error
    }
  } catch {
    profileError.value = 'Could not read profiles.'
  } finally {
    profilesLoading.value = false
  }
}

function openProfiles(): void {
  if (profilesOpen.value) {
    return
  }
  profilesOpen.value = true
  profileError.value = null
  profileNotice.value = null
  profileAction.value = null
  renamingProfileId.value = null
  void refreshProfiles()
  void nextTick(() => {
    scheduleMeasure()
    profilesDialogEl.value?.focus()
  })
}

function closeProfiles(): void {
  profilesOpen.value = false
  profiles.value = []
  profilesLoading.value = false
  profileError.value = null
  profileNotice.value = null
  profileAction.value = null
  renamingProfileId.value = null
  renameDraft.value = ''
  void nextTick(() => {
    scheduleMeasure()
    profilesButtonEl.value?.focus()
  })
}

function startProfileRename(profile: ProfileSummary): void {
  if (profileBusy.value) {
    return
  }
  profileError.value = null
  profileNotice.value = null
  profileAction.value = null
  renamingProfileId.value = profile.id
  renameDraft.value = profile.label
  void nextTick(() => {
    const input = profilesDialogEl.value?.querySelector<HTMLInputElement>(
      '.profile-rename-input'
    )
    input?.focus()
    input?.select()
  })
}

function cancelProfileRename(): void {
  renamingProfileId.value = null
  renameDraft.value = ''
  profileError.value = null
}

async function submitProfileRename(profile: ProfileSummary): Promise<void> {
  if (profileBusy.value) {
    return
  }
  const label = renameDraft.value.trim()
  if (!label) {
    profileError.value = 'Enter a profile name.'
    return
  }

  profileBusy.value = true
  profileError.value = null
  try {
    const result = await window.paneflow.renameProfile(profile.id, label)
    if (!result.ok) {
      profileError.value = result.error
      return
    }
    renamingProfileId.value = null
    renameDraft.value = ''
    profileNotice.value = `Renamed profile to “${label}”.`
    await refreshProfiles()
  } catch {
    profileError.value = 'Could not rename the profile.'
  } finally {
    profileBusy.value = false
  }
}

function requestProfileAction(kind: ProfileActionKind, profile: ProfileSummary): void {
  if (profileBusy.value || profile.inUse) {
    return
  }
  profileError.value = null
  profileNotice.value = null
  renamingProfileId.value = null
  profileAction.value = { kind, profileId: profile.id }
}

function cancelProfileAction(): void {
  profileAction.value = null
  profileError.value = null
}

async function confirmProfileAction(profile: ProfileSummary): Promise<void> {
  const action = profileAction.value
  if (
    profileBusy.value ||
    !action ||
    action.profileId !== profile.id ||
    profile.inUse
  ) {
    return
  }

  profileBusy.value = true
  profileError.value = null
  try {
    const result =
      action.kind === 'clear'
        ? await window.paneflow.clearProfile(profile.id)
        : await window.paneflow.deleteProfile(profile.id)
    if (!result.ok) {
      profileError.value = result.error
      await refreshProfiles()
      return
    }

    profileAction.value = null
    profileNotice.value =
      action.kind === 'clear'
        ? `Cleared browser data for “${profile.label}”.`
        : `Deleted profile “${profile.label}”.`
    await refreshProfiles()
  } catch {
    profileError.value =
      action.kind === 'clear' ? 'Could not clear the profile.' : 'Could not delete the profile.'
  } finally {
    profileBusy.value = false
  }
}

function onProfilesKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (renamingProfileId.value) {
      cancelProfileRename()
    } else if (profileAction.value) {
      cancelProfileAction()
    } else {
      closeProfiles()
    }
    return
  }

  if (event.key !== 'Tab') {
    return
  }
  const dialog = profilesDialogEl.value
  if (!dialog) {
    return
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  ).filter((element) => element.getClientRects().length > 0)
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

async function refreshWorkspaces(): Promise<void> {
  workspacesLoading.value = true
  workspaceError.value = null
  try {
    const result = await window.paneflow.listWorkspaces()
    if (result.ok) {
      workspaces.value = result.workspaces
    } else {
      workspaceError.value = result.error
    }
  } catch {
    workspaceError.value = 'Could not read workspaces.'
  } finally {
    workspacesLoading.value = false
  }
}

function openWorkspaces(): void {
  if (workspacesOpen.value) {
    return
  }
  workspacesOpen.value = true
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = null
  newWorkspaceName.value = ''
  void refreshWorkspaces()
  void nextTick(() => {
    scheduleMeasure()
    workspacesDialogEl.value?.focus()
  })
}

function closeWorkspaces(): void {
  workspacesOpen.value = false
  workspaces.value = []
  workspacesLoading.value = false
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = null
  newWorkspaceName.value = ''
  void nextTick(() => {
    scheduleMeasure()
    workspacesButtonEl.value?.focus()
  })
}

async function createWorkspace(): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  const name = newWorkspaceName.value.trim()
  if (!name) {
    workspaceError.value = 'Enter a workspace name.'
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.paneflow.createWorkspace(name)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    newWorkspaceName.value = ''
    workspaceNotice.value = `Created workspace “${name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not create the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

function startWorkspaceRename(workspace: WorkspaceSummary): void {
  if (workspaceBusy.value) {
    return
  }
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = workspace.id
  workspaceRenameDraft.value = workspace.name
  void nextTick(() => {
    const input = workspacesDialogEl.value?.querySelector<HTMLInputElement>(
      '.workspace-rename-input'
    )
    input?.focus()
    input?.select()
  })
}

function cancelWorkspaceRename(): void {
  renamingWorkspaceId.value = null
  workspaceRenameDraft.value = ''
  workspaceError.value = null
}

async function submitWorkspaceRename(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  const name = workspaceRenameDraft.value.trim()
  if (!name) {
    workspaceError.value = 'Enter a workspace name.'
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.paneflow.renameWorkspace(workspace.id, name)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    renamingWorkspaceId.value = null
    workspaceRenameDraft.value = ''
    workspaceNotice.value = `Renamed workspace to “${name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not rename the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

function requestWorkspaceDelete(workspace: WorkspaceSummary): void {
  if (workspaceBusy.value || workspace.active || workspaces.value.length <= 1) {
    return
  }
  workspaceError.value = null
  workspaceNotice.value = null
  renamingWorkspaceId.value = null
  workspaceDeleteId.value = workspace.id
}

function cancelWorkspaceDelete(): void {
  workspaceDeleteId.value = null
  workspaceError.value = null
}

async function confirmWorkspaceDelete(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value || workspaceDeleteId.value !== workspace.id || workspace.active) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.paneflow.deleteWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      await refreshWorkspaces()
      return
    }
    workspaceDeleteId.value = null
    workspaceNotice.value = `Deleted workspace “${workspace.name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not delete the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function duplicateWorkspace(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.paneflow.duplicateWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    workspaceNotice.value = `Duplicated “${workspace.name}” with fresh profiles.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not duplicate the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function switchToWorkspace(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value || workspace.active) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    await saveWorkspaceLayout()
    const result = await window.paneflow.switchWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    closeWorkspaces()
    const state = await window.paneflow.getState()
    applyState(state)
    await nextTick()
    scheduleMeasure()
  } catch {
    workspaceError.value = 'Could not switch workspaces.'
  } finally {
    workspaceBusy.value = false
  }
}

function onWorkspacesKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (renamingWorkspaceId.value) {
      cancelWorkspaceRename()
    } else if (workspaceDeleteId.value) {
      cancelWorkspaceDelete()
    } else {
      closeWorkspaces()
    }
    return
  }
  if (event.key !== 'Tab') {
    return
  }
  const dialog = workspacesDialogEl.value
  if (!dialog) {
    return
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  ).filter((element) => element.getClientRects().length > 0)
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

async function reloadAll(): Promise<void> {
  actionError.value = null
  try {
    const result = await window.paneflow.reloadAll()
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not reload the panes.'
  }
}

async function openPaneMenu(paneId: string, position: { x: number; y: number }): Promise<void> {
  try {
    const result = await window.paneflow.showPaneMenu({ paneId, x: position.x, y: position.y })
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not open the pane menu.'
  }
}

async function setPaneViewport(paneId: string, viewport: PaneViewport): Promise<void> {
  actionError.value = null
  try {
    const result = await window.paneflow.setPaneViewport(paneId, viewport)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not apply the viewport.'
  }
}

function onPaneLayoutChanged(): void {
  void nextTick(scheduleMeasure)
}

function dismissErrors(): void {
  actionError.value = null
  layoutError.value = null
}

function toggleMaximize(paneId: string): void {
  maximizedPaneId.value = maximizedPaneId.value === paneId ? null : paneId
  if (maximizedPaneId.value) {
    if (workspaceEl.value) {
      workspaceEl.value.scrollTop = 0
    }
    if (layoutMode.value === 'freeform') {
      raisePane(paneId)
    }
  }
  guides.value = { vertical: [], horizontal: [] }
  void nextTick(scheduleMeasure)
}

function currentPane(): PaneState | undefined {
  return panes.value.find((pane) => pane.id === activePaneId.value)
}

async function reloadActivePane(): Promise<void> {
  const pane = currentPane()
  if (!pane) {
    await reloadAll()
    return
  }
  await window.paneflow.reload(pane.id).catch(() => undefined)
}

function handlePaneCommand(command: PaneCommand): void {
  if (profilesOpen.value || workspacesOpen.value) {
    return
  }
  const pane = currentPane()
  switch (command) {
    case 'add-pane':
      void addPane()
      break
    case 'close-pane':
      if (pane) {
        void closePane(pane.id)
      }
      break
    case 'reload-pane':
      void reloadActivePane()
      break
    case 'reload-all':
      void reloadAll()
      break
    case 'toggle-maximize':
      if (pane) {
        toggleMaximize(pane.id)
      }
      break
    case 'toggle-layout':
      layoutMode.value = layoutMode.value === 'grid' ? 'freeform' : 'grid'
      break
  }
}

function onWorkspaceFocusIn(event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  const paneId = target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId
  if (paneId) {
    activePaneId.value = paneId
  }
}

function findDropTarget(x: number, y: number, draggedPaneId: string): string | null {
  const workspace = workspaceEl.value
  if (!workspace) {
    return null
  }

  for (const card of workspace.querySelectorAll<HTMLElement>('[data-pane-id]')) {
    const paneId = card.dataset.paneId
    if (!paneId || paneId === draggedPaneId) {
      continue
    }
    const rect = card.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return paneId
    }
  }

  return null
}

function finishDrag(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)

  const state = dragState.value
  const target = dropTargetId.value
  const wasDragging = isDragging.value

  dragState.value = null
  dropTargetId.value = null
  isDragging.value = false
  guides.value = { vertical: [], horizontal: [] }
  document.body.classList.remove('paneflow-dragging')

  if (wasDragging && state?.kind === 'reorder' && target) {
    const fromIndex = paneOrder.value.indexOf(state.paneId)
    const targetIndex = paneOrder.value.indexOf(target)
    if (fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex) {
      const next = reorderPaneIds(paneOrder.value, state.paneId, targetIndex)
      if (next) {
        paneOrder.value = next
      }
    }
  }

  void nextTick(scheduleMeasure)
}

function onPointerMove(event: PointerEvent): void {
  const state = dragState.value
  if (!state) {
    return
  }

  if (!isDragging.value) {
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (distance < 5) {
      return
    }
    isDragging.value = true
    document.body.classList.add('paneflow-dragging')
    void nextTick(scheduleMeasure)
  }

  event.preventDefault()

  if (state.kind === 'reorder') {
    dropTargetId.value = findDropTarget(event.clientX, event.clientY, state.paneId)
    return
  }

  updateFreeformInteraction(event, state)
}

function onWorkspacePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || maximizedPaneId.value) {
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  const card = target.closest('[data-pane-id]')
  if (!(card instanceof HTMLElement)) {
    return
  }
  const paneId = card.dataset.paneId
  if (!paneId) {
    return
  }
  activePaneId.value = paneId

  if (layoutMode.value === 'freeform') {
    const resizeTarget = target.closest<HTMLElement>('[data-resize]')
    const handle = resizeTarget?.dataset.resize
    if (isResizeHandle(handle)) {
      const startRect = slotRects.value.get(paneId)
      if (!startRect) {
        return
      }
      raisePane(paneId)
      beginInteraction({
        kind: 'resize',
        paneId,
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        handle
      })
      return
    }
  }

  if (!target.closest('.pane-title-row')) {
    return
  }
  if (target.closest('button, a, input, select, textarea, form, [role="button"]')) {
    return
  }

  if (layoutMode.value === 'freeform') {
    const startRect = slotRects.value.get(paneId)
    if (!startRect) {
      return
    }
    raisePane(paneId)
    beginInteraction({
      kind: 'move',
      paneId,
      startX: event.clientX,
      startY: event.clientY,
      startRect
    })
    return
  }

  beginInteraction({
    kind: 'reorder',
    paneId,
    startX: event.clientX,
    startY: event.clientY
  })
}

function scheduleMeasure(): void {
  if (measureFrame !== 0) {
    return
  }
  measureFrame = window.requestAnimationFrame(() => {
    measureFrame = 0
    void measurePanes()
  })
}

async function measurePanes(): Promise<void> {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }

  const workspaceRect = workspace.getBoundingClientRect()
  if (workspaceRect.width < 1 || workspaceRect.height < 1) {
    return
  }

  const updates: Array<{
    paneId: string
    rect: { x: number; y: number; width: number; height: number }
    visible: boolean
  }> = []
  const suspended = new Set<string>()

  for (const element of workspace.querySelectorAll<HTMLElement>('[data-pane-content]')) {
    const paneId = element.dataset.paneContent
    if (!paneId) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      continue
    }
    const nativeViewsHidden = isDragging.value || profilesOpen.value || workspacesOpen.value
    const visible =
      !nativeViewsHidden &&
      (!maximizedPaneId.value || paneId === maximizedPaneId.value) &&
      isRectFullyVisible(rect, workspaceRect)
    if (!visible && !nativeViewsHidden) {
      suspended.add(paneId)
    }
    updates.push({
      paneId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible
    })
  }

  if (updates.length === 0) {
    updateSuspendedPanes(new Set())
    return
  }

  let result: ScriptResult
  try {
    result = await window.paneflow.setPaneBounds(updates)
  } catch {
    layoutError.value = 'Could not synchronize pane layout.'
    return
  }

  updateSuspendedPanes(suspended)

  if (!result.ok) {
    layoutError.value = result.error
    return
  }
  layoutError.value = null
}

watch([actionError, layoutError], () => {
  void nextTick(scheduleMeasure)
})

watch(
  [paneLayoutKey, gridColumns, () => workspaceSize.value.width, () => workspaceSize.value.height],
  () => {
    if (layoutMode.value === 'freeform') {
      ensureFreeformGeometry()
    }
    void nextTick(scheduleMeasure)
  }
)

watch(layoutMode, (mode) => {
  guides.value = { vertical: [], horizontal: [] }
  dropTargetId.value = null
  isDragging.value = false
  dragState.value = null
  maximizedPaneId.value = null
  document.body.classList.remove('paneflow-dragging')
  if (workspaceEl.value) {
    workspaceEl.value.scrollTop = 0
  }

  if (mode === 'freeform') {
    const ids = orderedPanes.value.map((pane) => pane.id)
    const idSet = new Set(ids)
    const retained = freeformOrder.value.filter((paneId) => idSet.has(paneId))
    const retainedSet = new Set(retained)
    freeformOrder.value = [...retained, ...ids.filter((paneId) => !retainedSet.has(paneId))]
  }

  void nextTick(() => {
    ensureFreeformGeometry()
    scheduleMeasure()
  })
})

watch(isDragging, (dragging) => {
  void nextTick(scheduleMeasure)
  if (!dragging) {
    void saveWorkspaceLayout()
  }
})

watch(profilesOpen, () => {
  void nextTick(scheduleMeasure)
})

watch(workspacesOpen, () => {
  void nextTick(scheduleMeasure)
})

watch([paneOrder, gridColumns, layoutMode, freeformGeometries, freeformOrder], () => {
  if (!layoutPersistenceReady || isDragging.value) {
    return
  }
  void saveWorkspaceLayout()
})

onMounted(async () => {
  disposeStateListener = window.paneflow.onStateChanged(applyState)
  disposeMeasureListener = window.paneflow.onRequestMeasurement(scheduleMeasure)
  disposeCommandListener = window.paneflow.onPaneCommand(handlePaneCommand)
  disposeFocusListener = window.paneflow.onPaneFocused((paneId) => {
    if (panes.value.some((pane) => pane.id === paneId)) {
      activePaneId.value = paneId
    }
  })

  resizeObserver = new ResizeObserver(() => {
    readWorkspaceSize()
    scheduleMeasure()
  })
  if (workspaceEl.value) {
    resizeObserver.observe(workspaceEl.value)
  }
  window.addEventListener('resize', handleWindowResize)
  readWorkspaceSize()

  try {
    const initialState = await window.paneflow.getState()
    applyState(initialState)
    await nextTick()
    if (initialState.panes.length > 0 || initialState.layout.gridOrder.length === 0) {
      layoutPersistenceReady = true
      await saveWorkspaceLayout()
    }
  } catch {
    actionError.value = 'Could not read pane state.'
  } finally {
    focusManagementEnabled = true
  }
})

onBeforeUnmount(() => {
  disposeStateListener?.()
  disposeMeasureListener?.()
  disposeCommandListener?.()
  disposeFocusListener?.()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)
  document.body.classList.remove('paneflow-dragging')
  if (measureFrame !== 0) {
    window.cancelAnimationFrame(measureFrame)
  }
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-dragging': isDragging }">
    <header class="toolbar">
      <span class="brand">PaneFlow</span>

      <button
        ref="workspacesButtonEl"
        class="workspace-switcher"
        type="button"
        title="Switch workspace"
        @click="openWorkspaces"
      >
        <span class="workspace-switcher-name">{{ workspaceName }}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      <span class="toolbar-spacer"></span>

      <div class="layout-switch" role="group" aria-label="Layout mode">
        <button
          type="button"
          :class="{ active: layoutMode === 'grid' }"
          :aria-pressed="layoutMode === 'grid'"
          @click="layoutMode = 'grid'"
        >
          Grid
        </button>
        <button
          type="button"
          :class="{ active: layoutMode === 'freeform' }"
          :aria-pressed="layoutMode === 'freeform'"
          @click="layoutMode = 'freeform'"
        >
          Freeform
        </button>
      </div>

      <label v-if="panes.length > 0 && layoutMode === 'grid'" class="grid-control">
        <span class="grid-label">Columns</span>
        <select v-model.number="gridColumns" class="grid-select" aria-label="Grid columns">
          <option v-for="column in 5" :key="column" :value="column">{{ column }}</option>
        </select>
      </label>

      <button
        v-if="panes.length > 0 && layoutMode === 'freeform'"
        class="toolbar-button"
        type="button"
        @click="tidyFreeform"
      >
        Tidy
      </button>

      <span class="pane-count" role="status" aria-live="polite">{{ paneCountLabel }}</span>
      <button
        ref="profilesButtonEl"
        class="toolbar-button"
        type="button"
        title="Manage browser profiles"
        @click="openProfiles"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3.5 13c.4-2.2 2.2-3.5 4.5-3.5s4.1 1.3 4.5 3.5" />
        </svg>
        Profiles
      </button>
      <button
        class="toolbar-button primary"
        type="button"
        :disabled="addingPane"
        @click="addPane"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
        Add pane
      </button>
      <button
        class="icon-button toolbar-icon"
        type="button"
        title="Reload all panes"
        aria-label="Reload all panes"
        :disabled="panes.length === 0"
        @click="reloadAll"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.2 6.4A5.5 5.5 0 1 0 13.5 8" />
          <path d="M13.4 3.2v3.4H10" />
        </svg>
      </button>
    </header>

    <div v-if="errorMessage" class="error-banner" role="status">
      <span class="error-text">{{ errorMessage }}</span>
      <button class="dismiss-button" type="button" aria-label="Dismiss message" @click="dismissErrors">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
    <div v-else-if="gridNotice" class="grid-notice" role="status">
      {{ gridNotice }}
    </div>

    <main
      ref="workspaceEl"
      class="workspace"
      aria-label="Browser workspace"
      @scroll.passive="scheduleMeasure"
      @pointerdown="onWorkspacePointerDown"
      @focusin="onWorkspaceFocusIn"
    >
      <div
        v-if="orderedPanes.length > 0"
        class="pane-grid"
        :style="{ height: `${paneGridHeight}px` }"
      >
        <div
          v-for="pane in orderedPanes"
          :key="pane.id"
          class="pane-slot"
          :class="{
            'pane-slot-dragging': isDragging && dragState?.paneId === pane.id,
            'pane-slot-drop-target': dropTargetId === pane.id
          }"
          :style="paneSlotStyle(pane.id)"
        >
          <PaneCard
            :pane="pane"
            :freeform="layoutMode === 'freeform' && !maximizedPaneId"
            :maximized="maximizedPaneId === pane.id"
            :suspended="suspendedPaneIds.has(pane.id)"
            @close="closePane(pane.id)"
            @menu="openPaneMenu(pane.id, $event)"
            @toggle-maximize="toggleMaximize(pane.id)"
            @raise-pane="raisePane(pane.id)"
            @lower-pane="lowerPane(pane.id)"
            @set-viewport="setPaneViewport(pane.id, $event)"
            @layout-changed="onPaneLayoutChanged"
          />
        </div>
        <span
          v-for="(guide, index) in guides.vertical"
          :key="`v-${index}`"
          class="alignment-guide vertical"
          :style="{ left: `${guide}px` }"
          aria-hidden="true"
        ></span>
        <span
          v-for="(guide, index) in guides.horizontal"
          :key="`h-${index}`"
          class="alignment-guide horizontal"
          :style="{ top: `${guide}px` }"
          aria-hidden="true"
        ></span>
      </div>

      <div v-else class="empty-state">
        <p class="empty-title">No browser panes</p>
        <p class="empty-detail">
          Add a pane to open a real, isolated browser session in this workspace.
        </p>
        <button class="toolbar-button primary" type="button" :disabled="addingPane" @click="addPane">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add pane
        </button>
      </div>
    </main>

    <div v-if="profilesOpen" class="modal-backdrop" @click.self="closeProfiles">
      <section
        ref="profilesDialogEl"
        class="profiles-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profiles-title"
        aria-describedby="profiles-description"
        tabindex="-1"
        @keydown="onProfilesKeydown"
      >
        <header class="profiles-header">
          <div>
            <h2 id="profiles-title" class="profiles-title">Browser profiles</h2>
            <p id="profiles-description" class="profiles-description">
              Each profile keeps its own cookies and site storage. Close its panes before clearing
              or deleting it.
            </p>
          </div>
          <button
            class="icon-button"
            type="button"
            title="Close profiles"
            aria-label="Close profiles"
            @click="closeProfiles"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div v-if="profileError" class="profiles-message profiles-error" role="alert">
          {{ profileError }}
        </div>
        <div v-else-if="profileNotice" class="profiles-message profiles-notice" role="status">
          {{ profileNotice }}
        </div>

        <div v-if="profilesLoading" class="profiles-empty" role="status">Loading profiles…</div>
        <div v-else-if="profiles.length === 0" class="profiles-empty">
          No browser profiles yet. Add a pane to create one.
        </div>
        <ul v-else class="profile-list">
          <li
            v-for="profile in profiles"
            :key="profile.id"
            class="profile-row"
            :data-profile-id="profile.id"
          >
            <div class="profile-info">
              <form
                v-if="renamingProfileId === profile.id"
                class="profile-rename-form"
                @submit.prevent="submitProfileRename(profile)"
              >
                <input
                  v-model="renameDraft"
                  class="profile-rename-input"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  aria-label="Profile name"
                  @input="profileError = null"
                />
                <button class="text-button" type="submit" :disabled="profileBusy">Save</button>
                <button
                  class="text-button"
                  type="button"
                  :disabled="profileBusy"
                  @click="cancelProfileRename"
                >
                  Cancel
                </button>
              </form>
              <span v-else class="profile-label">{{ profile.label }}</span>
              <span class="profile-meta">Created {{ formatProfileDate(profile.createdAt) }}</span>
              <span class="profile-usage" :class="{ 'profile-usage-active': profile.inUse }">
                {{ profile.inUse ? `In use by ${profilePaneTitles(profile)}` : 'Unused' }}
              </span>
            </div>

            <div v-if="renamingProfileId !== profile.id" class="profile-controls">
              <button
                class="text-button"
                type="button"
                :disabled="profileBusy"
                @click="startProfileRename(profile)"
              >
                Rename
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="profileBusy || profile.inUse"
                :title="
                  profile.inUse
                    ? 'Close panes using this profile before clearing its data.'
                    : 'Clear cookies, storage, and cache.'
                "
                @click="requestProfileAction('clear', profile)"
              >
                Clear
              </button>
              <button
                class="text-button text-button-danger"
                type="button"
                :disabled="profileBusy || profile.inUse"
                :title="
                  profile.inUse
                    ? 'Close panes using this profile before deleting it.'
                    : 'Delete this profile and its browser data.'
                "
                @click="requestProfileAction('delete', profile)"
              >
                Delete
              </button>
            </div>

            <div
              v-if="profileAction?.profileId === profile.id"
              class="profile-confirm"
              role="group"
              :aria-label="`Confirm ${profileAction.kind} for ${profile.label}`"
            >
              <span>
                {{
                  profileAction.kind === 'clear'
                    ? `Clear cookies, storage, and cache for “${profile.label}”?`
                    : `Delete “${profile.label}” and its browser data? This cannot be undone.`
                }}
              </span>
              <button
                class="text-button"
                type="button"
                :disabled="profileBusy"
                @click="confirmProfileAction(profile)"
              >
                {{ profileAction.kind === 'clear' ? 'Clear data' : 'Delete profile' }}
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="profileBusy"
                @click="cancelProfileAction"
              >
                Cancel
              </button>
            </div>
          </li>
        </ul>

        <footer class="profiles-footer">
          <span class="profiles-count">
            {{ profiles.length }} profile{{ profiles.length === 1 ? '' : 's' }}
          </span>
          <button class="text-button" type="button" @click="closeProfiles">Close</button>
        </footer>
      </section>
    </div>

    <div v-if="workspacesOpen" class="modal-backdrop" @click.self="closeWorkspaces">
      <section
        ref="workspacesDialogEl"
        class="profiles-dialog workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspaces-title"
        aria-describedby="workspaces-description"
        tabindex="-1"
        @keydown="onWorkspacesKeydown"
      >
        <header class="profiles-header">
          <div>
            <h2 id="workspaces-title" class="profiles-title">Workspaces</h2>
            <p id="workspaces-description" class="profiles-description">
              Each workspace keeps its own panes, layout, URLs, and viewport settings. Switching
              closes the current pane views and opens the selected workspace.
            </p>
          </div>
          <button
            class="icon-button"
            type="button"
            title="Close workspaces"
            aria-label="Close workspaces"
            @click="closeWorkspaces"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div v-if="workspaceError" class="profiles-message profiles-error" role="alert">
          {{ workspaceError }}
        </div>
        <div v-else-if="workspaceNotice" class="profiles-message profiles-notice" role="status">
          {{ workspaceNotice }}
        </div>

        <form class="workspace-create" @submit.prevent="createWorkspace">
          <input
            v-model="newWorkspaceName"
            class="workspace-name-input"
            type="text"
            maxlength="80"
            autocomplete="off"
            aria-label="New workspace name"
            placeholder="New workspace name"
            :disabled="workspaceBusy"
            @input="workspaceError = null"
          />
          <button class="text-button" type="submit" :disabled="workspaceBusy">Create</button>
        </form>

        <div v-if="workspacesLoading" class="profiles-empty" role="status">
          Loading workspaces…
        </div>
        <div v-else-if="workspaces.length === 0" class="profiles-empty">
          No workspaces yet.
        </div>
        <ul v-else class="profile-list">
          <li
            v-for="workspace in workspaces"
            :key="workspace.id"
            class="profile-row workspace-row"
            :data-workspace-id="workspace.id"
          >
            <div class="profile-info">
              <div v-if="renamingWorkspaceId === workspace.id" class="profile-rename-form">
                <input
                  v-model="workspaceRenameDraft"
                  class="profile-rename-input workspace-rename-input"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  aria-label="Workspace name"
                  @input="workspaceError = null"
                />
                <button
                  class="text-button"
                  type="button"
                  :disabled="workspaceBusy"
                  @click="submitWorkspaceRename(workspace)"
                >
                  Save
                </button>
                <button
                  class="text-button"
                  type="button"
                  :disabled="workspaceBusy"
                  @click="cancelWorkspaceRename"
                >
                  Cancel
                </button>
              </div>
              <span v-else class="profile-label">
                <span class="workspace-label-text">{{ workspace.name }}</span>
                <span v-if="workspace.active" class="workspace-badge">Active</span>
              </span>
              <span class="profile-meta">
                {{ workspace.paneCount }} {{ workspace.paneCount === 1 ? 'pane' : 'panes' }} ·
                Updated {{ formatProfileDate(workspace.updatedAt) }}
              </span>
            </div>

            <div v-if="renamingWorkspaceId !== workspace.id" class="profile-controls">
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy || workspace.active"
                @click="switchToWorkspace(workspace)"
              >
                Switch
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="startWorkspaceRename(workspace)"
              >
                Rename
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="duplicateWorkspace(workspace)"
              >
                Duplicate
              </button>
              <button
                class="text-button text-button-danger"
                type="button"
                :disabled="workspaceBusy || workspace.active || workspaces.length <= 1"
                @click="requestWorkspaceDelete(workspace)"
              >
                Delete
              </button>
            </div>

            <div
              v-if="workspaceDeleteId === workspace.id"
              class="profile-confirm"
              role="group"
              :aria-label="`Confirm delete workspace ${workspace.name}`"
            >
              <span>Delete “{{ workspace.name }}” and its saved layout? This cannot be undone.</span>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="confirmWorkspaceDelete(workspace)"
              >
                Delete workspace
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="cancelWorkspaceDelete"
              >
                Cancel
              </button>
            </div>
          </li>
        </ul>

        <footer class="profiles-footer">
          <span class="profiles-count">
            {{ workspaces.length }} workspace{{ workspaces.length === 1 ? '' : 's' }}
          </span>
          <button class="text-button" type="button" @click="closeWorkspaces">Close</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  user-select: none;
}

.brand {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.toolbar-spacer {
  flex: 1;
}

.pane-count {
  color: var(--text-faint);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.grid-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.grid-label {
  color: var(--text-faint);
}

.grid-select {
  height: 26px;
  min-width: 44px;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 11.5px;
}

.grid-select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.layout-switch {
  display: inline-flex;
  height: 26px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface-inset);
}

.layout-switch button {
  padding: 0 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.layout-switch button:hover {
  color: var(--text);
}

.layout-switch button.active {
  background: var(--surface-raised);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.toolbar-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.toolbar-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-inset);
}

.toolbar-button.primary {
  border-color: transparent;
  background: var(--text);
  color: var(--bg);
}

.toolbar-button.primary:hover:not(:disabled) {
  background: var(--text);
  opacity: 0.86;
}

.toolbar-button svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 5px;
  color: var(--text-muted);
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-inset);
  color: var(--text);
}

.toolbar-icon svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.error-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}

.error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-notice {
  flex: none;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-inset);
  color: var(--text-muted);
  font-size: 12px;
}

.dismiss-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: inherit;
}

.dismiss-button:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.dismiss-button svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.workspace {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.pane-grid {
  position: relative;
  min-height: 100%;
}

.pane-slot {
  position: absolute;
}

.pane-slot-dragging {
  opacity: 0.65;
}

.pane-slot-drop-target {
  border-radius: 11px;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.alignment-guide {
  position: absolute;
  z-index: 1000;
  background: var(--accent);
  pointer-events: none;
}

.alignment-guide.vertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.alignment-guide.horizontal {
  right: 0;
  left: 0;
  height: 1px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 10px;
  color: var(--text-muted);
  text-align: center;
}

.empty-title {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.empty-detail {
  max-width: 36ch;
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(18, 18, 17, 0.35);
}

.profiles-dialog {
  display: flex;
  flex-direction: column;
  width: min(700px, 100%);
  max-height: min(740px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  outline: none;
}

.profiles-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
}

.profiles-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.profiles-description {
  max-width: 62ch;
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.profiles-message {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.4;
}

.profiles-error {
  background: var(--danger-soft);
  color: var(--danger);
}

.profiles-notice {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.profiles-empty {
  padding: 26px 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.profile-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 14px;
  align-items: start;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.profile-row:first-child {
  border-top: none;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.profile-label {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-meta,
.profile-usage {
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.4;
}

.profile-usage {
  color: var(--text-muted);
}

.profile-usage-active {
  color: var(--accent-strong);
}

.profile-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.profile-controls .text-button,
.profile-confirm .text-button,
.profile-rename-form .text-button {
  margin-top: 0;
  padding: 3px 8px;
  font-size: 11.5px;
}

.text-button-danger {
  color: var(--danger);
}

.text-button-danger:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}

.profile-rename-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.profile-rename-input {
  width: min(280px, 100%);
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 12px;
}

.profile-rename-input:focus {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.profile-confirm {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-inset);
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.4;
}

.profiles-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}

.profiles-count {
  color: var(--text-faint);
  font-size: 11.5px;
}

.workspace-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 210px;
  height: 28px;
  margin-left: 4px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
}

.workspace-switcher:hover {
  border-color: var(--border);
  background: var(--surface-inset);
  color: var(--text);
}

.workspace-switcher-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-switcher svg {
  flex: none;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workspace-create {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}

.workspace-name-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 12px;
}

.workspace-name-input:focus {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.workspace-create .text-button {
  margin-top: 0;
  padding: 3px 10px;
  font-size: 11.5px;
}

.workspace-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  vertical-align: 1px;
}

.workspace-rename-input {
  width: min(300px, 100%);
}
</style>
