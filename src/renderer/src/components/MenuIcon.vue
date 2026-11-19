<script setup lang="ts">
import type { AppMenuIcon } from '../menu'

defineProps<{
  icon: AppMenuIcon
}>()
</script>

<template>
  <svg class="menu-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path v-if="icon === 'add'" d="M8 3v10M3 8h10" />
    <template v-else-if="icon === 'responsive'">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" />
      <path d="M5.5 6h2M5.5 8.5h4" />
    </template>
    <path
      v-else-if="icon === 'fit'"
      d="M3 6V3h3M10 3h3v3M3 10v3h3M13 10v3h-3"
    />
    <template v-else-if="icon === 'reset'">
      <path d="M12.8 6.2A5 5 0 1 0 13 8" />
      <path d="M13 3.2v3.2H9.8" />
    </template>
    <path
      v-else-if="icon === 'hand'"
      d="M8 2.2v4.1M3.8 4.8l2.9 2.9M12.2 4.8 9.3 7.7M2.2 10.2l3.4 3.4h4.8l3.4-3.4"
    />
    <template v-else-if="icon === 'phone'">
      <rect x="4.5" y="1.8" width="7" height="12.4" rx="1.5" />
      <path d="M7 12.2h2" />
    </template>
    <template v-else-if="icon === 'tablet'">
      <rect x="3.2" y="2.2" width="9.6" height="11.6" rx="1.3" />
      <path d="M7 11.8h2" />
    </template>
    <template v-else-if="icon === 'desktop'">
      <rect x="2.2" y="3" width="11.6" height="8" rx="1.2" />
      <path d="M5.5 13h5M8 11v2" />
    </template>
    <template v-else-if="icon === 'profiles'">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13c.4-2.2 2.2-3.5 4.5-3.5s4.1 1.3 4.5 3.5" />
    </template>
    <template v-else-if="icon === 'workspaces'">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <path d="M6 6h7v7H6z" />
    </template>
    <template v-else-if="icon === 'system'">
      <rect x="2.2" y="3" width="11.6" height="8" rx="1.2" />
      <path d="M5.5 13h5M8 11v2" />
    </template>
    <template v-else-if="icon === 'sun'">
      <circle cx="8" cy="8" r="3.1" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2"
      />
    </template>
    <path
      v-else-if="icon === 'moon'"
      d="M13.2 9.7A5.5 5.5 0 0 1 6.3 2.8 5.5 5.5 0 1 0 13.2 9.7Z"
    />
  </svg>
</template>

<style scoped>
.menu-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
