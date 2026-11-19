<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PaneState, ScriptResult } from '../../../shared/ipc'
import {
  VIEWPORT_CATEGORY_LABELS,
  parsePaneViewport,
  viewportFromPreset,
  viewportPresetsInCategory,
  type PaneViewport,
  type ViewportPresetId
} from '../../../shared/viewports'

const VIEWPORT_GROUPS = (['phone', 'tablet', 'desktop'] as const).map((category) => ({
  category,
  label: VIEWPORT_CATEGORY_LABELS[category],
  presets: viewportPresetsInCategory(category)
}))

const props = defineProps<{
  pane: PaneState
  statusId: string
}>()

const emit = defineEmits<{
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
  'address-error': [message: string | null]
}>()

const addressInput = ref<HTMLInputElement | null>(null)
const address = ref(displayAddress(props.pane.url))
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

function onPresetChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) {
    return
  }

  const preset = target.value as ViewportPresetId
  const wasOpen = customOpen.value
  selectedPreset.value = preset
  viewportError.value = null

  if (preset === 'custom') {
    customOpen.value = true
    if (!wasOpen) {
      const viewport = props.pane.viewport
      if (viewport.preset !== 'responsive' && viewport.preset !== 'custom') {
        customWidth.value = viewport.width
        customHeight.value = viewport.height
        customDeviceScaleFactor.value = viewport.deviceScaleFactor
      }
      emit('layout-changed')
    }
    return
  }

  customOpen.value = false
  if (wasOpen) {
    emit('layout-changed')
  }
  emit('set-viewport', viewportFromPreset(preset))
}

function openCustomEditor(): void {
  const viewport = props.pane.viewport
  if (viewport.preset === 'custom') {
    customWidth.value = viewport.width
    customHeight.value = viewport.height
    customDeviceScaleFactor.value = viewport.deviceScaleFactor
  }
  viewportError.value = null
  customOpen.value = true
  emit('layout-changed')
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
    result = await window.paneflow.navigate(props.pane.id, value)
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
</script>

<template>
  <div class="pane-nav-row" :class="{ 'pane-nav-row-editing': customOpen }">
    <template v-if="!customOpen">
      <button
        class="icon-button nav-button"
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
        class="icon-button nav-button"
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
        class="icon-button nav-button"
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
          :aria-label="`Address for device ${pane.title}`"
          :aria-invalid="addressError ? 'true' : 'false'"
          :aria-describedby="addressError ? statusId : undefined"
          @input="setAddressError(null)"
          @focus="editing = true"
          @blur="handleBlur"
          @keydown.esc.prevent="resetAddress"
        />
      </form>

      <select
        class="viewport-select"
        :value="selectedPreset"
        :aria-label="`Viewport preset for device ${pane.title}`"
        @change="onPresetChange"
      >
        <option value="responsive">Responsive</option>
        <optgroup v-for="group in VIEWPORT_GROUPS" :key="group.category" :label="group.label">
          <option v-for="preset in group.presets" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </optgroup>
        <option value="custom">Custom…</option>
      </select>

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
  gap: 2px;
  min-width: 0;
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

.nav-button {
  width: 24px;
  height: 24px;
}

.address-form {
  flex: 1 1 120px;
  min-width: 80px;
  margin-left: 3px;
}

.address-input {
  width: 100%;
  height: 24px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
}

.address-input:hover {
  background: var(--surface-inset);
}

.address-input::placeholder {
  color: var(--text-faint);
}

.address-input:focus {
  border-color: var(--border);
  background: var(--surface-raised);
  color: var(--text);
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.address-input-invalid,
.address-input-invalid:focus {
  border-color: var(--danger);
  outline-color: var(--danger);
}

.viewport-select {
  flex: none;
  width: 86px;
  height: 24px;
  margin-left: 3px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
}

.viewport-select:hover {
  background: var(--surface-inset);
}

.viewport-select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.custom-edit-button {
  flex: none;
  width: 24px;
  height: 24px;
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

@container (max-width: 320px) {
  .viewport-select {
    width: 78px;
  }
}
</style>
