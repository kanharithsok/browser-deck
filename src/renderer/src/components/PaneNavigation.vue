<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { PaneState, ScriptResult } from '../../../shared/ipc'
import {
  findViewportPreset,
  parsePaneViewport,
  type PaneViewport,
  type ViewportPresetId
} from '../../../shared/viewports'
import { addressSecurityState } from '../../../shared/url'

const props = withDefaults(
  defineProps<{
    pane: PaneState
    statusId: string
    viewportMenuOpen?: boolean
    customViewportRequest?: number
    showViewportTrigger?: boolean
  }>(),
  {
    viewportMenuOpen: false,
    customViewportRequest: 0,
    showViewportTrigger: true
  }
)

const emit = defineEmits<{
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
  'address-error': [message: string | null]
  'open-viewport-menu': [trigger: HTMLElement]
}>()

const addressInput = ref<HTMLInputElement | null>(null)
const customWidthInput = ref<HTMLInputElement | null>(null)
const address = ref(displayAddress(props.pane.url))
const insecure = computed(() => addressSecurityState(props.pane.url) === 'insecure')
const addressError = ref<string | null>(null)
const editing = ref(false)
const selectedPreset = ref<ViewportPresetId>(props.pane.viewport.preset)
const customOpen = ref(false)
const customWidth = ref(props.pane.viewport.preset === 'custom' ? props.pane.viewport.width : 800)
const customHeight = ref(props.pane.viewport.preset === 'custom' ? props.pane.viewport.height : 600)
const customDeviceScaleFactor = ref(
  props.pane.viewport.preset === 'custom' ? props.pane.viewport.deviceScaleFactor : 1
)
const viewportError = ref<string | null>(null)

const selectedPresetLabel = computed(() => {
  if (selectedPreset.value === 'responsive') {
    return 'Responsive viewport'
  }
  if (selectedPreset.value === 'custom') {
    return 'Custom viewport'
  }
  return findViewportPreset(selectedPreset.value)?.label ?? selectedPreset.value
})

const selectedPresetDisplay = computed(() => {
  if (selectedPreset.value === 'responsive') {
    return 'Responsive'
  }
  if (selectedPreset.value === 'custom') {
    return 'Custom viewport'
  }
  const preset = findViewportPreset(selectedPreset.value)
  return preset?.label.split(' — ')[0] ?? preset?.label ?? selectedPreset.value
})

function displayAddress(url: string): string {
  return url === 'about:blank' ? '' : url
}

function setAddressError(message: string | null): void {
  addressError.value = message
  emit('address-error', message)
}

watch(
  () => props.pane.url,
  (url) => {
    if (!editing.value) {
      address.value = displayAddress(url)
    }
  }
)

watch(
  () => props.pane.viewport,
  (viewport) => {
    selectedPreset.value = viewport.preset
    customOpen.value = false
    if (viewport.preset === 'custom') {
      customWidth.value = viewport.width
      customHeight.value = viewport.height
      customDeviceScaleFactor.value = viewport.deviceScaleFactor
    }
  }
)

watch(
  () => props.customViewportRequest,
  (request) => {
    if (request > 0) {
      startCustomViewport()
    }
  }
)

function startCustomViewport(): void {
  const viewport = props.pane.viewport
  if (viewport.preset !== 'custom') {
    customWidth.value = viewport.preset === 'responsive' ? 800 : viewport.width
    customHeight.value = viewport.preset === 'responsive' ? 600 : viewport.height
    customDeviceScaleFactor.value =
      viewport.preset === 'responsive' ? 1 : viewport.deviceScaleFactor
  }
  selectedPreset.value = 'custom'
  viewportError.value = null
  customOpen.value = true
  emit('layout-changed')
  void nextTick(() => customWidthInput.value?.focus())
}

function openCustomEditor(): void {
  startCustomViewport()
}

function openViewportMenu(event: MouseEvent): void {
  const trigger = event.currentTarget
  if (trigger instanceof HTMLElement) {
    emit('open-viewport-menu', trigger)
  }
}

