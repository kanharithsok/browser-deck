<script setup lang="ts">
import { computed, ref } from 'vue'
import PaneNavigation from './PaneNavigation.vue'
import type { PaneState } from '../../../shared/ipc'
import type { PaneViewport } from '../../../shared/viewports'

const props = defineProps<{
  pane: PaneState
}>()

const emit = defineEmits<{
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
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
