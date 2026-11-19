<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppMenuModel } from '../menu'
import MenuIcon from './MenuIcon.vue'

const props = withDefaults(
  defineProps<{
    model: AppMenuModel
    anchor: { x: number; y: number; align: 'start' | 'end' | 'center' }
    placement?: 'below' | 'above'
    width?: number
  }>(),
  {
    placement: 'below',
    width: undefined
  }
)

const emit = defineEmits<{
  select: [id: string]
  close: []
  bounds: [bounds: { x: number; y: number; width: number; height: number }]
}>()

const panel = ref<HTMLElement | null>(null)
const positioned = ref(false)
const left = ref(0)
const top = ref(0)
const MARGIN = 8

function enabledItems(): HTMLButtonElement[] {
  return Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)') ?? []
  )
}

function focusMenu(): void {
  panel.value?.focus()
}

function focusOnHover(event: PointerEvent): void {
  const target = event.currentTarget
  if (target instanceof HTMLElement) {
    target.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') {
    event.preventDefault()
    emit('close')
    return
  }

  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  ) {
    return
  }

  const items = enabledItems()
  if (items.length === 0) {
    return
  }
  event.preventDefault()
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  let nextIndex = 0
  if (event.key === 'End') {
    nextIndex = items.length - 1
  } else if (event.key === 'ArrowUp') {
    nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
  } else if (event.key === 'ArrowDown') {
    nextIndex = currentIndex < 0 || currentIndex >= items.length - 1 ? 0 : currentIndex + 1
  }
  items[nextIndex]?.focus()
}

function position(): void {
  const element = panel.value
  if (!element) {
    return
  }

  const width = element.offsetWidth
  const height = element.offsetHeight
  let nextLeft =
    props.anchor.align === 'end'
      ? props.anchor.x - width
      : props.anchor.align === 'center'
        ? props.anchor.x - width / 2
        : props.anchor.x
  let nextTop = props.placement === 'above' ? props.anchor.y - height : props.anchor.y
  const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN)
  nextLeft = Math.min(Math.max(MARGIN, nextLeft), maxLeft)
  if (nextTop + height > window.innerHeight - MARGIN) {
    nextTop = Math.max(MARGIN, window.innerHeight - height - MARGIN)
  }
  if (nextTop < MARGIN) {
    nextTop = MARGIN
  }
  left.value = Math.round(nextLeft)
  top.value = Math.round(nextTop)
  positioned.value = true
  emit('bounds', { x: left.value, y: top.value, width, height })
  requestAnimationFrame(focusMenu)
}

function onWindowResize(): void {
  emit('close')
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return
  }
  event.preventDefault()
  emit('close')
}

onMounted(async () => {
  await nextTick()
  position()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div class="app-menu-layer" @pointerdown.self="emit('close')">
    <section
      ref="panel"
      class="app-menu"
      role="menu"
      :aria-label="model.label"
      tabindex="-1"
      :style="{
        left: `${left}px`,
        top: `${top}px`,
        width: width ? `${width}px` : undefined,
        visibility: positioned ? 'visible' : 'hidden'
      }"
      @keydown="onKeydown"
    >
      <template v-for="(section, sectionIndex) in model.sections" :key="sectionIndex">
        <div v-if="section.label" class="app-menu-section" role="presentation">
          {{ section.label }}
        </div>
        <template v-for="item in section.items" :key="item.id">
          <div v-if="item.separatorBefore" class="app-menu-separator" role="separator"></div>
          <button
            class="app-menu-item"
            type="button"
            data-menu-item
            :role="
              item.kind === 'radio'
                ? 'menuitemradio'
                : item.kind === 'checkbox'
                  ? 'menuitemcheckbox'
                  : 'menuitem'
            "
            :aria-checked="item.kind ? item.checked === true : undefined"
            :disabled="item.disabled"
            @click="emit('select', item.id)"
            @pointerenter="focusOnHover"
          >
            <MenuIcon v-if="item.icon" :icon="item.icon" class="app-menu-icon" />
            <span class="app-menu-label">{{ item.label }}</span>
            <span v-if="item.checked" class="app-menu-check" aria-hidden="true">✓</span>
            <span v-else-if="item.detail" class="app-menu-detail">{{ item.detail }}</span>
          </button>
        </template>
      </template>
    </section>
  </div>
</template>

<style scoped>
.app-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.app-menu {
  position: fixed;
  width: min(304px, calc(100vw - 16px));
  max-height: min(70vh, 460px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.12);
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  outline: none;
}

:root[data-theme='dark'] .app-menu {
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.46),
    0 2px 10px rgba(0, 0, 0, 0.36);
}

.app-menu-section {
  padding: 8px 8px 4px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.3;
}

.app-menu-section:first-child {
  padding-top: 4px;
}

.app-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}

.app-menu-item:hover:not(:disabled),
.app-menu-item:focus-visible {
  background: var(--surface-inset);
  outline: none;
}

.app-menu-item:focus-visible {
  box-shadow: inset 0 0 0 1px var(--focus);
}

.app-menu-item:disabled {
  color: var(--text-faint);
  cursor: default;
  opacity: 0.55;
}

.app-menu-icon {
  color: var(--text-muted);
}

.app-menu-item:hover:not(:disabled) .app-menu-icon,
.app-menu-item:focus-visible .app-menu-icon {
  color: var(--text);
}

.app-menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-menu-detail {
  flex: none;
  color: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.app-menu-check {
  flex: none;
  color: var(--accent);
  font-size: 13px;
  line-height: 1;
}

.app-menu-separator {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
}

@media (prefers-reduced-motion: reduce) {
  .app-menu {
    scroll-behavior: auto;
  }
}
</style>
