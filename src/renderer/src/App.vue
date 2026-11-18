<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PaneCard from './components/PaneCard.vue'
import type { PaneState, ScriptResult, ShellState } from '../../shared/ipc'
import {
  DEFAULT_GRID_COLUMNS,
  DEFAULT_MIN_PANE_HEIGHT,
  DEFAULT_MIN_PANE_WIDTH,
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

const panes = ref<PaneState[]>([])
const paneOrder = ref<string[]>([])
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
let resizeObserver: ResizeObserver | null = null
let measureFrame = 0
let focusManagementEnabled = false

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

function applyState(state: ShellState): void {
  const previousIds = new Set(panes.value.map((pane) => pane.id))
  const addedPane =
    focusManagementEnabled && state.panes.length > panes.value.length
      ? state.panes.find((pane) => !previousIds.has(pane.id))
      : undefined
  const removedPane = focusManagementEnabled && state.panes.length < panes.value.length

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

  panes.value = state.panes

  void nextTick(() => {
    if (layoutMode.value === 'freeform') {
      ensureFreeformGeometry()
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
    const visible =
      !isDragging.value &&
      (!maximizedPaneId.value || paneId === maximizedPaneId.value) &&
      isRectFullyVisible(rect, workspaceRect)
    if (!visible && !isDragging.value) {
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

watch(isDragging, () => {
  void nextTick(scheduleMeasure)
})

onMounted(async () => {
  disposeStateListener = window.paneflow.onStateChanged(applyState)
  disposeMeasureListener = window.paneflow.onRequestMeasurement(scheduleMeasure)

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
    applyState(await window.paneflow.getState())
  } catch {
    actionError.value = 'Could not read pane state.'
  } finally {
    focusManagementEnabled = true
  }
})

onBeforeUnmount(() => {
  disposeStateListener?.()
  disposeMeasureListener?.()
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
</style>
