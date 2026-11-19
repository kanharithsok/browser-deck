<script setup lang="ts">
import { computed, ref } from 'vue'
import PaneNavigation from './PaneNavigation.vue'
import type { PaneState } from '../../../shared/ipc'
import type { PaneViewport } from '../../../shared/viewports'

const props = withDefaults(
  defineProps<{
    pane: PaneState
    showCanvasTools?: boolean
  }>(),
  {
    showCanvasTools: false
  }
)

const emit = defineEmits<{
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
  'fit-all': []
  overview: []
}>()

const addressError = ref<string | null>(null)
const statusId = computed(() => `global-pane-status-${props.pane.id}`)
</script>

<template>
  <div class="global-pane-bar">
    <div class="global-pane-context">
      <span
        v-if="pane.isLoading"
        class="spinner"
        aria-hidden="true"
      ></span>
      <span v-else class="status-dot" :class="{ 'status-dot-error': pane.error }" aria-hidden="true"></span>
      <span class="global-pane-title">{{ pane.title }}</span>
      <span class="global-pane-profile">{{ pane.profileLabel }}</span>
    </div>

    <PaneNavigation
      :pane="pane"
      :status-id="statusId"
      @address-error="addressError = $event"
      @set-viewport="emit('set-viewport', $event)"
      @layout-changed="emit('layout-changed')"
    />

    <div v-if="showCanvasTools" class="global-canvas-tools">
      <button
        class="global-canvas-tool"
        type="button"
        title="Fit all panes to view"
        aria-label="Fit all panes to view"
        @click="emit('fit-all')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 6V3h3M10 3h3v3M3 10v3h3M13 10v3h-3" />
        </svg>
      </button>
      <button
        class="global-canvas-tool"
        type="button"
        title="Canvas overview"
        aria-label="Canvas overview"
        @click="emit('overview')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3" width="4.5" height="4.5" rx="0.7" />
          <rect x="9" y="3" width="4.5" height="4.5" rx="0.7" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.7" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="0.7" />
        </svg>
      </button>
    </div>

    <span :id="statusId" class="global-pane-status" role="status" aria-live="polite">
      {{ addressError ?? (pane.error ? 'Load failed' : '') }}
    </span>
  </div>
</template>

<style scoped>
.global-pane-bar {
  position: relative;
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 5px;
  min-height: 34px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  container-type: inline-size;
}

.global-pane-context {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  min-width: 0;
}

.global-pane-title {
  max-width: 150px;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-pane-profile {
  max-width: 90px;
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-pane-profile::before {
  content: '· ';
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

.status-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  opacity: 0.75;
}

.status-dot-error {
  background: var(--danger);
  opacity: 1;
}

.global-canvas-tools {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
}

.global-canvas-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: var(--text-muted);
}

.global-canvas-tool:hover {
  background: var(--surface-inset);
  color: var(--text);
}

.global-canvas-tool svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.global-pane-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@container (max-width: 700px) {
  .global-pane-profile {
    display: none;
  }
}
</style>
