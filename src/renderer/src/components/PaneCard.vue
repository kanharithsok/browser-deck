<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import PaneNavigation from './PaneNavigation.vue'
import type { PaneChromeStyle } from '../../../shared/pane-chrome'
import type { PaneState } from '../../../shared/ipc'
import {
  findViewportPreset,
  viewportContentSize,
  type PaneViewport
} from '../../../shared/viewports'
import { MAX_PANE_TITLE_LENGTH } from '../../../shared/workspace'

const props = withDefaults(
  defineProps<{
    pane: PaneState
    freeform?: boolean
    suspended?: boolean
    active?: boolean
    renameRequest?: number
    notice?: string
    chromeStyle?: PaneChromeStyle
    snapshot?: string
    canvas?: boolean
    viewportMenuOpen?: boolean
    customViewportRequest?: number
  }>(),
  {
    freeform: false,
    suspended: false,
    active: false,
    renameRequest: 0,
    notice: undefined,
    chromeStyle: 'a',
    snapshot: undefined,
    canvas: false,
    viewportMenuOpen: false,
    customViewportRequest: 0
  }
)

const emit = defineEmits<{
  close: []
  menu: [position: { x: number; y: number }]
  'raise-pane': []
  'lower-pane': []
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
  'open-viewport-menu': [paneId: string, trigger: HTMLElement]
  'open-external': []
}>()

const titleInput = ref<HTMLInputElement | null>(null)
const addressError = ref<string | null>(null)
const renaming = ref(false)
const savingTitle = ref(false)
const titleDraft = ref('')
const titleError = ref<string | null>(null)
const statusId = `pane-status-${props.pane.id}`

const viewportPresetName = computed(() => {
  const viewport = props.pane.viewport
  if (viewport.preset === 'responsive') {
    return 'Responsive'
  }
  if (viewport.preset === 'custom') {
    return 'Custom'
  }
  const preset = findViewportPreset(viewport.preset)
  return preset?.label.split(' — ')[0] ?? preset?.label ?? viewport.preset
})

const viewportSizeLabel = computed(() => {
  const viewport = props.pane.viewport
  if (viewport.preset === 'responsive') {
    return ''
  }
  const size = viewportContentSize(viewport)
  return `${size.width} × ${size.height}`
})

const viewportLabel = computed(() =>
  viewportSizeLabel.value
    ? `${viewportPresetName.value} · ${viewportSizeLabel.value}`
    : viewportPresetName.value
)

const showViewportBadge = computed(
  () => props.chromeStyle === 'c' || props.chromeStyle === 'b'
)

const titleTooltip = computed(() => {
  const title = props.pane.customTitle ?? props.pane.title
  return props.pane.customTitle
    ? `${title} (custom device name; double-click to rename; clear it to use the page title)`
    : `${title} (double-click to rename)`
})

function startRename(): void {
  if (renaming.value) {
    titleInput.value?.focus()
    titleInput.value?.select()
    return
  }
  titleDraft.value = (props.pane.customTitle ?? props.pane.title).slice(0, MAX_PANE_TITLE_LENGTH)
  titleError.value = null
  renaming.value = true
  void nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}

function cancelRename(): void {
  if (!renaming.value) {
    return
  }
  renaming.value = false
  titleError.value = null
  titleInput.value?.blur()
}

async function submitRename(): Promise<void> {
  if (!renaming.value || savingTitle.value) {
    return
  }
  savingTitle.value = true
  try {
    const result = await window.paneflow.renamePane(props.pane.id, titleDraft.value.trim())
    if (!result.ok) {
      titleError.value = result.error
      await nextTick()
      titleInput.value?.focus()
      titleInput.value?.select()
      return
    }
    titleError.value = null
    renaming.value = false
    titleInput.value?.blur()
  } catch {
    titleError.value = 'Could not rename the device.'
    await nextTick()
    titleInput.value?.focus()
  } finally {
    savingTitle.value = false
  }
}

function onTitleBlur(): void {
  if (renaming.value) {
    void submitRename()
  }
}

watch(
  () => props.renameRequest,
  (value, previous) => {
    if (value > previous) {
      startRename()
    }
  }
)

function goBack(): void {
  if (props.pane.canGoBack) {
    void window.paneflow.back(props.pane.id).catch(() => undefined)
  }
}

