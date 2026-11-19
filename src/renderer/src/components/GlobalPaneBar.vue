<script setup lang="ts">
import { computed, ref } from 'vue'
import PaneNavigation from './PaneNavigation.vue'
import type { PaneState } from '../../../shared/ipc'
import type { PaneViewport } from '../../../shared/viewports'

const props = withDefaults(
  defineProps<{
    pane: PaneState | null
    hasPanes?: boolean
    profilePaneCount?: number
    variant?: 'bar' | 'toolbar'
  }>(),
  {
    hasPanes: true,
    profilePaneCount: 1,
    variant: 'bar'
  }
)

const emit = defineEmits<{
  'set-viewport': [viewport: PaneViewport]
  'layout-changed': []
}>()

const addressError = ref<string | null>(null)
const statusId = computed(() =>
  props.pane ? `global-pane-status-${props.pane.id}` : 'global-pane-status-empty'
)

const profileLabelText = computed(() => {
  if (!props.pane) {
    return ''
  }
  return props.profilePaneCount > 1
    ? `${props.pane.profileLabel} · ${props.profilePaneCount} devices`
    : props.pane.profileLabel
})

const profileTooltip = computed(() => {
  if (!props.pane) {
    return undefined
  }
  return props.profilePaneCount > 1
    ? `Browser profile: ${props.pane.profileLabel} (shared by ${props.profilePaneCount} devices)`
    : `Browser profile: ${props.pane.profileLabel}`
})
</script>

<template>
  <section
    class="global-pane-bar"
    :class="{ 'global-pane-bar-toolbar': variant === 'toolbar' }"
    :aria-label="pane ? 'Active device' : 'No active device'"
  >
    <template v-if="pane">
      <div class="global-pane-context">
        <span
          v-if="pane.isLoading"
          class="spinner"
          aria-hidden="true"
        ></span>
        <span v-else class="status-dot" :class="{ 'status-dot-error': pane.error }" aria-hidden="true"></span>
        <span class="global-pane-title">{{ pane.title }}</span>
        <span class="global-pane-profile" :title="profileTooltip">{{ profileLabelText }}</span>
      </div>

      <PaneNavigation
        :pane="pane"
        :status-id="statusId"
        @address-error="addressError = $event"
        @set-viewport="emit('set-viewport', $event)"
        @layout-changed="emit('layout-changed')"
      />
    </template>

    <div v-else class="global-pane-empty" role="status">
      <span class="global-pane-empty-title">
        {{ hasPanes ? 'No device selected' : 'No devices' }}
      </span>
      <span class="global-pane-empty-hint">
        {{ hasPanes ? 'Click a device to edit its address' : 'Add a device to get started' }}
      </span>
    </div>

    <span v-if="pane" :id="statusId" class="global-pane-status" role="status" aria-live="polite">
      {{ addressError ?? (pane.error ? 'Load failed' : '') }}
    </span>
  </section>
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

.global-pane-bar-toolbar {
  flex: 1 1 auto;
  flex-wrap: nowrap;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.global-pane-bar-toolbar :deep(.pane-nav-row) {
  flex: 1 1 auto;
  justify-content: center;
}

.global-pane-bar-toolbar :deep(.address-form) {
  flex: 0 1 400px;
  max-width: 400px;
  min-width: 120px;
}

.global-pane-bar-toolbar :deep(.address-input) {
  text-align: center;
}

.global-pane-bar-toolbar :deep(.address-input:focus) {
  text-align: left;
}

.global-pane-bar-toolbar .global-pane-context {
  position: absolute;
  top: 50%;
  left: 0;
  max-width: 220px;
  transform: translateY(-50%);
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
  max-width: 140px;
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-pane-profile::before {
  content: '· ';
}

.global-pane-empty {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.global-pane-empty-title {
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
}

.global-pane-empty-hint {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

@container (max-width: 1050px) {
  .global-pane-bar-toolbar .global-pane-context {
    display: none;
  }
}

@container (max-width: 700px) {
  .global-pane-profile {
    display: none;
  }
}
</style>