function applyCustomViewport(): void {
  const parsed = parsePaneViewport({
    preset: 'custom',
    width: Number(customWidth.value),
    height: Number(customHeight.value),
    deviceScaleFactor: Number(customDeviceScaleFactor.value),
    ...(props.pane.viewport.rotated ? { rotated: true } : {})
  })

  if (!parsed.ok) {
    viewportError.value = parsed.error
    return
  }

  viewportError.value = null
  customOpen.value = false
  emit('set-viewport', parsed.viewport)
  emit('layout-changed')
}

function cancelCustomViewport(): void {
  const viewport = props.pane.viewport
  selectedPreset.value = viewport.preset
  customWidth.value = viewport.preset === 'custom' ? viewport.width : 800
  customHeight.value = viewport.preset === 'custom' ? viewport.height : 600
  customDeviceScaleFactor.value = viewport.preset === 'custom' ? viewport.deviceScaleFactor : 1
  viewportError.value = null
  const wasOpen = customOpen.value
  customOpen.value = false
  if (wasOpen) {
    emit('layout-changed')
  }
}

function resetAddress(): void {
  address.value = displayAddress(props.pane.url)
  setAddressError(null)
  editing.value = false
  addressInput.value?.blur()
}

function handleBlur(): void {
  editing.value = false
  if (addressError.value) {
    // Keep the invalid value and its reason visible until the user edits it or
    // presses Escape, instead of silently discarding both on blur.
    return
  }
  address.value = displayAddress(props.pane.url)
}

async function submitAddress(): Promise<void> {
  const value = address.value.trim()
  if (!value) {
    setAddressError('Enter an address.')
    return
  }

  let result: ScriptResult
  try {
    result = await window.browserdeck.navigate(props.pane.id, value)
  } catch {
    setAddressError('Could not navigate to that address.')
    return
  }

  if (!result.ok) {
    setAddressError(result.error)
    return
  }

  setAddressError(null)
  editing.value = false
  addressInput.value?.blur()
}

</script>

<template>
  <div class="pane-nav-row" :class="{ 'pane-nav-row-editing': customOpen }">
    <span
      v-if="insecure"
      class="pane-security"
      role="img"
      aria-label="Not secure. This page uses HTTP; information can be intercepted."
      title="Not secure: this page uses HTTP. Information can be intercepted."
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.5 14 13H2Z" />
        <path d="M8 6.2v3.1" />
        <path d="M8 11.4h.01" />
      </svg>
      <span class="pane-security-label" aria-hidden="true">Not secure</span>
    </span>

    <template v-if="!customOpen">
      <form class="address-form" @submit.prevent="submitAddress">
        <input
          ref="addressInput"
          v-model="address"
          class="address-input"
          :class="{ 'address-input-invalid': addressError }"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :placeholder="pane.url === 'about:blank' ? 'Enter an address' : ''"
          :aria-label="`Address for browser ${pane.title}`"
          :aria-invalid="addressError ? 'true' : 'false'"
          :aria-describedby="addressError ? statusId : undefined"
          @input="setAddressError(null)"
          @focus="editing = true"
          @blur="handleBlur"
          @keydown.esc.prevent="resetAddress"
        />
      </form>

      <span
        v-if="addressError"
        class="address-error"
        aria-hidden="true"
        :title="addressError"
      >
        {{ addressError }}
      </span>

      <template v-if="showViewportTrigger">
        <button
          class="viewport-select viewport-trigger"
          type="button"
          :data-preset="selectedPreset"
          :title="`Viewport preset: ${selectedPresetLabel}`"
          :aria-label="`Viewport preset for browser ${pane.title}: ${selectedPresetLabel}`"
          aria-haspopup="menu"
          :aria-expanded="viewportMenuOpen"
          @click="openViewportMenu"
        >
          <span class="viewport-trigger-label">{{ selectedPresetDisplay }}</span>
          <svg class="viewport-trigger-chevron" viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
      </template>

      <button
        v-if="selectedPreset === 'custom'"
        class="icon-button custom-edit-button"
        type="button"
        title="Edit custom viewport"
        aria-label="Edit custom viewport"
        @click="openCustomEditor"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3 11.5-.5 2 2-.5 7.8-7.8-1.5-1.5Z" />
          <path d="m9.9 4.6 1.5 1.5" />
        </svg>
      </button>
    </template>

    <div
      v-else
      class="viewport-custom viewport-custom-inline"
      :class="{ invalid: viewportError }"
      @keydown.esc.prevent="cancelCustomViewport"
    >
      <span class="custom-heading">Custom</span>
      <label class="custom-field">
        <span>W</span>
        <input
          ref="customWidthInput"
          v-model.number="customWidth"
          type="number"
          min="200"
          max="7680"
          step="1"
          aria-label="Custom viewport width"
          :aria-invalid="viewportError ? 'true' : 'false'"
          :title="viewportError ?? undefined"
          @input="viewportError = null"
        />
      </label>
      <label class="custom-field">
        <span>H</span>
        <input
          v-model.number="customHeight"
          type="number"
          min="200"
          max="7680"
          step="1"
          aria-label="Custom viewport height"
          :aria-invalid="viewportError ? 'true' : 'false'"
          :title="viewportError ?? undefined"
          @input="viewportError = null"
        />
      </label>
      <label class="custom-field">
        <span>DPR</span>
        <input
          v-model.number="customDeviceScaleFactor"
          type="number"
          min="0.5"
          max="4"
          step="0.1"
          aria-label="Custom device scale factor"
          :aria-invalid="viewportError ? 'true' : 'false'"
          :title="viewportError ?? undefined"
          @input="viewportError = null"
        />
      </label>
      <button class="custom-apply" type="button" @click="applyCustomViewport">Apply</button>
      <button class="custom-cancel" type="button" @click="cancelCustomViewport">Cancel</button>
      <span v-if="viewportError" class="viewport-error" role="alert">{{ viewportError }}</span>
    </div>
  </div>