function goForward(): void {
  if (props.pane.canGoForward) {
    void window.paneflow.forward(props.pane.id).catch(() => undefined)
  }
}

function reload(): void {
  void window.paneflow.reload(props.pane.id).catch(() => undefined)
}

function openMenu(event: MouseEvent): void {
  const button = event.currentTarget
  if (!(button instanceof HTMLElement)) {
    return
  }
  const rect = button.getBoundingClientRect()
  emit('menu', { x: rect.right - 2, y: rect.bottom + 2 })
}

function openViewportMenu(event: MouseEvent): void {
  const trigger = event.currentTarget
  if (trigger instanceof HTMLElement) {
    emit('open-viewport-menu', props.pane.id, trigger)
  }
}

function openExternal(): void {
  emit('open-external')
}

function requestClose(): void {
  emit('close')
}
</script>

<template>
  <article
    class="pane-card"
    :class="[
      `pane-card-${chromeStyle}`,
      {
        'pane-card-freeform': freeform,
        'pane-card-active': active,
        'pane-card-canvas': canvas
      }
    ]"
    :data-pane-id="pane.id"
    :data-pane-chrome="chromeStyle"
    :aria-label="`Browser device: ${pane.title}`"
    :aria-current="active ? 'true' : undefined"
  >
    <div class="pane-header-shell">
      <header class="pane-header">
        <div class="pane-header-row">
          <span class="pane-drag-grip" aria-hidden="true">
            <svg viewBox="0 0 6 16">
              <circle cx="1.5" cy="4" r="1" />
              <circle cx="4.5" cy="4" r="1" />
              <circle cx="1.5" cy="8" r="1" />
              <circle cx="4.5" cy="8" r="1" />
              <circle cx="1.5" cy="12" r="1" />
              <circle cx="4.5" cy="12" r="1" />
            </svg>
          </span>
          <div class="pane-main">
            <div class="pane-title-row">
              <span v-if="pane.isLoading" class="spinner" aria-hidden="true"></span>
              <span v-else class="status-dot" :class="{ 'status-dot-error': pane.error }" aria-hidden="true"></span>

              <span v-if="!renaming" class="pane-title" :title="titleTooltip" @dblclick="startRename">
                {{ pane.title }}
              </span>
              <form v-else class="pane-title-form" @submit.prevent="submitRename">
                <input
                  ref="titleInput"
                  v-model="titleDraft"
                  class="pane-title-input"
                  :class="{ 'pane-title-input-invalid': titleError }"
                  type="text"
                  :maxlength="MAX_PANE_TITLE_LENGTH"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Use page title"
                  :aria-label="`Device name for ${pane.title}`"
                  :aria-invalid="titleError ? 'true' : 'false'"
                  :aria-describedby="titleError ? statusId : undefined"
                  @input="titleError = null"
                  @blur="onTitleBlur"
                  @keydown.esc.prevent="cancelRename"
                />
              </form>
              <button
                v-if="showViewportBadge"
                class="pane-viewport-trigger"
                type="button"
                :data-preset="pane.viewport.preset"
                :title="`Viewport preset: ${viewportLabel}`"
                :aria-label="`Viewport preset for device ${pane.title}: ${viewportLabel}`"
                aria-haspopup="menu"
                :aria-expanded="viewportMenuOpen"
                @click="openViewportMenu"
              >
                <span class="viewport-trigger-label">{{ viewportPresetName }}</span>
                <span v-if="viewportSizeLabel" class="pane-viewport-size">
                  {{ viewportSizeLabel }}
                </span>
                <svg class="pane-viewport-chevron" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m3 4.5 3 3 3-3" />
                </svg>
              </button>

              <span
                :id="statusId"
                class="pane-status"
                role="status"
                aria-live="polite"
                :title="titleError ?? addressError ?? pane.error ?? notice ?? undefined"
              >
                <template v-if="titleError">{{ titleError }}</template>
                <template v-else-if="addressError">{{ addressError }}</template>
                <template v-else-if="pane.error">Load failed</template>
                <template v-else-if="notice">{{ notice }}</template>
                <template v-else-if="pane.isLoading"><span class="sr-only">Loading</span></template>
              </span>
            </div>
          </div>

          <div class="pane-actions">
            <button
              v-if="freeform"
              class="icon-button"
              type="button"
              title="Bring device to front"
              aria-label="Bring device to front"
              @click="emit('raise-pane')"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 13V3M4 7l4-4 4 4" />
              </svg>
            </button>
            <button
              v-if="freeform"
              class="icon-button"
              type="button"
              title="Send device to back"
              aria-label="Send device to back"
              @click="emit('lower-pane')"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 3v10M4 9l4 4 4-4" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Back"
              aria-label="Go back"
              :disabled="!pane.canGoBack"
              @click="goBack"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M9.5 3.5 5 8l4.5 4.5" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Forward"
              aria-label="Go forward"
              :disabled="!pane.canGoForward"
              @click="goForward"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6.5 3.5 11 8l-4.5 4.5" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Reload device"
              aria-label="Reload device"
              @click="reload"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M12.6 6.3A5 5 0 1 0 13 8" />
                <path d="M12.8 3.3v3.2H9.6" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Open in browser"
              aria-label="Open in browser"
              :disabled="pane.url === 'about:blank'"
              @click="openExternal"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M9 3h4v4M13 3 7.5 8.5" />
                <path d="M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Device actions"
              aria-label="Device actions"
              @click="openMenu"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.2" fill="currentColor" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="13" cy="8" r="1.2" fill="currentColor" />
              </svg>
            </button>
            <button
              class="icon-button"
              type="button"
              title="Close device (Delete)"
              aria-label="Close device"
              @click="requestClose"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        <div class="pane-address-row">
          <PaneNavigation
            :pane="pane"
            :status-id="statusId"
            :custom-viewport-request="customViewportRequest"
            :show-viewport-trigger="false"
            @address-error="addressError = $event"
            @set-viewport="emit('set-viewport', $event)"
            @layout-changed="emit('layout-changed')"
          />
        </div>
      </header>
    </div>

    <div class="pane-body">
      <div class="pane-content" :data-pane-content="pane.id">
        <img
          v-if="snapshot && !pane.error && pane.url !== 'about:blank'"
          class="pane-snapshot"
          :src="snapshot"
          alt=""
          draggable="false"
        />
        <div v-if="pane.error" class="pane-message" role="alert">
          <p class="message-title">This page could not load</p>
          <p class="message-detail">{{ pane.error }}</p>
          <button class="text-button" type="button" @click="reload">Try again</button>
        </div>
        <div v-else-if="pane.url === 'about:blank' && !pane.isLoading" class="pane-message">
          <p class="message-title">No page loaded</p>
          <p class="message-detail">Enter an address above to open a site in this device.</p>
        </div>
        <div v-else-if="suspended && !pane.isLoading && !snapshot" class="pane-message">
          <p class="message-title">Device hidden while off-screen</p>
          <p v-if="canvas" class="message-detail">
            Select this device to bring it fully into view.
          </p>
          <p v-else class="message-detail">
            Scroll this device fully into view to interact with the site.
          </p>
        </div>
        <div v-else-if="pane.isLoading && !snapshot" class="pane-message" aria-hidden="true">
          <span class="spinner"></span>
          <p class="message-detail">Opening browser view</p>
        </div>
      </div>
    </div>

    <div v-if="freeform" class="resize-handles" aria-hidden="true">
      <span class="resize-handle resize-n" data-resize="n"></span>
      <span class="resize-handle resize-s" data-resize="s"></span>
      <span class="resize-handle resize-e" data-resize="e"></span>
      <span class="resize-handle resize-w" data-resize="w"></span>
      <span class="resize-handle resize-ne" data-resize="ne"></span>
      <span class="resize-handle resize-nw" data-resize="nw"></span>
      <span class="resize-handle resize-se" data-resize="se"></span>
      <span class="resize-handle resize-sw" data-resize="sw"></span>
    </div>
  </article>
