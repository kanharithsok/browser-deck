<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PaneState, ScriptResult } from '../../../shared/ipc'

const props = withDefaults(
  defineProps<{
    pane: PaneState
    freeform?: boolean
    maximized?: boolean
    suspended?: boolean
  }>(),
  {
    freeform: false,
    maximized: false,
    suspended: false
  }
)

const emit = defineEmits<{
  close: []
  menu: [position: { x: number; y: number }]
  'toggle-maximize': []
}>()

const addressInput = ref<HTMLInputElement | null>(null)
const address = ref(displayAddress(props.pane.url))
const addressError = ref<string | null>(null)
const editing = ref(false)
const statusId = `pane-status-${props.pane.id}`

function displayAddress(url: string): string {
  return url === 'about:blank' ? '' : url
}

watch(
  () => props.pane.url,
  (url) => {
    if (!editing.value) {
      address.value = displayAddress(url)
    }
  }
)

function resetAddress(): void {
  address.value = displayAddress(props.pane.url)
  addressError.value = null
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
    addressError.value = 'Enter an address.'
    return
  }

  let result: ScriptResult
  try {
    result = await window.paneflow.navigate(props.pane.id, value)
  } catch {
    addressError.value = 'Could not navigate to that address.'
    return
  }

  if (!result.ok) {
    addressError.value = result.error
    return
  }

  addressError.value = null
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

function openMenu(event: MouseEvent): void {
  const button = event.currentTarget
  if (!(button instanceof HTMLElement)) {
    return
  }
  const rect = button.getBoundingClientRect()
  emit('menu', { x: rect.right - 2, y: rect.bottom + 2 })
}

function requestClose(): void {
  emit('close')
}
</script>

<template>
  <article
    class="pane-card"
    :class="{ 'pane-card-freeform': freeform }"
    :data-pane-id="pane.id"
    :aria-label="`${pane.title} pane`"
  >
    <header class="pane-header">
      <div class="pane-title-row">
        <span v-if="pane.isLoading" class="spinner" aria-hidden="true"></span>
        <span v-else class="status-dot" :class="{ 'status-dot-error': pane.error }" aria-hidden="true"></span>

        <span class="pane-title" :title="pane.title">{{ pane.title }}</span>
        <span class="pane-profile" :title="`Browser profile: ${pane.profileLabel}`">
          {{ pane.profileLabel }}
        </span>

        <span
          :id="statusId"
          class="pane-status"
          role="status"
          aria-live="polite"
          :title="addressError ?? pane.error ?? undefined"
        >
          <template v-if="pane.isLoading">Loading</template>
          <template v-else-if="addressError">{{ addressError }}</template>
          <template v-else-if="pane.error">Load failed</template>
        </span>

        <span class="pane-spacer"></span>

        <button
          class="icon-button"
          type="button"
          :title="maximized ? 'Restore pane' : 'Maximize pane'"
          :aria-label="maximized ? 'Restore pane' : 'Maximize pane'"
          @click="emit('toggle-maximize')"
        >
          <svg v-if="maximized" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3H3v3M10 3h3v3M6 13H3v-3M10 13h3v-3" />
          </svg>
          <svg v-else viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 6V3h3M10 3h3v3M3 10v3h3M13 10v3h-3" />
          </svg>
        </button>
        <button
          class="icon-button"
          type="button"
          title="Pane actions"
          aria-label="Pane actions"
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
          title="Close pane"
          aria-label="Close pane"
          @click="requestClose"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div class="pane-nav-row">
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
          title="Reload pane"
          aria-label="Reload pane"
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
            :aria-label="`Address for ${pane.title}`"
            :aria-invalid="addressError ? 'true' : 'false'"
            :aria-describedby="addressError ? statusId : undefined"
            @input="addressError = null"
            @focus="editing = true"
            @blur="handleBlur"
            @keydown.esc.prevent="resetAddress"
          />
        </form>
      </div>
    </header>

    <div class="pane-body">
      <div class="pane-content" :data-pane-content="pane.id">
        <div v-if="pane.error" class="pane-message" role="alert">
          <p class="message-title">This page could not load</p>
          <p class="message-detail">{{ pane.error }}</p>
          <button class="text-button" type="button" @click="reload">Try again</button>
        </div>
        <div v-else-if="pane.url === 'about:blank' && !pane.isLoading" class="pane-message">
          <p class="message-title">No page loaded</p>
          <p class="message-detail">Enter an address above to open a site in this pane.</p>
        </div>
        <div v-else-if="suspended && !pane.isLoading" class="pane-message">
          <p class="message-title">Pane hidden while off-screen</p>
          <p class="message-detail">Scroll this pane fully into view to interact with the site.</p>
        </div>
        <div v-else-if="pane.isLoading" class="pane-message" aria-hidden="true">
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
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  overflow: hidden;
  container-type: inline-size;
}

.pane-card-freeform .pane-body {
  padding: 6px;
}

.pane-header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 6px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.pane-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 24px;
  padding: 0 2px;
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
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-profile {
  flex: none;
  max-width: 120px;
  overflow: hidden;
  color: var(--text-faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-profile::before {
  content: '· ';
}

.pane-status {
  flex: none;
  max-width: 160px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-status:empty {
  display: none;
}

.pane-spacer {
  flex: 1;
}

.icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 5px;
  color: var(--text-muted);
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-inset);
  color: var(--text);
}

.icon-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pane-nav-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.nav-button {
  width: 24px;
  height: 24px;
}

.address-form {
  flex: 1;
  min-width: 0;
  margin-left: 4px;
}

.address-input {
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 11.5px;
  text-overflow: ellipsis;
}

.address-input::placeholder {
  color: var(--text-faint);
}

.address-input:focus {
  border-color: var(--accent);
  background: var(--surface-raised);
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.address-input-invalid,
.address-input-invalid:focus {
  border-color: var(--danger);
  outline-color: var(--danger);
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
  border-radius: 0 0 8px 8px;
  background: var(--pane-canvas);
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
  .pane-profile {
    display: none;
  }
}
</style>
