<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PaneCard from './components/PaneCard.vue'
import type { PaneState, ScriptResult, ShellState } from '../../shared/ipc'
import {
  DEFAULT_GRID_COLUMNS,
  layoutGrid,
  type GridLayout,
  type Size
} from '../../shared/layout'

const panes = ref<PaneState[]>([])
const workspaceEl = ref<HTMLElement | null>(null)
const workspaceSize = ref<Size>({ width: 0, height: 0 })
const gridColumns = ref(DEFAULT_GRID_COLUMNS)
const actionError = ref<string | null>(null)
const layoutError = ref<string | null>(null)
const addingPane = ref(false)

let disposeStateListener: (() => void) | null = null
let disposeMeasureListener: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let measureFrame = 0
let focusManagementEnabled = false

const paneCountLabel = computed(() => {
  const count = panes.value.length
  return `${count} ${count === 1 ? 'pane' : 'panes'}`
})

const paneLayoutKey = computed(() => panes.value.map((pane) => pane.id).join('|'))
const errorMessage = computed(() => actionError.value ?? layoutError.value)

const gridLayout = computed<GridLayout | null>(() => {
  if (panes.value.length === 0 || workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    return null
  }

  const result = layoutGrid(
    panes.value.map((pane) => pane.id),
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

const gridNotice = computed(() => {
  const layout = gridLayout.value
  if (!layout) {
    return null
  }
  if (layout.needsVerticalScroll) {
    return 'This window is too short for all panes. Enlarge it or use more columns.'
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
  const rect = placementByPane.value.get(paneId)
  if (!rect) {
    return { visibility: 'hidden' }
  }

  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
}

function handleWindowResize(): void {
  readWorkspaceSize()
  scheduleMeasure()
}

function applyState(state: ShellState): void {
  const previousIds = new Set(panes.value.map((pane) => pane.id))
  const addedPane =
    focusManagementEnabled && state.panes.length > panes.value.length
      ? state.panes.find((pane) => !previousIds.has(pane.id))
      : undefined
  const removedPane = focusManagementEnabled && state.panes.length < panes.value.length

  panes.value = state.panes

  void nextTick(() => {
    if (addedPane) {
      focusPaneAddress(addedPane.id)
    } else if (removedPane && document.activeElement === document.body) {
      recoverFocus()
    }
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

  const updates: Array<{
    paneId: string
    rect: { x: number; y: number; width: number; height: number }
  }> = []

  for (const element of workspace.querySelectorAll<HTMLElement>('[data-pane-content]')) {
    const paneId = element.dataset.paneContent
    if (!paneId) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      continue
    }
    updates.push({
      paneId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  }

  if (updates.length === 0) {
    return
  }

  let result: ScriptResult
  try {
    result = await window.paneflow.setPaneBounds(updates)
  } catch {
    layoutError.value = 'Could not synchronize pane layout.'
    return
  }

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
    void nextTick(scheduleMeasure)
  }
)

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
  if (measureFrame !== 0) {
    window.cancelAnimationFrame(measureFrame)
  }
})
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <span class="brand">PaneFlow</span>

      <span class="toolbar-spacer"></span>

      <label v-if="panes.length > 0" class="grid-control">
        <span class="grid-label">Columns</span>
        <select v-model.number="gridColumns" class="grid-select" aria-label="Grid columns">
          <option v-for="column in 5" :key="column" :value="column">{{ column }}</option>
        </select>
      </label>

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

    <main ref="workspaceEl" class="workspace" aria-label="Browser workspace">
      <div v-if="panes.length > 0" class="pane-grid">
        <div
          v-for="pane in panes"
          :key="pane.id"
          class="pane-slot"
          :style="paneSlotStyle(pane.id)"
        >
          <PaneCard
            :pane="pane"
            @close="closePane(pane.id)"
            @menu="openPaneMenu(pane.id, $event)"
          />
        </div>
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
  overflow: hidden;
}

.pane-grid {
  position: absolute;
  inset: 0;
}

.pane-slot {
  position: absolute;
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