</template>

<style scoped>
.pane-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
  overflow: hidden;
}

.pane-header-shell {
  position: relative;
  flex: none;
  height: calc(64px * var(--pane-zoom, 1));
  overflow: visible;
}

.pane-header {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: var(--pane-world-width, 100%);
  height: 64px;
  min-height: 64px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  transform: scale(var(--pane-zoom, 1));
  transform-origin: top left;
  container-type: inline-size;
}

.pane-header-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0 4px;
  width: 100%;
  height: 32px;
  padding: 0 6px;
}

.pane-address-row {
  display: flex;
  flex: none;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 6px 2px;
}

.pane-card-c .pane-header {
  border-bottom-color: transparent;
}

.pane-drag-grip {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 24px;
  color: var(--text-faint);
  opacity: 0.45;
  cursor: grab;
}

.pane-drag-grip svg {
  width: 6px;
  height: 16px;
  fill: currentColor;
}

.pane-card-active .pane-drag-grip,
.pane-card-canvas .pane-drag-grip {
  opacity: 0.7;
}

.pane-card-canvas {
  background: transparent;
}

.pane-card-canvas .pane-header {
  padding: 0;
  background: transparent;
  cursor: grab;
}

.pane-card-canvas .pane-header-row,
.pane-card-canvas .pane-address-row {
  padding-right: 2px;
  padding-left: 2px;
}