</template>

<style scoped>
.pane-nav-row {
  display: flex;
  flex: 1 1 320px;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-inset);
  color: var(--text);
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

.pane-security {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 2px;
  color: var(--danger);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.pane-security svg {
  flex: none;
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pane-security-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.address-form {
  flex: 1 1 120px;
  min-width: 80px;
  -webkit-app-region: no-drag;
}

.address-input {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: center;
  text-overflow: ellipsis;
}

.address-input:hover {
  background: var(--surface-inset);
  color: var(--text);
}

.address-input::placeholder {
  color: var(--text-faint);
}

.address-input:focus {
  border-color: transparent;
  background: var(--surface-inset);
  color: var(--text);
  outline: 2px solid var(--focus);
  outline-offset: -1px;
  text-align: left;
}

.address-input-invalid,
.address-input-invalid:focus {
  background: var(--danger-soft);
  color: var(--danger);
  outline-color: var(--danger);
}

.address-error {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 240px;
  overflow: hidden;
  color: var(--danger);
  font-size: 10.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewport-select {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 184px;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10.5px;
  text-align: left;
}

.viewport-trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewport-trigger-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.viewport-select:hover {
  border-color: var(--border);
  background: var(--surface-raised);
}

.viewport-select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.custom-edit-button {
  flex: none;
  width: 28px;
  height: 28px;
}

.viewport-custom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.viewport-custom-inline {
  position: relative;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border-top: 0;
}

.custom-heading {
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.viewport-custom-inline .custom-field {
  gap: 2px;
}

.viewport-custom-inline.invalid .custom-field input {
  border-color: var(--danger);
}

.viewport-custom-inline .viewport-error {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.custom-field {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-faint);
  font-size: 10.5px;
}

.custom-field input {
  width: 54px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 11px;
}

.custom-field input[aria-label='Custom device scale factor'] {
  width: 46px;
}

.custom-apply,
.custom-cancel {
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--surface-raised);
  color: var(--text);
  font-size: 10.5px;
}

.custom-apply:hover,
.custom-cancel:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
}

.viewport-error {
  flex-basis: 100%;
  color: var(--danger);
  font-size: 10.5px;
  line-height: 1.4;
}

@container (max-width: 480px) {
  .pane-security {
    padding: 0;
  }

  .pane-security-label {
    display: none;
  }
}

@container (max-width: 900px) {
  .viewport-select {
    width: 160px;
  }
}

@container (max-width: 760px) {
  .viewport-select {
    width: 140px;
  }
}

@container (max-width: 640px) {
  .viewport-select {
    width: 112px;
  }
}

@container (max-width: 480px) {
  .viewport-select {
    width: 88px;
  }
}
</style>