.pane-card-canvas .pane-title-row {
  gap: 5px;
  cursor: grab;
}

.pane-card-canvas .pane-viewport-trigger {
  background: transparent;
}

.pane-card-canvas .pane-actions {
  margin-top: 0;
}

.pane-card-canvas .pane-body {
  background: transparent;
}

.pane-main {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 4px;
  min-width: 0;
}

.pane-title-row {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 31px;
  padding: 0 1px;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.spinner {
  flex: none;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin: 0 1.5px;
  border-radius: 50%;
  background: var(--text-faint);
  opacity: 0.75;
}

.status-dot-error {
  background: var(--danger);
  opacity: 1;
}

.pane-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-title-form {
  flex: 1 1 auto;
  min-width: 0;
}

.pane-title-input {
  width: 100%;
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  outline: 2px solid var(--accent);
  outline-offset: 0;
  user-select: text;
}

.pane-title-input::placeholder {
  color: var(--text-faint);
  font-weight: 400;
}

.pane-title-input-invalid,
.pane-title-input-invalid:focus {
  border-color: var(--danger);
  outline-color: var(--danger);
}

.pane-viewport-trigger {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 210px;
  height: 22px;
  padding: 0 4px;
  border: 0;
  border-radius: 4px;
  background: var(--surface-inset);
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.pane-viewport-trigger:hover {
  background: var(--surface-raised);
  color: var(--text);
}

.pane-viewport-trigger:focus-visible {
  outline: 1px solid var(--focus);
  outline-offset: -1px;
}

.viewport-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-viewport-size {
  color: var(--text-faint);
}

.pane-viewport-chevron {
  flex: none;
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pane-status {
  flex: none;
  max-width: 140px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-status:empty {
  display: none;
}

.pane-actions {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin-top: 0;
}

.icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: var(--text-muted);
  opacity: 0.6;
}

.pane-card-active .icon-button,
.icon-button:hover:not(:disabled),
.icon-button:focus-visible {
  opacity: 1;
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-inset);
  color: var(--text);
}

.icon-button:disabled {
  opacity: 0.3;
}

.icon-button svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.pane-body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: var(--pane-canvas);
}

.resize-handle {
  position: absolute;
  z-index: 3;
}

.resize-n {
  top: 0;
  right: 8px;
  left: 8px;
  height: 6px;
  cursor: ns-resize;
}

.resize-s {
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 6px;
  cursor: ns-resize;
}

.resize-e {
  top: 8px;
  right: 0;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}

.resize-w {
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 6px;
  cursor: ew-resize;
}

.resize-ne,
.resize-nw,
.resize-se,
.resize-sw {
  width: 10px;
  height: 10px;
}

.resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.resize-se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}

.resize-se::after {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 4px;
  height: 4px;
  border-right: 1px solid var(--text-faint);
  border-bottom: 1px solid var(--text-faint);
  content: '';
}

.resize-sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.pane-content {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--pane-canvas);
}

.pane-snapshot {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.pane-message {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.message-title {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.message-detail {
  max-width: 42ch;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.text-button {
  margin-top: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
}

.text-button:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
}

@container (max-width: 470px) {
  .pane-viewport-size {
    display: none;
  }
}
</style>
