<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppMenu from './components/AppMenu.vue'
import PaneCard from './components/PaneCard.vue'
import type { AppMenuIcon, AppMenuModel } from './menu'
import { MAX_BULK_BROWSERS, parseBulkUrlInput } from '../../shared/bulk'
import {
  CANVAS_GAP,
  CANVAS_NEAR_GAP,
  CANVAS_NEAR_THRESHOLD,
  CANVAS_ORIGIN,
  CANVAS_PROXIMITY_THRESHOLD,
  CANVAS_SNAP_THRESHOLD,
  arrangeCanvasFrames,
  canvasPaneIdsInRect,
  clampCanvasPaneTop,
  defaultCanvasPositions,
  canvasFrameSize,
  duplicateCanvasPosition,
  snapCanvasRect,
  type CanvasArrangeMode,
  type CanvasPosition
} from '../../shared/canvas'
import {
  CANVAS_MINIMAP_MARGIN,
  canvasMinimapSize,
  type CanvasMinimapAction,
  type CanvasMinimapState
} from '../../shared/minimap'
import type {
  PaneCommand,
  PaneNotice,
  PaneState,
  ScriptResult,
  ShellState
} from '../../shared/ipc'
import {
  RESPONSIVE_VIEWPORT,
  VIEWPORT_CATEGORY_LABELS,
  VIEWPORT_PRESETS,
  findViewportPreset,
  isViewportPresetId,
  parsePaneViewport,
  viewportContentSize,
  viewportFromPreset,
  type PaneViewport,
  type ViewportPresetId
} from '../../shared/viewports'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_BAR_HEIGHT,
  CANVAS_ZOOM_BAR_WIDTH,
  CANVAS_ZOOM_MARGIN,
  CANVAS_ZOOM_MENU_WIDTH,
  CANVAS_ZOOM_PRESETS,
  CANVAS_ZOOM_STEP,
  type CanvasZoomAction
} from '../../shared/zoom'
import type {
  ThemePreference,
  WorkspaceLayout,
  WorkspaceSummary
} from '../../shared/workspace'
import {
  DEFAULT_GRID_COLUMNS,
  DEFAULT_MIN_PANE_HEIGHT,
  DEFAULT_MIN_PANE_WIDTH,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  bringToFront,
  isRectFullyVisible,
  layoutGrid,
  moveRect,
  normalizedToRect,
  rectToNormalized,
  reorderPaneIds,
  resizeRect,
  sendToBack,
  snapRect,
  type GridLayout,
  type NormalizedRect,
  type Rect,
  type ResizeHandle,
  type Size,
  type SnapGuides
} from '../../shared/layout'

type LayoutMode = 'grid' | 'freeform' | 'canvas'

const CANVAS_FIT_PADDING = 24
const CANVAS_BOTTOM_BAR_GAP = 12
const CANVAS_BOTTOM_BAR_INSET =
  CANVAS_ZOOM_MARGIN + CANVAS_ZOOM_BAR_HEIGHT + CANVAS_BOTTOM_BAR_GAP

interface CanvasViewportRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

function canvasViewportRect(): CanvasViewportRect {
  const left = CANVAS_FIT_PADDING
  const top = CANVAS_FIT_PADDING
  const right = Math.max(left + 1, workspaceSize.value.width - CANVAS_FIT_PADDING)
  const bottom = Math.max(top + 1, workspaceSize.value.height - CANVAS_BOTTOM_BAR_INSET)
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  }
}

interface CanvasDragState {
  startX: number
  startY: number
  base: CanvasPosition
  button: number
  moved: boolean
  empty: boolean
}

interface CanvasPaneDragState {
  paneId: string
  startX: number
  startY: number
  base: CanvasPosition
  moved: boolean
}

interface PendingDuplicatePlacement {
  sourcePaneId: string
  position: CanvasPosition
}

interface MarqueeDragState {
  startX: number
  startY: number
  anchorPaneId: string | null
  moved: boolean
}

const panes = ref<PaneState[]>([])
const paneOrder = ref<string[]>([])
const activePaneId = ref<string | null>(null)
const paneSelectionCleared = ref(false)
const paneRenameRequests = ref<Record<string, number>>({})
const customViewportRequests = ref<Record<string, number>>({})
const layoutMode = ref<LayoutMode>('canvas')
const freeformGeometries = ref<Record<string, NormalizedRect>>({})
const freeformOrder = ref<string[]>([])
const canvasPositions = ref<Record<string, CanvasPosition>>({})
const canvasPan = ref<CanvasPosition>({ x: 0, y: 0 })
const canvasZoom = ref(1)
const canvasHandMode = ref(false)
const spaceHandMode = ref(false)
const isCanvasPanning = ref(false)
const isCanvasPaneDragging = ref(false)
const canvasDrag = ref<CanvasDragState | null>(null)
const canvasPaneDrag = ref<CanvasPaneDragState | null>(null)
const selectionToolActive = ref(false)
const temporarySelectMode = ref(false)
const selectedPaneIds = ref<ReadonlySet<string>>(new Set())
const marqueeRect = ref<Rect | null>(null)
const isMarqueeSelecting = ref(false)
const paneSnapshots = ref<Record<string, string>>({})
const paneNotices = ref<Record<string, string>>({})
const usesMacTitlebar = navigator.platform.startsWith('Mac')
const workspaceEl = ref<HTMLElement | null>(null)
const workspaceSize = ref<Size>({ width: 0, height: 0 })
const gridColumns = ref(DEFAULT_GRID_COLUMNS)
const suspendedPaneIds = ref<ReadonlySet<string>>(new Set())
const actionError = ref<string | null>(null)
const layoutError = ref<string | null>(null)
const addingPane = ref(false)
const appMenuMode = ref<
  | 'add'
  | 'canvas'
  | 'zoom'
  | 'appearance'
  | 'arrange'
  | 'pane'
  | 'viewport'
  | 'clear-site-data'
  | 'workspace'
  | 'selection'
  | null
>(null)
const paneMenuPaneId = ref<string | null>(null)
const devicePaletteOpen = ref(false)
const devicePaletteQuery = ref('')
const devicePaletteIndex = ref(0)
const devicePaletteInput = ref<HTMLInputElement | null>(null)
const DEVICE_PALETTE_LIST_ID = 'device-palette-list'
const appMenuAnchor = ref<{
  x: number
  y: number
  align: 'start' | 'end' | 'center'
}>({
  x: 0,
  y: 0,
  align: 'start'
})
const appMenuBounds = ref<Rect | null>(null)
let appMenuReturnFocus: HTMLElement | null = null
const guides = ref<SnapGuides>({ vertical: [], horizontal: [] })
const proximityGuides = ref<SnapGuides>({ vertical: [], horizontal: [] })
const profileDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const workspacesOpen = ref(false)
const workspaces = ref<WorkspaceSummary[]>([])
const workspacesLoading = ref(false)
const workspaceError = ref<string | null>(null)
const workspaceNotice = ref<string | null>(null)
const workspaceBusy = ref(false)
const workspaceDeleteId = ref<string | null>(null)
const renamingWorkspaceId = ref<string | null>(null)
const workspaceRenameDraft = ref('')
const newWorkspaceName = ref('')
const workspaceMenuId = ref<string | null>(null)
const workspacesDialogEl = ref<HTMLElement | null>(null)
const currentWorkspaceId = ref<string | null>(null)
const themePreference = ref<ThemePreference>('system')
const resolvedTheme = ref<'light' | 'dark'>('light')
const bulkDialogOpen = ref(false)
const bulkDialogEl = ref<HTMLElement | null>(null)
const bulkTextarea = ref<HTMLTextAreaElement | null>(null)
const bulkUrlsText = ref('')
const bulkError = ref<string | null>(null)
const bulkBusy = ref(false)
const bulkViewportPreset = ref<ViewportPresetId>('responsive')
const bulkCustomViewport = ref<PaneViewport | null>(null)
let bulkReturnFocus: HTMLElement | null = null
const LAST_BULK_VIEWPORT_KEY = 'browserdeck.lastBulkViewport'

function readLastBulkViewport(): PaneViewport | null {
  try {
    const raw = localStorage.getItem(LAST_BULK_VIEWPORT_KEY)
    if (!raw) {
      return null
    }
    const parsed = parsePaneViewport(JSON.parse(raw))
    return parsed.ok ? parsed.viewport : null
  } catch {
    return null
  }
}

function persistBulkViewport(viewport: PaneViewport): void {
  try {
    localStorage.setItem(LAST_BULK_VIEWPORT_KEY, JSON.stringify(viewport))
  } catch {
    // A blocked storage API should not prevent opening browsers.
  }
}

const bulkParseResult = computed(() => parseBulkUrlInput(bulkUrlsText.value))
const bulkUrlCount = computed(() =>
  bulkParseResult.value.ok ? bulkParseResult.value.urls.length : 0
)
const bulkSelectedViewport = computed<PaneViewport>(() =>
  bulkViewportPreset.value === 'custom' && bulkCustomViewport.value
    ? bulkCustomViewport.value
    : viewportFromPreset(bulkViewportPreset.value)
)

const bulkSubmitLabel = computed(() => {
  if (bulkBusy.value) {
    return 'Opening…'
  }
  const count = bulkUrlCount.value
  return count === 0 ? 'Open browsers' : `Open ${count} ${count === 1 ? 'browser' : 'browsers'}`
})


interface DragState {
  kind: 'reorder' | 'move' | 'resize'
  paneId: string
  startX: number
  startY: number
  startRect?: Rect
  handle?: ResizeHandle
}

const dragState = ref<DragState | null>(null)
const dropTargetId = ref<string | null>(null)
const isDragging = ref(false)

const paneNoticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const PANE_NOTICE_DURATION = 6000

let disposeStateListener: (() => void) | null = null
let disposeMinimapActionListener: (() => void) | null = null
let disposeZoomActionListener: (() => void) | null = null
let disposeMeasureListener: (() => void) | null = null
let disposeCommandListener: (() => void) | null = null
let disposeFocusListener: (() => void) | null = null
let disposeNoticeListener: (() => void) | null = null
let disposeRenameListener: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let measureFrame = 0
let focusManagementEnabled = false
let suppressPaneFocusUntil = 0
let layoutPersistenceReady = false
let layoutRestored = false
let pendingDuplicatePlacement: PendingDuplicatePlacement | null = null
let marqueeDrag: MarqueeDragState | null = null
let lastSavedLayoutKey = ''
let canvasViewReady = false
let canvasViewSaveTimer: ReturnType<typeof setTimeout> | null = null
const CANVAS_VIEW_SAVE_DELAY = 150

const paneCountLabel = computed(() => {
  const count = panes.value.length
  return `${count} ${count === 1 ? 'browser' : 'browsers'}`
})

const orderedPanes = computed(() => {
  const byId = new Map(panes.value.map((pane) => [pane.id, pane]))
  return paneOrder.value
    .map((paneId) => byId.get(paneId))
    .filter((pane): pane is PaneState => pane !== undefined)
})

const activePane = computed(
  () => orderedPanes.value.find((pane) => pane.id === activePaneId.value) ?? null
)

const canvasHandActive = computed(() => canvasHandMode.value || spaceHandMode.value)
const selectionModeActive = computed(
  () => (selectionToolActive.value || temporarySelectMode.value) && !canvasHandActive.value
)

const defaultCanvasLayout = computed(() => defaultCanvasPositions(orderedPanes.value))

const canvasFrames = computed(() => {
  const frames = new Map<string, CanvasPosition & Size>()
  for (const pane of orderedPanes.value) {
    const position = canvasPositions.value[pane.id] ?? defaultCanvasLayout.value[pane.id]
    if (!position) {
      continue
    }
    const size = canvasFrameSize(pane.viewport)
    frames.set(pane.id, {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height
    })
  }
  return frames
})

const canvasWorkspaceStyle = computed(() =>
  layoutMode.value === 'canvas'
    ? { backgroundPosition: `${canvasPan.value.x}px ${canvasPan.value.y}px` }
    : undefined
)

const marqueeStyle = computed(() => {
  const rect = marqueeRect.value
  return rect
    ? {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      }
    : undefined
})

const canvasMinimapViewport = computed(() => {
  const zoom = canvasZoom.value
  if (zoom <= 0) {
    return null
  }
  return {
    x: -canvasPan.value.x / zoom,
    y: -canvasPan.value.y / zoom,
    width: workspaceSize.value.width / zoom,
    height: workspaceSize.value.height / zoom
  }
})

const canvasMinimapState = computed<CanvasMinimapState>(() => ({
  theme: resolvedTheme.value,
  zoom: canvasZoom.value,
  panes: orderedPanes.value.flatMap((pane) => {
    const frame = canvasFrames.value.get(pane.id)
    return frame
      ? [
          {
            id: pane.id,
            title: pane.title,
            active: activePaneId.value === pane.id,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height
          }
        ]
      : []
  }),
  viewport: canvasMinimapViewport.value ?? {
    x: 0,
    y: 0,
    width: Math.max(1, workspaceSize.value.width),
    height: Math.max(1, workspaceSize.value.height)
  }
}))

interface DevicePaletteResult {
  pane: PaneState
  title: string
  detail: string
  viewport: string
  search: string
}

function paneHostname(url: string): string {
  try {
    return new URL(url).hostname || 'about:blank'
  } catch {
    return 'about:blank'
  }
}

function devicePaletteViewportLabel(viewport: PaneViewport): string {
  if (viewport.preset === 'responsive') {
    return 'Responsive'
  }
  const size = viewportContentSize(viewport)
  return `${size.width} × ${size.height}`
}

function devicePaletteViewportSearch(viewport: PaneViewport): string {
  if (viewport.preset === 'responsive') {
    return 'Responsive'
  }
  const preset = findViewportPreset(viewport.preset)
  const size = viewportContentSize(viewport)
  return `${preset ? preset.label : 'Custom'} ${size.width} × ${size.height}`
}

interface HighlightSegment {
  text: string
  match: boolean
}

function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return [{ text, match: false }]
  }
  const haystack = text.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) {
      break
    }
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false })
    }
    segments.push({ text: text.slice(index, index + needle.length), match: true })
    cursor = index + needle.length
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }
  return segments.length > 0 ? segments : [{ text, match: false }]
}

const devicePaletteResults = computed<DevicePaletteResult[]>(() => {
  const query = devicePaletteQuery.value.trim().toLowerCase()
  return orderedPanes.value
    .map((pane) => {
      const hostname = paneHostname(pane.url)
      const viewport = devicePaletteViewportLabel(pane.viewport)
      const detail = hostname
      return {
        pane,
        title: pane.title,
        detail,
        viewport,
        search: `${pane.title} ${detail} ${devicePaletteViewportSearch(pane.viewport)}`.toLowerCase()
      }
    })
    .filter((result) => !query || result.search.includes(query))
    .sort((left, right) => {
      const activeDelta =
        Number(right.pane.id === activePaneId.value) -
        Number(left.pane.id === activePaneId.value)
      return activeDelta !== 0 ? activeDelta : left.title.localeCompare(right.title)
    })
})

const devicePaletteSelected = computed(
  () => devicePaletteResults.value[devicePaletteIndex.value] ?? null
)

const devicePaletteSelectedId = computed(() =>
  devicePaletteSelected.value
    ? `device-palette-option-${devicePaletteIndex.value}`
    : undefined
)

const paneLayoutKey = computed(() => orderedPanes.value.map((pane) => pane.id).join('|'))
const errorMessage = computed(() => actionError.value ?? layoutError.value)

const PRESET_CATEGORIES = (['phone', 'tablet', 'desktop'] as const).map((category) => ({
  category,
  label: VIEWPORT_CATEGORY_LABELS[category],
  presets: VIEWPORT_PRESETS.filter((preset) => preset.category === category)
}))

function presetIcon(
  category: (typeof PRESET_CATEGORIES)[number]['category']
): AppMenuIcon {
  return category === 'phone' ? 'phone' : category === 'tablet' ? 'tablet' : 'desktop'
}

function presetLabel(preset: (typeof VIEWPORT_PRESETS)[number]): string {
  return preset.label.split(' — ')[0] ?? preset.label
}

const addPaneMenuModel = computed<AppMenuModel>(() => ({
  label: 'Add browser',
  sections: [
    {
      label: 'Start with viewport',
      items: [
        {
          id: 'preset:responsive',
          label: 'Responsive',
          icon: 'responsive',
          detail: 'Full size'
        }
      ]
    },
    ...PRESET_CATEGORIES.map(({ category, label, presets }) => ({
      label,
      items: presets.map((preset) => ({
        id: `preset:${preset.id}`,
        label: presetLabel(preset),
        icon: presetIcon(category),
        detail: `${preset.width} × ${preset.height}`
      }))
    })),
    {
      items: [
        {
          id: 'bulk:open',
          label: 'Open multiple browsers…',
          icon: 'add',
          separatorBefore: true,
          detail: 'URLs'
        }
      ]
    }
  ]
}))

const viewportMenuPane = computed(
  () => panes.value.find((pane) => pane.id === paneMenuPaneId.value) ?? activePane.value
)

const viewportMenuModel = computed<AppMenuModel>(() => {
  const pane = viewportMenuPane.value
  const selected = pane?.viewport.preset
  return {
    label: 'Viewport preset',
    sections: [
      {
        items: [
          {
            id: 'viewport:responsive',
            label: 'Responsive',
            icon: 'responsive',
            detail: 'Full size',
            kind: 'radio',
            checked: selected === 'responsive'
          }
        ]
      },
      ...PRESET_CATEGORIES.map(({ category, label, presets }) => ({
        label,
        items: presets.map((preset) => ({
          id: `viewport:${preset.id}`,
          label: presetLabel(preset),
          icon: presetIcon(category),
          detail: `${preset.width} × ${preset.height}`,
          kind: 'radio' as const,
          checked: selected === preset.id
        }))
      })),
      {
        items: [
          {
            id: 'viewport:custom',
            label: 'Custom…',
            kind: 'radio',
            checked: selected === 'custom',
            separatorBefore: true,
            detail:
              selected === 'custom' && pane
                ? `${pane.viewport.width} × ${pane.viewport.height}`
                : undefined
          }
        ]
      }
    ]
  }
})

const zoomMenuModel = computed<AppMenuModel>(() => ({
  label: 'Zoom',
  sections: [
    {
      items: CANVAS_ZOOM_PRESETS.map((zoom) => ({
        id: `zoom:${zoom}`,
        label: `${Math.round(zoom * 100)}%`,
        kind: 'radio' as const,
        checked: Math.abs(canvasZoom.value - zoom) < 0.001
      }))
    },
    {
      items: [
        {
          id: 'zoom:fit',
          label: 'Fit all',
          icon: 'fit',
          separatorBefore: true,
          disabled: panes.value.length === 0
        },
        {
          id: 'zoom:reset',
          label: 'Reset (100%)',
          icon: 'reset'
        }
      ]
    }
  ]
}))

const themeMenuItems = computed(() => [
  {
    id: 'theme:system',
    label: 'System',
    icon: 'system' as const,
    kind: 'radio' as const,
    checked: themePreference.value === 'system'
  },
  {
    id: 'theme:light',
    label: 'Light',
    icon: 'sun' as const,
    kind: 'radio' as const,
    checked: themePreference.value === 'light'
  },
  {
    id: 'theme:dark',
    label: 'Dark',
    icon: 'moon' as const,
    kind: 'radio' as const,
    checked: themePreference.value === 'dark'
  }
])

const appearanceMenuModel = computed<AppMenuModel>(() => ({
  label: 'Appearance',
  sections: [{ items: themeMenuItems.value }]
}))

const canvasMenuModel = computed<AppMenuModel>(() => ({
  label: 'Canvas menu',
  sections: [
    {
      items: [
        {
          id: 'open-add-menu',
          label: 'Add browser',
          icon: 'add',
          detail: 'Choose viewport'
        }
      ]
    },
    {
      label: 'View',
      items: [
        {
          id: 'fit-all',
          label: 'Fit all browsers',
          icon: 'fit',
          disabled: panes.value.length === 0
        },
        {
          id: 'reset-zoom',
          label: 'Reset zoom',
          icon: 'reset',
          detail: '100%'
        },
        {
          id: 'toggle-hand',
          label: 'Hand tool',
          icon: 'hand',
          kind: 'checkbox',
          checked: canvasHandActive.value
        }
      ]
    },
    {
      label: 'Manage',
      items: [
        {
          id: 'open-workspaces',
          label: 'Workspaces…',
          icon: 'workspaces'
        }
      ]
    },
    {
      label: 'Appearance',
      items: themeMenuItems.value
    }
  ]
}))

const arrangeMenuModel = computed<AppMenuModel>(() => ({
  label: 'Arrange browsers',
  sections: [
    {
      items: [
        {
          id: 'arrange:showcase',
          label: 'Showcase layout',
          icon: 'showcase',
          detail: 'Compact rows',
          disabled: panes.value.length === 0
        },
        {
          id: 'arrange:row',
          label: 'Horizontal row',
          icon: 'row',
          disabled: panes.value.length === 0
        },
        {
          id: 'arrange:grid',
          label: '2 × 2 grid',
          icon: 'grid',
          disabled: panes.value.length === 0
        },
        {
          id: 'arrange:stack',
          label: 'Vertical stack',
          icon: 'stack',
          disabled: panes.value.length === 0
        }
      ]
    }
  ]
}))

const paneMenuModel = computed<AppMenuModel>(() => {
  const pane = panes.value.find((entry) => entry.id === paneMenuPaneId.value)
  return {
    label: 'Browser actions',
    sections: [
      {
        label: 'Navigate',
        items: [
          {
            id: 'pane:back',
            label: 'Back',
            icon: 'back',
            disabled: !pane?.canGoBack
          },
          {
            id: 'pane:forward',
            label: 'Forward',
            icon: 'forward',
            disabled: !pane?.canGoForward
          },
          {
            id: 'pane:reload',
            label: 'Reload',
            icon: 'reset'
          },
          {
            id: 'pane:copy-url',
            label: 'Copy URL',
            icon: 'copy',
            disabled: !pane || pane.url === 'about:blank'
          },
          {
            id: 'pane:external',
            label: 'Open in Browser',
            icon: 'external',
            disabled: !pane || pane.url === 'about:blank'
          }
        ]
      },
      {
        label: 'Viewport',
        items: [
          {
            id: 'pane:rotate',
            label: 'Rotate Viewport',
            icon: 'rotate',
            disabled: !pane || pane.viewport.preset === 'responsive'
          },
          {
            id: 'pane:screenshot',
            label: 'Capture Screenshot…',
            icon: 'camera',
            disabled: !pane || pane.url === 'about:blank'
          }
        ]
      },
      {
        label: 'Manage',
        items: [
          {
            id: 'pane:duplicate',
            label: 'Duplicate Browser',
            icon: 'duplicate',
            disabled: !pane
          },
          {
            id: 'pane:rename',
            label: 'Rename Browser…',
            icon: 'rename',
            disabled: !pane
          },
          {
            id: 'pane:clear-site-data',
            label: 'Clear Site Data…',
            icon: 'reset',
            disabled: !pane
          },
          {
            id: 'pane:devtools',
            label: 'Open DevTools',
            icon: 'devtools',
            disabled: !pane
          }
        ]
      },
      {
        items: [
          {
            id: 'pane:close',
            label: 'Close Browser',
            icon: 'close',
            separatorBefore: true,
            disabled: !pane
          }
        ]
      }
    ]
  }
})

const clearSiteDataMenuModel = computed<AppMenuModel>(() => {
  const pane = panes.value.find((entry) => entry.id === paneMenuPaneId.value)
  return {
    label: pane ? `Clear site data for ${pane.title}` : 'Clear site data',
    sections: [
      {
        items: [
          {
            id: 'clear-site-data:confirm',
            label: 'Clear Site Data and Reload',
            icon: 'reset',
            detail: 'Signs out'
          },
          {
            id: 'clear-site-data:cancel',
            label: 'Cancel',
            separatorBefore: true
          }
        ]
      }
    ]
  }
})

const selectionPanes = computed(() =>
  orderedPanes.value.filter((pane) => selectedPaneIds.value.has(pane.id))
)

const selectionViewport = computed<PaneViewport | null>(() => {
  const selected = selectionPanes.value
  if (selected.length === 0) {
    return null
  }
  const first = selected[0]?.viewport
  if (!first) {
    return null
  }
  const same = selected.every(
    (pane) =>
      pane.viewport.preset === first.preset &&
      pane.viewport.width === first.width &&
      pane.viewport.height === first.height &&
      pane.viewport.deviceScaleFactor === first.deviceScaleFactor &&
      pane.viewport.rotated === first.rotated
  )
  return same ? first : null
})

const selectionViewportLabel = computed(() => {
  const viewport = selectionViewport.value
  if (!viewport) {
    return 'Viewport'
  }
  if (viewport.preset === 'responsive') {
    return 'Responsive'
  }
  if (viewport.preset === 'custom') {
    return 'Custom'
  }
  return findViewportPreset(viewport.preset)?.label.split(' — ')[0] ?? viewport.preset
})

const selectionMenuModel = computed<AppMenuModel>(() => {
  const selected = selectionPanes.value
  const selectedPreset = selectionViewport.value?.preset
  return {
    label: `Viewport for ${selected.length} selected ${selected.length === 1 ? 'browser' : 'browsers'}`,
    sections: [
      {
        items: [
          {
            id: 'selection:viewport:responsive',
            label: 'Responsive',
            icon: 'responsive',
            detail: 'Full size',
            kind: 'radio',
            checked: selectedPreset === 'responsive'
          }
        ]
      },
      ...PRESET_CATEGORIES.map(({ category, label, presets }) => ({
        label,
        items: presets.map((preset) => ({
          id: `selection:viewport:${preset.id}`,
          label: presetLabel(preset),
          icon: presetIcon(category),
          detail: `${preset.width} × ${preset.height}`,
          kind: 'radio' as const,
          checked: selectedPreset === preset.id
        }))
      }))
    ]
  }
})

const workspaceMenuModel = computed<AppMenuModel>(() => {
  const workspace = workspaces.value.find((entry) => entry.id === workspaceMenuId.value)
  const unavailable = !workspace || workspaceBusy.value
  return {
    label: workspace ? `Workspace actions for ${workspace.name}` : 'Workspace actions',
    sections: [
      {
        label: workspace?.name,
        items: [
          {
            id: 'workspace-menu:switch',
            label: 'Switch',
            icon: 'workspaces',
            disabled: unavailable || workspace?.active === true
          },
          {
            id: 'workspace-menu:rename',
            label: 'Rename',
            icon: 'rename',
            disabled: unavailable
          },
          {
            id: 'workspace-menu:duplicate',
            label: 'Duplicate',
            icon: 'duplicate',
            disabled: unavailable
          },
          {
            id: 'workspace-menu:delete',
            label: 'Delete',
            icon: 'close',
            separatorBefore: true,
            disabled:
              unavailable ||
              workspace?.active === true ||
              workspaces.value.length <= 1
          }
        ]
      }
    ]
  }
})

const gridLayout = computed<GridLayout | null>(() => {
  if (
    orderedPanes.value.length === 0 ||
    workspaceSize.value.width < 1 ||
    workspaceSize.value.height < 1
  ) {
    return null
  }

  const result = layoutGrid(
    orderedPanes.value.map((pane) => pane.id),
    workspaceSize.value,
    { columns: gridColumns.value, padding: 8, gap: 8 }
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

const gridContentHeight = computed(() => gridLayout.value?.contentHeight ?? 0)

const freeformPixelRects = computed(() => {
  const rects = new Map<string, Rect>()
  if (workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    return rects
  }

  const minSize = {
    width: DEFAULT_MIN_PANE_WIDTH,
    height: DEFAULT_MIN_PANE_HEIGHT
  }
  for (const paneId of freeformOrder.value) {
    const normalized = freeformGeometries.value[paneId]
    if (!normalized) {
      continue
    }
    const rect = normalizedToRect(normalized, workspaceSize.value, minSize)
    if (rect) {
      rects.set(paneId, rect)
    }
  }
  return rects
})

const slotRects = computed(() =>
  layoutMode.value === 'grid' ? placementByPane.value : freeformPixelRects.value
)

const paneGridHeight = computed(() =>
  layoutMode.value === 'canvas'
    ? workspaceSize.value.height
    : layoutMode.value === 'grid'
      ? gridContentHeight.value
      : workspaceSize.value.height
)

function focusPaneAddress(paneId: string): void {
  selectPane(paneId)
  const input = document.querySelector<HTMLInputElement>(
    `[data-pane-id="${paneId}"] .address-input`
  )
  input?.focus()
  input?.select()
}

function requestPaneRename(paneId: string): void {
  if (!panes.value.some((pane) => pane.id === paneId)) {
    return
  }
  selectPane(paneId)
  paneRenameRequests.value = {
    ...paneRenameRequests.value,
    [paneId]: (paneRenameRequests.value[paneId] ?? 0) + 1
  }
}

function requestCustomViewport(paneId: string): void {
  if (!panes.value.some((pane) => pane.id === paneId)) {
    return
  }
  customViewportRequests.value = {
    ...customViewportRequests.value,
    [paneId]: (customViewportRequests.value[paneId] ?? 0) + 1
  }
}

function removePaneNotice(paneId: string): void {
  if (!(paneId in paneNotices.value)) {
    return
  }
  const next = { ...paneNotices.value }
  delete next[paneId]
  paneNotices.value = next
}

function clearPaneNotice(paneId: string): void {
  const timer = paneNoticeTimers.get(paneId)
  if (timer !== undefined) {
    clearTimeout(timer)
    paneNoticeTimers.delete(paneId)
  }
  removePaneNotice(paneId)
}

function showPaneNotice(notice: PaneNotice): void {
  if (!panes.value.some((pane) => pane.id === notice.paneId)) {
    return
  }
  const existing = paneNoticeTimers.get(notice.paneId)
  if (existing !== undefined) {
    clearTimeout(existing)
  }
  if (paneNotices.value[notice.paneId] !== notice.message) {
    paneNotices.value = {
      ...paneNotices.value,
      [notice.paneId]: notice.message
    }
  }
  const timer = setTimeout(() => {
    paneNoticeTimers.delete(notice.paneId)
    removePaneNotice(notice.paneId)
  }, PANE_NOTICE_DURATION)
  paneNoticeTimers.set(notice.paneId, timer)
}

function clearAllPaneNotices(): void {
  for (const timer of paneNoticeTimers.values()) {
    clearTimeout(timer)
  }
  paneNoticeTimers.clear()
  if (Object.keys(paneNotices.value).length > 0) {
    paneNotices.value = {}
  }
}

function blurActiveShellControl(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur()
  }
}

function selectPane(paneId: string | null): void {
  activePaneId.value = paneId
  paneSelectionCleared.value = paneId === null
  saveCanvasViewNow()
}

function clearPaneSelection(): void {
  const hadActive = activePaneId.value !== null
  const hadSelected = selectedPaneIds.value.size > 0
  if (hadActive) {
    blurActiveShellControl()
    selectPane(null)
  }
  if (hadSelected) {
    selectedPaneIds.value = new Set()
  }
  if (hadActive || hadSelected) {
    void nextTick(scheduleMeasure)
  }
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
  if (
    !canvasViewReady &&
    panes.value.length > 0 &&
    currentWorkspaceId.value !== null &&
    width > 0 &&
    height > 0
  ) {
    requestAnimationFrame(() => restoreCanvasViewWhenReady())
  }
}

function paneSlotStyle(paneId: string): Record<string, string> {
  const canvasFrame = layoutMode.value === 'canvas' ? canvasFrames.value.get(paneId) : null
  const rect = slotRects.value.get(paneId)

  if (layoutMode.value === 'canvas' && !canvasFrame) {
    return { visibility: 'hidden' }
  }

  if (!rect && !canvasFrame) {
    return { visibility: 'hidden' }
  }

  if (canvasFrame) {
    const zoom = canvasZoom.value
    return {
      left: `${canvasPan.value.x + canvasFrame.x * zoom}px`,
      top: `${canvasPan.value.y + canvasFrame.y * zoom}px`,
      width: `${canvasFrame.width * zoom}px`,
      height: `${canvasFrame.height * zoom}px`,
      '--pane-zoom': String(zoom),
      '--pane-world-width': `${canvasFrame.width}px`,
      zIndex:
        canvasPaneDrag.value?.paneId === paneId
          ? '1000'
          : String(10 + Math.max(0, paneOrder.value.indexOf(paneId)))
    }
  }

  const style: Record<string, string> = {
    left: `${rect?.x ?? 0}px`,
    top: `${rect?.y ?? 0}px`,
    width: `${rect?.width ?? 0}px`,
    height: `${rect?.height ?? 0}px`
  }

  if (layoutMode.value === 'freeform') {
    const index = freeformOrder.value.indexOf(paneId)
    style.zIndex = String(10 + Math.max(0, index))
  }

  return style
}

function handleWindowResize(): void {
  readWorkspaceSize()
  scheduleMeasure()
}

function updateSuspendedPanes(next: ReadonlySet<string>): void {
  const current = suspendedPaneIds.value
  if (current.size === next.size && [...next].every((paneId) => current.has(paneId))) {
    return
  }
  suspendedPaneIds.value = next
}

function freeformMinSize(): Size {
  return { width: DEFAULT_MIN_PANE_WIDTH, height: DEFAULT_MIN_PANE_HEIGHT }
}

function defaultFreeformGeometry(index: number): NormalizedRect {
  const offset = Math.min(0.4, 0.08 + index * 0.04)
  return { x: offset, y: offset, width: 0.5, height: 0.5 }
}

function ensureFreeformGeometry(): void {
  if (layoutMode.value !== 'freeform' || workspaceSize.value.width < 1) {
    return
  }

  const next = { ...freeformGeometries.value }
  const paneIds = new Set(orderedPanes.value.map((pane) => pane.id))
  let changed = false

  for (const paneId of Object.keys(next)) {
    if (!paneIds.has(paneId)) {
      delete next[paneId]
      changed = true
    }
  }

  orderedPanes.value.forEach((pane, index) => {
    if (next[pane.id]) {
      return
    }

    const gridRect = placementByPane.value.get(pane.id)
    const normalized = gridRect
      ? rectToNormalized(gridRect, workspaceSize.value)
      : defaultFreeformGeometry(index)
    if (!normalized) {
      return
    }

    const clamped = normalizedToRect(normalized, workspaceSize.value, freeformMinSize())
    if (!clamped) {
      return
    }
    const safe = rectToNormalized(clamped, workspaceSize.value)
    if (safe) {
      next[pane.id] = safe
      changed = true
    }
  })

  if (changed) {
    freeformGeometries.value = next
  }
}

let snapshotRequest = 0
let snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null
let canvasWheelEndTimer: ReturnType<typeof setTimeout> | null = null
let minimapStateTimer: ReturnType<typeof setTimeout> | null = null

async function refreshPaneSnapshots(): Promise<void> {
  if (layoutMode.value !== 'canvas' || panes.value.length === 0) {
    return
  }
  const request = ++snapshotRequest
  try {
    const result = await window.browserdeck.capturePaneSnapshots()
    if (request !== snapshotRequest || !result.ok) {
      return
    }
    const liveIds = new Set(panes.value.map((pane) => pane.id))
    const next = Object.fromEntries(
      Object.entries(paneSnapshots.value).filter(([paneId]) => liveIds.has(paneId))
    )
    for (const [paneId, snapshot] of Object.entries(result.snapshots)) {
      if (liveIds.has(paneId)) {
        next[paneId] = snapshot
      }
    }
    paneSnapshots.value = next
  } catch {
    // Snapshots are a visual aid; live native views remain the primary layer.
  }
}

function scheduleSnapshotRefresh(delay = 250): void {
  if (snapshotRefreshTimer !== null) {
    clearTimeout(snapshotRefreshTimer)
  }
  snapshotRefreshTimer = setTimeout(() => {
    snapshotRefreshTimer = null
    void refreshPaneSnapshots()
  }, delay)
}

function ensureCanvasPositions(): void {
  if (layoutMode.value !== 'canvas' || orderedPanes.value.length === 0) {
    return
  }
  const paneIds = new Set(orderedPanes.value.map((pane) => pane.id))
  const next: Record<string, CanvasPosition> = {}
  let changed = false
  let rightEdge = CANVAS_ORIGIN
  let hasPosition = false

  for (const [paneId, position] of Object.entries(canvasPositions.value)) {
    if (!paneIds.has(paneId)) {
      changed = true
      continue
    }
    next[paneId] = { ...position }
    const pane = orderedPanes.value.find((candidate) => candidate.id === paneId)
    const width = pane ? canvasFrameSize(pane.viewport).width : 0
    rightEdge = Math.max(rightEdge, position.x + width)
    hasPosition = true
  }

  for (const pane of orderedPanes.value) {
    if (next[pane.id]) {
      continue
    }
    const width = canvasFrameSize(pane.viewport).width
    const position = hasPosition
      ? { x: Math.round(rightEdge + CANVAS_GAP), y: CANVAS_ORIGIN }
      : { x: CANVAS_ORIGIN, y: CANVAS_ORIGIN }
    next[pane.id] = position
    rightEdge = position.x + width
    hasPosition = true
    changed = true
  }

  if (changed) {
    canvasPositions.value = next
  }
}

function raisePane(paneId: string): void {
  if (layoutMode.value !== 'freeform') {
    return
  }
  const nextOrder = bringToFront(freeformOrder.value, paneId)
  if (nextOrder) {
    freeformOrder.value = nextOrder
  }
  void window.browserdeck.bringPaneToFront(paneId).catch(() => undefined)
}

function lowerPane(paneId: string): void {
  if (layoutMode.value !== 'freeform') {
    return
  }
  const nextOrder = sendToBack(freeformOrder.value, paneId)
  if (nextOrder) {
    freeformOrder.value = nextOrder
  }
  void window.browserdeck.sendPaneToBack(paneId).catch(() => undefined)
}

function applyFreeformRect(paneId: string, rect: Rect): void {
  const normalized = rectToNormalized(rect, workspaceSize.value)
  if (!normalized) {
    return
  }
  freeformGeometries.value = {
    ...freeformGeometries.value,
    [paneId]: normalized
  }
}

function clearCanvasGuides(): void {
  guides.value = { vertical: [], horizontal: [] }
  proximityGuides.value = { vertical: [], horizontal: [] }
}

function updateGuidesFromSnap(snapped: SnapGuides): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    guides.value = { vertical: [], horizontal: [] }
    return
  }
  const rect = workspace.getBoundingClientRect()
  guides.value = {
    vertical: snapped.vertical.map((value) => value - rect.x),
    horizontal: snapped.horizontal.map((value) => value - rect.y)
  }
}

function updateFreeformInteraction(event: PointerEvent, state: DragState): void {
  if (!state.startRect || workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    return
  }

  const canvas = workspaceSize.value
  const minSize = freeformMinSize()
  const deltaX = event.clientX - state.startX
  const deltaY = event.clientY - state.startY

  const baseRect =
    state.kind === 'move'
      ? moveRect(state.startRect, deltaX, deltaY, canvas, minSize)
      : state.handle
        ? resizeRect(state.startRect, state.handle, deltaX, deltaY, canvas, minSize)
        : null

  if (!baseRect) {
    return
  }

  const neighbors = [...freeformPixelRects.value.entries()]
    .filter(([paneId]) => paneId !== state.paneId)
    .map(([, rect]) => rect)

  const snapped = snapRect(baseRect, {
    canvas,
    neighbors,
    threshold: 8,
    snapToCanvas: true,
    snapToNeighbors: true
  })
  if (!snapped) {
    return
  }

  updateGuidesFromSnap(snapped.guides)
  applyFreeformRect(state.paneId, snapped.rect)
}

function beginInteraction(state: DragState): void {
  dragState.value = state
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', finishDrag)
}

function beginCanvasPan(event: PointerEvent, empty = true): void {
  if (canvasDrag.value) {
    return
  }
  event.preventDefault()
  blurActiveShellControl()
  const captureTarget = event.currentTarget
  if (captureTarget instanceof Element) {
    try {
      captureTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; window listeners still handle the drag.
    }
  }
  canvasDrag.value = {
    startX: event.clientX,
    startY: event.clientY,
    base: { ...canvasPan.value },
    button: event.button,
    moved: false,
    empty
  }
  clearCanvasGuides()
  isCanvasPanning.value = true
  document.body.classList.add('browserdeck-canvas-panning')
  void nextTick(scheduleMeasure)
  if (Object.keys(paneSnapshots.value).length === 0) {
    scheduleSnapshotRefresh(0)
  }
  window.addEventListener('pointermove', onCanvasPointerMove)
  window.addEventListener('pointerup', finishCanvasPan)
  window.addEventListener('pointercancel', finishCanvasPan)
}

function onCanvasPointerMove(event: PointerEvent): void {
  const drag = canvasDrag.value
  if (!drag) {
    return
  }
  event.preventDefault()
  if (
    Math.abs(event.clientX - drag.startX) > 3 ||
    Math.abs(event.clientY - drag.startY) > 3
  ) {
    drag.moved = true
  }
  canvasPan.value = {
    x: drag.base.x + (event.clientX - drag.startX),
    y: drag.base.y + (event.clientY - drag.startY)
  }
}

function finishCanvasPan(event?: PointerEvent): void {
  const drag = canvasDrag.value
  if (!drag) {
    return
  }
  const deselect =
    drag.button === 0 && drag.empty && !drag.moved && event?.type !== 'pointercancel'
  canvasDrag.value = null
  isCanvasPanning.value = false
  document.body.classList.remove('browserdeck-canvas-panning')
  window.removeEventListener('pointermove', onCanvasPointerMove)
  window.removeEventListener('pointerup', finishCanvasPan)
  window.removeEventListener('pointercancel', finishCanvasPan)
  if (deselect) {
    clearPaneSelection()
  }
  saveCanvasViewNow()
  void nextTick(async () => {
    await measurePanes()
    scheduleSnapshotRefresh()
  })
}

function beginCanvasPaneDrag(event: PointerEvent, paneId: string): void {
  if (canvasPaneDrag.value) {
    return
  }
  const frame = canvasFrames.value.get(paneId)
  if (!frame) {
    return
  }

  blurActiveShellControl()
  selectPane(paneId)
  canvasPaneDrag.value = {
    paneId,
    startX: event.clientX,
    startY: event.clientY,
    base: { x: frame.x, y: frame.y },
    moved: false
  }
  isCanvasPaneDragging.value = true
  document.body.classList.add('browserdeck-canvas-pane-dragging')
  clearCanvasGuides()
  void nextTick(scheduleMeasure)
  window.addEventListener('pointermove', onCanvasPanePointerMove)
  window.addEventListener('pointerup', finishCanvasPaneDrag)
  window.addEventListener('pointercancel', finishCanvasPaneDrag)
}

function onCanvasPanePointerMove(event: PointerEvent): void {
  const drag = canvasPaneDrag.value
  if (!drag) {
    return
  }
  event.preventDefault()
  if (
    Math.abs(event.clientX - drag.startX) > 3 ||
    Math.abs(event.clientY - drag.startY) > 3
  ) {
    drag.moved = true
  }
  const frame = canvasFrames.value.get(drag.paneId)
  if (!frame) {
    return
  }

  const rawX = drag.base.x + (event.clientX - drag.startX) / canvasZoom.value
  const rawY = drag.base.y + (event.clientY - drag.startY) / canvasZoom.value
  const neighbors = [...canvasFrames.value.entries()].flatMap(([paneId, other]) =>
    paneId === drag.paneId
      ? []
      : [{ x: other.x, y: other.y, width: other.width, height: other.height }]
  )
  const snapped = snapCanvasRect(
    { x: rawX, y: rawY, width: frame.width, height: frame.height },
    neighbors,
    {
      threshold: CANVAS_SNAP_THRESHOLD / canvasZoom.value,
      nearThreshold: CANVAS_NEAR_THRESHOLD / canvasZoom.value,
      nearGap: CANVAS_NEAR_GAP / canvasZoom.value,
      proximityThreshold: CANVAS_PROXIMITY_THRESHOLD / canvasZoom.value
    }
  )
  // Keep the pane header below the top workspace edge while dragging. Canvas
  // panning can still move content off-screen intentionally; Fit all and pane
  // selection remain the recovery paths.
  const clamped = clampCanvasPaneTop(
    { x: snapped.x, y: snapped.y },
    canvasPan.value,
    canvasZoom.value,
    CANVAS_FIT_PADDING
  )
  const topClamped = clamped.y !== snapped.y

  canvasPositions.value = {
    ...canvasPositions.value,
    [drag.paneId]: clamped
  }
  guides.value = {
    vertical: snapped.guides.vertical.map(
      (guide) => canvasPan.value.x + guide * canvasZoom.value
    ),
    horizontal: topClamped
      ? []
      : snapped.guides.horizontal.map(
          (guide) => canvasPan.value.y + guide * canvasZoom.value
        )
  }
  proximityGuides.value = {
    vertical: snapped.proximity.vertical.map(
      (guide) => canvasPan.value.x + guide * canvasZoom.value
    ),
    horizontal: topClamped
      ? []
      : snapped.proximity.horizontal.map(
          (guide) => canvasPan.value.y + guide * canvasZoom.value
        )
  }
}

function finishCanvasPaneDrag(event?: PointerEvent): void {
  const drag = canvasPaneDrag.value
  if (!drag) {
    return
  }
  const toggleSelection = !drag.moved && event?.type !== 'pointercancel'
  canvasPaneDrag.value = null
  isCanvasPaneDragging.value = false
  clearCanvasGuides()
  document.body.classList.remove('browserdeck-canvas-pane-dragging')
  window.removeEventListener('pointermove', onCanvasPanePointerMove)
  window.removeEventListener('pointerup', finishCanvasPaneDrag)
  window.removeEventListener('pointercancel', finishCanvasPaneDrag)
  if (toggleSelection) {
    togglePaneSelection(drag.paneId)
  }
  void nextTick(async () => {
    await measurePanes()
    await saveWorkspaceLayout()
    scheduleSnapshotRefresh()
  })
}

function setCanvasHandMode(active: boolean): void {
  if (active) {
    temporarySelectMode.value = false
  }
  if (active && selectionToolActive.value) {
    selectionToolActive.value = false
    clearSelectedPanes()
    cancelMarqueeSelection()
  }
  if (canvasHandMode.value === active) {
    return
  }
  canvasHandMode.value = active
  void nextTick(scheduleMeasure)
  if (active && Object.keys(paneSnapshots.value).length === 0) {
    scheduleSnapshotRefresh(0)
  }
}

function toggleCanvasHand(): void {
  setCanvasHandMode(!canvasHandMode.value)
}

function clearSelectedPanes(): void {
  if (selectedPaneIds.value.size > 0) {
    selectedPaneIds.value = new Set()
  }
}

function togglePaneSelection(paneId: string): void {
  const next = new Set(selectedPaneIds.value)
  if (next.has(paneId)) {
    next.delete(paneId)
    selectedPaneIds.value = next
    if (activePaneId.value === paneId) {
      selectPane([...next].at(-1) ?? null)
    }
  } else {
    next.add(paneId)
    selectedPaneIds.value = next
    if (activePaneId.value !== paneId) {
      selectPane(paneId)
    }
  }
  void nextTick(scheduleMeasure)
}

function selectOnlyPane(paneId: string): void {
  selectedPaneIds.value = new Set([paneId])
  selectPane(paneId)
  void nextTick(scheduleMeasure)
}

function setSelectionToolActive(active: boolean): void {
  if (selectionToolActive.value === active) {
    return
  }
  if (active) {
    setCanvasHandMode(false)
  } else {
    cancelMarqueeSelection()
    clearSelectedPanes()
  }
  selectionToolActive.value = active
  void nextTick(scheduleMeasure)
}

function toggleSelectionTool(): void {
  setSelectionToolActive(!selectionToolActive.value)
}

function cancelMarqueeSelection(): void {
  if (!isMarqueeSelecting.value && marqueeDrag === null) {
    return
  }
  marqueeDrag = null
  marqueeRect.value = null
  isMarqueeSelecting.value = false
  document.body.classList.remove('browserdeck-canvas-selecting')
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', finishMarqueeSelection)
  window.removeEventListener('pointercancel', finishMarqueeSelection)
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
}

function normalizedMarqueeRect(endX: number, endY: number): Rect | null {
  const drag = marqueeDrag
  if (!drag) {
    return null
  }
  return {
    x: Math.min(drag.startX, endX),
    y: Math.min(drag.startY, endY),
    width: Math.abs(endX - drag.startX),
    height: Math.abs(endY - drag.startY)
  }
}

function beginMarqueeSelection(event: PointerEvent, anchorPaneId: string | null): void {
  if (marqueeDrag !== null || !selectionModeActive.value) {
    return
  }
  event.preventDefault()
  blurActiveShellControl()
  const captureTarget = event.currentTarget
  if (captureTarget instanceof Element) {
    try {
      captureTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; window listeners still handle the drag.
    }
  }
  marqueeDrag = {
    startX: event.clientX,
    startY: event.clientY,
    anchorPaneId,
    moved: false
  }
  marqueeRect.value = {
    x: event.clientX,
    y: event.clientY,
    width: 0,
    height: 0
  }
  isMarqueeSelecting.value = true
  document.body.classList.add('browserdeck-canvas-selecting')
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
  if (Object.keys(paneSnapshots.value).length === 0) {
    scheduleSnapshotRefresh(0)
  }
  window.addEventListener('pointermove', onMarqueePointerMove)
  window.addEventListener('pointerup', finishMarqueeSelection)
  window.addEventListener('pointercancel', finishMarqueeSelection)
}

function onMarqueePointerMove(event: PointerEvent): void {
  const drag = marqueeDrag
  if (!drag) {
    return
  }
  event.preventDefault()
  const moved =
    Math.abs(event.clientX - drag.startX) > 2 ||
    Math.abs(event.clientY - drag.startY) > 2
  if (!drag.moved && !moved) {
    return
  }
  if (!drag.moved) {
    drag.moved = true
    // A real marquee replaces the existing selection. A simple click toggles
    // the pane under the pointer instead.
    selectedPaneIds.value = new Set()
  }
  const rect = normalizedMarqueeRect(event.clientX, event.clientY)
  if (!rect) {
    return
  }
  marqueeRect.value = rect

  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }
  const workspaceRect = workspace.getBoundingClientRect()
  const zoom = canvasZoom.value
  const frames = [...canvasFrames.value.entries()].map(([paneId, frame]) => ({
    id: paneId,
    x: workspaceRect.left + canvasPan.value.x + frame.x * zoom,
    y: workspaceRect.top + canvasPan.value.y + frame.y * zoom,
    width: frame.width * zoom,
    height: frame.height * zoom
  }))
  selectedPaneIds.value = new Set(canvasPaneIdsInRect(frames, rect))
}

function finishMarqueeSelection(event?: PointerEvent): void {
  const drag = marqueeDrag
  if (!drag) {
    return
  }
  const cancelled = event?.type === 'pointercancel'
  const moved = drag.moved
  const anchorPaneId = drag.anchorPaneId
  marqueeDrag = null
  marqueeRect.value = null
  isMarqueeSelecting.value = false
  document.body.classList.remove('browserdeck-canvas-selecting')
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', finishMarqueeSelection)
  window.removeEventListener('pointercancel', finishMarqueeSelection)

  if (cancelled) {
    clearSelectedPanes()
  } else if (!moved) {
    if (anchorPaneId) {
      togglePaneSelection(anchorPaneId)
    } else {
      // Clicking empty canvas clears the active browser too, matching the
      // normal Canvas selection behavior.
      clearSelectedPanes()
      selectPane(null)
    }
  } else if (selectedPaneIds.value.size === 0) {
    // A marquee that ends over empty canvas clears the active browser as well.
    selectPane(null)
  }

  syncCanvasMinimapVisibility()
  void nextTick(async () => {
    await measurePanes()
    scheduleSnapshotRefresh()
  })
}

async function closeSelectedPanes(): Promise<void> {
  const ids = [...selectedPaneIds.value]
  if (ids.length === 0) {
    return
  }
  selectedPaneIds.value = new Set()
  actionError.value = null
  try {
    for (const paneId of ids) {
      const result = await window.browserdeck.closePane(paneId)
      if (!result.ok) {
        actionError.value = result.error
        return
      }
    }
  } catch {
    actionError.value = 'Could not close the selected browsers.'
  }
}

watch(canvasHandActive, (active) => {
  void window.browserdeck.setCanvasHandMode(active).catch(() => undefined)
})

watch(selectionToolActive, (active) => {
  void window.browserdeck.setCanvasSelectMode(active).catch(() => undefined)
})

function syncCanvasZoomToMain(zoom: number): void {
  void window.browserdeck.setCanvasZoom(zoom).catch(() => undefined)
}

function setCanvasZoomAtPoint(nextZoom: number, clientX: number, clientY: number): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }
  const zoom = Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, nextZoom))
  if (Math.abs(zoom - canvasZoom.value) < 0.0001) {
    return
  }

  const rect = workspace.getBoundingClientRect()
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  const oldZoom = canvasZoom.value
  const worldX = (localX - canvasPan.value.x) / oldZoom
  const worldY = (localY - canvasPan.value.y) / oldZoom
  canvasPan.value = {
    x: localX - worldX * zoom,
    y: localY - worldY * zoom
  }
  canvasZoom.value = zoom
  syncCanvasZoomToMain(zoom)
  void nextTick(scheduleMeasure)
  scheduleSnapshotRefresh(300)
}

function resetCanvasZoom(): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }
  const rect = workspace.getBoundingClientRect()
  setCanvasZoomAtPoint(1, rect.left + rect.width / 2, rect.top + rect.height / 2)
  saveCanvasViewNow()
}

function zoomCanvasAtCenter(zoom: number): void {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }
  const rect = workspace.getBoundingClientRect()
  setCanvasZoomAtPoint(zoom, rect.left + rect.width / 2, rect.top + rect.height / 2)
  saveCanvasViewNow()
}

function isBottomBarMenu(mode = appMenuMode.value): boolean {
  return mode === 'zoom' || mode === 'appearance' || mode === 'arrange'
}

function applyCanvasZoomAction(action: CanvasZoomAction): void {
  if (action.type === 'menu') {
    if (appMenuMode.value === 'zoom') {
      closeAppMenu(false)
    } else {
      openCanvasZoomMenu()
    }
    return
  }
  if (action.type === 'appearance') {
    if (appMenuMode.value === 'appearance') {
      closeAppMenu(false)
    } else {
      openCanvasAppearanceMenu()
    }
    return
  }
  if (action.type === 'arrange') {
    if (appMenuMode.value === 'arrange') {
      closeAppMenu(false)
    } else {
      openCanvasArrangeMenu()
    }
    return
  }
  if (action.type === 'toggle-hand') {
    if (isBottomBarMenu()) {
      closeAppMenu(false)
    }
    toggleCanvasHand()
    return
  }
  if (action.type === 'toggle-select') {
    if (isBottomBarMenu()) {
      closeAppMenu(false)
    }
    toggleSelectionTool()
    return
  }
  if (isBottomBarMenu()) {
    closeAppMenu(false)
  }
  switch (action.type) {
    case 'step':
      zoomCanvasAtCenter(
        canvasZoom.value + (action.direction === 'in' ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP)
      )
      break
    case 'set':
      zoomCanvasAtCenter(action.zoom)
      break
    case 'fit':
      fitCanvasToPanes()
      break
    case 'reset':
      zoomCanvasAtCenter(1)
      break
    case 'find-device':
      openDevicePalette()
      break
    case 'reload-all':
      void reloadAll()
      break
  }
}

function restoreCanvasViewWhenReady(attempts = 5): void {
  if (canvasViewReady) {
    return
  }
  if (layoutMode.value !== 'canvas') {
    canvasViewReady = true
    return
  }
  if (panes.value.length === 0) {
    canvasZoom.value = 1
    canvasPan.value = { x: 0, y: 0 }
    syncCanvasZoomToMain(1)
    canvasViewReady = true
    scheduleCanvasViewSave()
    return
  }
  if (workspaceSize.value.width < 1 || workspaceSize.value.height < 1) {
    if (attempts > 0) {
      requestAnimationFrame(() => restoreCanvasViewWhenReady(attempts - 1))
    }
    return
  }
  fitCanvasToPanes()
  canvasViewReady = true
  scheduleCanvasViewSave()
}

function beginCanvasWheelGesture(): void {
  if (canvasHandActive.value || isCanvasPanning.value || isCanvasPaneDragging.value) {
    return
  }
  isCanvasPanning.value = true
  document.body.classList.add('browserdeck-canvas-panning')
  void nextTick(scheduleMeasure)
  if (Object.keys(paneSnapshots.value).length === 0) {
    scheduleSnapshotRefresh(0)
  }
}

function scheduleCanvasWheelEnd(): void {
  if (canvasWheelEndTimer !== null) {
    clearTimeout(canvasWheelEndTimer)
  }
  canvasWheelEndTimer = setTimeout(() => {
    canvasWheelEndTimer = null
    isCanvasPanning.value = false
    document.body.classList.remove('browserdeck-canvas-panning')
    saveCanvasViewNow()
    void nextTick(async () => {
      await measurePanes()
      scheduleSnapshotRefresh()
    })
  }, 160)
}

function onWorkspaceWheel(event: WheelEvent): void {
  if (layoutMode.value !== 'canvas') {
    return
  }
  event.preventDefault()

  if (canvasHandActive.value || event.ctrlKey || event.metaKey) {
    if (!canvasHandActive.value) {
      beginCanvasWheelGesture()
    }
    setCanvasZoomAtPoint(
      canvasZoom.value * Math.exp(-event.deltaY * 0.0015),
      event.clientX,
      event.clientY
    )
    if (!canvasHandActive.value) {
      scheduleCanvasWheelEnd()
    }
    return
  }

  beginCanvasWheelGesture()
  canvasPan.value = {
    x: canvasPan.value.x - event.deltaX,
    y: canvasPan.value.y - event.deltaY
  }
  scheduleCanvasWheelEnd()
}

function fitCanvasToPanes(): void {
  if (canvasFrames.value.size === 0 || workspaceSize.value.width < 1) {
    return
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const frame of canvasFrames.value.values()) {
    minX = Math.min(minX, frame.x)
    minY = Math.min(minY, frame.y)
    maxX = Math.max(maxX, frame.x + frame.width)
    maxY = Math.max(maxY, frame.y + frame.height)
  }
  const worldWidth = Math.max(1, maxX - minX)
  const worldHeight = Math.max(1, maxY - minY)
  const viewport = canvasViewportRect()
  const zoom = Math.min(
    CANVAS_MAX_ZOOM,
    Math.max(
      CANVAS_MIN_ZOOM,
      Math.min(viewport.width / worldWidth, viewport.height / worldHeight, 1)
    )
  )
  canvasZoom.value = zoom
  canvasPan.value = {
    x: Math.round(viewport.centerX - (minX + worldWidth / 2) * zoom),
    y: Math.round(viewport.centerY - (minY + worldHeight / 2) * zoom)
  }
  syncCanvasZoomToMain(zoom)
  saveCanvasViewNow()
  void nextTick(scheduleMeasure)
  scheduleSnapshotRefresh(300)
}

function focusCanvasPane(paneId: string): void {
  const frame = canvasFrames.value.get(paneId)
  if (!frame) {
    return
  }
  const viewport = canvasViewportRect()
  const fitZoom = Math.min(
    CANVAS_MAX_ZOOM,
    Math.max(
      CANVAS_MIN_ZOOM,
      Math.min(viewport.width / frame.width, viewport.height / frame.height, 1)
    )
  )
  const zoom = Math.min(canvasZoom.value, fitZoom)
  canvasZoom.value = zoom
  canvasPan.value = {
    x: Math.round(viewport.centerX - (frame.x + frame.width / 2) * zoom),
    y: Math.round(viewport.centerY - (frame.y + frame.height / 2) * zoom)
  }
  selectPane(paneId)
  syncCanvasZoomToMain(zoom)
  void nextTick(scheduleMeasure)
  scheduleSnapshotRefresh(300)
}

function revealCanvasPane(paneId: string): void {
  const frame = canvasFrames.value.get(paneId)
  if (!frame) {
    return
  }
  const zoom = canvasZoom.value
  const screenWidth = frame.width * zoom
  const screenHeight = frame.height * zoom
  const left = canvasPan.value.x + frame.x * zoom
  const top = canvasPan.value.y + frame.y * zoom
  const viewport = canvasViewportRect()

  let dx = 0
  let dy = 0
  if (screenWidth > viewport.width) {
    dx = Math.round(viewport.centerX - screenWidth / 2 - left)
  } else if (left < viewport.left) {
    dx = Math.round(viewport.left - left)
  } else if (left + screenWidth > viewport.right) {
    dx = Math.round(viewport.right - (left + screenWidth))
  }
  if (screenHeight > viewport.height) {
    dy = Math.round(viewport.centerY - screenHeight / 2 - top)
  } else if (top < viewport.top) {
    dy = Math.round(viewport.top - top)
  } else if (top + screenHeight > viewport.bottom) {
    dy = Math.round(viewport.bottom - (top + screenHeight))
  }

  selectPane(paneId)
  if (dx === 0 && dy === 0) {
    return
  }
  canvasPan.value = {
    x: canvasPan.value.x + dx,
    y: canvasPan.value.y + dy
  }
  saveCanvasViewNow()
  void nextTick(scheduleMeasure)
  scheduleSnapshotRefresh(300)
}

function recenterCanvasAt(worldX: number, worldY: number): void {
  canvasPan.value = {
    x: Math.round(workspaceSize.value.width / 2 - worldX * canvasZoom.value),
    y: Math.round(workspaceSize.value.height / 2 - worldY * canvasZoom.value)
  }
  saveCanvasViewNow()
  void nextTick(scheduleMeasure)
}

function scheduleCanvasMinimapState(delay = 40): void {
  if (layoutMode.value !== 'canvas') {
    return
  }
  if (minimapStateTimer !== null) {
    clearTimeout(minimapStateTimer)
  }
  minimapStateTimer = setTimeout(() => {
    minimapStateTimer = null
    if (layoutMode.value !== 'canvas') {
      return
    }
    void window.browserdeck
      .updateCanvasMinimap(canvasMinimapState.value)
      .catch(() => undefined)
  }, delay)
}

function syncCanvasMinimapVisibility(): void {
  const baseVisible =
    layoutMode.value === 'canvas' &&
    !workspacesOpen.value &&
    !bulkDialogOpen.value &&
    !devicePaletteOpen.value &&
    !isMarqueeSelecting.value
  let minimapVisible = baseVisible
  let zoomVisible = baseVisible

  if (baseVisible && appMenuMode.value !== null && !isBottomBarMenu()) {
    const menu = appMenuBounds.value
    if (menu) {
      const minimapSize = canvasMinimapSize(
        { width: window.innerWidth, height: window.innerHeight },
        false
      )
      const minimapRect = {
        x: window.innerWidth - minimapSize.width - CANVAS_MINIMAP_MARGIN,
        y: window.innerHeight - minimapSize.height - CANVAS_MINIMAP_MARGIN,
        width: minimapSize.width,
        height: minimapSize.height
      }
      const zoomRect = {
        x: Math.max(0, Math.round((window.innerWidth - CANVAS_ZOOM_BAR_WIDTH) / 2)),
        y: window.innerHeight - CANVAS_ZOOM_MARGIN - CANVAS_ZOOM_BAR_HEIGHT,
        width: CANVAS_ZOOM_BAR_WIDTH,
        height: CANVAS_ZOOM_BAR_HEIGHT
      }
      minimapVisible = !rectsIntersect(menu, minimapRect)
      zoomVisible = !rectsIntersect(menu, zoomRect)
    }
    // Before bounds arrive the menu is still invisible; keep overlays stable
    // instead of hiding and immediately showing them again.
  }

  void window.browserdeck
    .setCanvasOverlayVisibility({ minimap: minimapVisible, zoom: zoomVisible })
    .catch(() => undefined)
  if (minimapVisible || zoomVisible) {
    scheduleCanvasMinimapState(0)
  }
}

function onCanvasMinimapAction(action: CanvasMinimapAction): void {
  if (layoutMode.value !== 'canvas') {
    return
  }
  if (isBottomBarMenu()) {
    closeAppMenu(false)
  }
  if (action.type === 'focus') {
    focusCanvasPane(action.paneId)
    return
  }
  if (action.type === 'recenter') {
    recenterCanvasAt(action.x, action.y)
    return
  }
  if (action.type === 'collapse') {
    return
  }
  fitCanvasToPanes()
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="button"]'
    ) !== null
  )
}

function setSpaceHandMode(active: boolean): void {
  if (spaceHandMode.value === active) {
    return
  }
  spaceHandMode.value = active
  void nextTick(scheduleMeasure)
}

function onCanvasSpaceDown(event: KeyboardEvent): void {
  if (
    event.code !== 'Space' ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return
  }
  if (
    layoutMode.value !== 'canvas' ||
    workspacesOpen.value ||
    bulkDialogOpen.value ||
    devicePaletteOpen.value ||
    isEditableTarget(event.target)
  ) {
    return
  }
  event.preventDefault()
  setSpaceHandMode(true)
}

function onCanvasSpaceUp(event: KeyboardEvent): void {
  if (event.code !== 'Space' || !spaceHandMode.value) {
    return
  }
  event.preventDefault()
  setSpaceHandMode(false)
}

const selectModifierKey = navigator.platform.startsWith('Mac') ? 'Meta' : 'Control'

function onCanvasSelectDown(event: KeyboardEvent): void {
  if (
    event.key !== selectModifierKey ||
    event.repeat ||
    event.defaultPrevented ||
    event.isComposing ||
    layoutMode.value !== 'canvas' ||
    workspacesOpen.value ||
    bulkDialogOpen.value ||
    devicePaletteOpen.value ||
    appMenuMode.value !== null ||
    isEditableTarget(event.target) ||
    canvasHandActive.value
  ) {
    return
  }
  if (!temporarySelectMode.value) {
    temporarySelectMode.value = true
    void nextTick(scheduleMeasure)
  }
}

function onCanvasSelectUp(event: KeyboardEvent): void {
  if (event.key !== selectModifierKey || !temporarySelectMode.value) {
    return
  }
  temporarySelectMode.value = false
  void nextTick(scheduleMeasure)
}

function onWindowBlur(): void {
  setSpaceHandMode(false)
  temporarySelectMode.value = false
}

function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return (
    value === 'n' ||
    value === 's' ||
    value === 'e' ||
    value === 'w' ||
    value === 'ne' ||
    value === 'nw' ||
    value === 'se' ||
    value === 'sw'
  )
}

function buildWorkspaceLayout(): WorkspaceLayout {
  const ids = new Set(panes.value.map((pane) => pane.id))
  // Copy geometry into plain objects. Vue's reactive proxies cannot cross the
  // IPC structured-clone boundary.
  const freeform = Object.fromEntries(
    Object.entries(freeformGeometries.value)
      .filter(([paneId]) => ids.has(paneId))
      .map(([paneId, rect]) => [
        paneId,
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      ])
  )
  const canvas = Object.fromEntries(
    orderedPanes.value.flatMap((pane) => {
      if (!ids.has(pane.id)) {
        return []
      }
      const position = canvasPositions.value[pane.id] ?? defaultCanvasLayout.value[pane.id]
      return position ? [[pane.id, { x: position.x, y: position.y }]] : []
    })
  )
  const view = canvasViewReady
    ? {
        pan: {
          x: Math.round(canvasPan.value.x),
          y: Math.round(canvasPan.value.y)
        },
        zoom: canvasZoom.value,
        activePaneId:
          activePaneId.value && ids.has(activePaneId.value) ? activePaneId.value : null
      }
    : undefined
  return {
    mode: 'canvas',
    columns: gridColumns.value,
    gridOrder: paneOrder.value.filter((paneId) => ids.has(paneId)),
    freeform,
    freeformOrder: freeformOrder.value.filter((paneId) => ids.has(paneId)),
    canvas,
    ...(view ? { view } : {})
  }
}

function scheduleCanvasViewSave(): void {
  if (!layoutPersistenceReady || !canvasViewReady) {
    return
  }
  if (canvasViewSaveTimer !== null) {
    clearTimeout(canvasViewSaveTimer)
  }
  canvasViewSaveTimer = setTimeout(() => {
    canvasViewSaveTimer = null
    void saveWorkspaceLayout()
  }, CANVAS_VIEW_SAVE_DELAY)
}

function saveCanvasViewNow(): void {
  if (!layoutPersistenceReady || !canvasViewReady) {
    return
  }
  if (canvasViewSaveTimer !== null) {
    clearTimeout(canvasViewSaveTimer)
    canvasViewSaveTimer = null
  }
  void saveWorkspaceLayout()
}

function flushCanvasView(): void {
  saveCanvasViewNow()
}

async function saveWorkspaceLayout(): Promise<void> {
  if (!layoutPersistenceReady || !canvasViewReady) {
    return
  }

  const layout = buildWorkspaceLayout()
  const key = JSON.stringify(layout)
  if (key === lastSavedLayoutKey) {
    return
  }
  lastSavedLayoutKey = key

  try {
    const result = await window.browserdeck.saveWorkspaceLayout(layout)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not save the workspace layout.'
  }
}

function applyPersistedLayout(layout: WorkspaceLayout): void {
  const ids = new Set(panes.value.map((pane) => pane.id))
  const idsInOrder = panes.value.map((pane) => pane.id)
  const appendMissing = (order: readonly string[]): string[] => {
    const retained = order.filter((paneId) => ids.has(paneId))
    const retainedSet = new Set(retained)
    return [...retained, ...idsInOrder.filter((paneId) => !retainedSet.has(paneId))]
  }

  layoutMode.value = 'canvas'
  gridColumns.value = Math.min(
    GRID_MAX_COLUMNS,
    Math.max(GRID_MIN_COLUMNS, Math.round(layout.columns) || DEFAULT_GRID_COLUMNS)
  )
  paneOrder.value = appendMissing(layout.gridOrder)
  freeformGeometries.value = Object.fromEntries(
    Object.entries(layout.freeform).filter(([paneId]) => ids.has(paneId))
  )
  freeformOrder.value = appendMissing(layout.freeformOrder)
  canvasPositions.value = Object.fromEntries(
    Object.entries(layout.canvas ?? {}).filter(([paneId]) => ids.has(paneId))
  )
  if (layout.view) {
    canvasPan.value = { x: layout.view.pan.x, y: layout.view.pan.y }
    canvasZoom.value = layout.view.zoom
    syncCanvasZoomToMain(layout.view.zoom)
    canvasViewReady = true
    // Recreated native views can emit incidental focus events while the
    // window is showing; keep the restored selection until that settles.
    suppressPaneFocusUntil = Date.now() + 1000
    if (layout.view.activePaneId && ids.has(layout.view.activePaneId)) {
      activePaneId.value = layout.view.activePaneId
      paneSelectionCleared.value = false
    } else {
      activePaneId.value = null
      paneSelectionCleared.value = true
    }
  } else {
    canvasViewReady = false
  }
}

function applyThemeToDocument(): void {
  document.documentElement.dataset.theme = resolvedTheme.value
}

function applyState(state: ShellState): void {
  themePreference.value = state.theme
  resolvedTheme.value = state.resolvedTheme
  applyThemeToDocument()
  const workspaceChanged = currentWorkspaceId.value !== state.workspace.id
  if (workspaceChanged) {
    pendingDuplicatePlacement = null
    selectionToolActive.value = false
    temporarySelectMode.value = false
    selectedPaneIds.value = new Set()
    cancelMarqueeSelection()
    clearCanvasGuides()
    currentWorkspaceId.value = state.workspace.id
    paneOrder.value = []
    freeformGeometries.value = {}
    freeformOrder.value = []
    canvasPositions.value = {}
    canvasPan.value = { x: 0, y: 0 }
    canvasZoom.value = 1
    syncCanvasZoomToMain(1)
    syncCanvasMinimapVisibility()
    canvasHandMode.value = false
    spaceHandMode.value = false
    isCanvasPanning.value = false
    isCanvasPaneDragging.value = false
    canvasDrag.value = null
    canvasPaneDrag.value = null
    document.body.classList.remove('browserdeck-canvas-panning')
    document.body.classList.remove('browserdeck-canvas-pane-dragging')
    paneSnapshots.value = {}
    clearAllPaneNotices()
    devicePaletteOpen.value = false
    devicePaletteQuery.value = ''
    devicePaletteIndex.value = 0
    layoutMode.value = 'canvas'
    gridColumns.value = DEFAULT_GRID_COLUMNS
    activePaneId.value = null
    paneSelectionCleared.value = false
    layoutRestored = false
    layoutPersistenceReady = false
    canvasViewReady = false
    if (canvasViewSaveTimer !== null) {
      clearTimeout(canvasViewSaveTimer)
      canvasViewSaveTimer = null
    }
    suspendedPaneIds.value = new Set()
  }
  const previousIds = new Set(panes.value.map((pane) => pane.id))
  const addedPane =
    !workspaceChanged && focusManagementEnabled && state.panes.length > panes.value.length
      ? state.panes.find((pane) => !previousIds.has(pane.id))
      : undefined
  const removedPane =
    !workspaceChanged && focusManagementEnabled && state.panes.length < panes.value.length
  const duplicatePlacement =
    addedPane &&
    pendingDuplicatePlacement &&
    state.panes.some((pane) => pane.id === pendingDuplicatePlacement?.sourcePaneId)
      ? pendingDuplicatePlacement
      : null
  if (addedPane) {
    pendingDuplicatePlacement = null
  }

  const nextIds = new Set(state.panes.map((pane) => pane.id))
  if (selectedPaneIds.value.size > 0) {
    const retainedSelection = [...selectedPaneIds.value].filter((paneId) =>
      nextIds.has(paneId)
    )
    if (retainedSelection.length !== selectedPaneIds.value.size) {
      selectedPaneIds.value = new Set(retainedSelection)
    }
  }
  for (const paneId of Object.keys(paneNotices.value)) {
    if (!nextIds.has(paneId)) {
      clearPaneNotice(paneId)
    }
  }
  const retained = paneOrder.value.filter((paneId) => nextIds.has(paneId))
  const retainedIds = new Set(retained)
  const appended = state.panes
    .map((pane) => pane.id)
    .filter((paneId) => !retainedIds.has(paneId))
  paneOrder.value = [...retained, ...appended]

  const retainedZ = freeformOrder.value.filter((paneId) => nextIds.has(paneId))
  const retainedZIds = new Set(retainedZ)
  const appendedZ = state.panes
    .map((pane) => pane.id)
    .filter((paneId) => !retainedZIds.has(paneId))
  freeformOrder.value = [...retainedZ, ...appendedZ]

  if (activePaneId.value && !nextIds.has(activePaneId.value)) {
    activePaneId.value = null
    paneSelectionCleared.value = false
  }
  if (addedPane) {
    selectPane(addedPane.id)
  }
  if (!activePaneId.value && !paneSelectionCleared.value) {
    selectPane(state.panes[0]?.id ?? null)
  }

  panes.value = state.panes
  if (
    !layoutRestored &&
    (state.panes.length > 0 || state.layout.gridOrder.length === 0)
  ) {
    applyPersistedLayout(state.layout)
    layoutRestored = true
  }
  if (addedPane && duplicatePlacement && layoutMode.value === 'canvas') {
    canvasPositions.value = {
      ...canvasPositions.value,
      [addedPane.id]: duplicatePlacement.position
    }
  }
  void nextTick(() => {
    if (layoutMode.value === 'freeform') {
      ensureFreeformGeometry()
    }
    if (layoutMode.value === 'canvas') {
      ensureCanvasPositions()
    }
    syncCanvasMinimapVisibility()
    if (workspaceChanged) {
      // The target workspace already has persisted layout state. Re-enable
      // saves without writing it back during the switch.
      layoutPersistenceReady = true
      if (canvasViewReady) {
        scheduleCanvasViewSave()
      }
    }
    if (addedPane) {
      if (layoutMode.value === 'canvas') {
        revealCanvasPane(addedPane.id)
      }
      focusPaneAddress(addedPane.id)
    } else if (removedPane && document.activeElement === document.body) {
      recoverFocus()
    }
    if (workspaceChanged) {
      // Let the first camera fit decide the frame sizes before native views are
      // measured and their first navigation starts.
      requestAnimationFrame(() => {
        restoreCanvasViewWhenReady()
        scheduleMeasure()
      })
    } else {
      scheduleMeasure()
    }
  })
}

async function runAddPane(add: () => Promise<ScriptResult>): Promise<void> {
  if (addingPane.value) {
    return
  }
  addingPane.value = true
  actionError.value = null
  try {
    const result = await add()
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not add a browser.'
  } finally {
    addingPane.value = false
  }
}

async function addPaneWithViewport(preset: ViewportPresetId): Promise<void> {
  await runAddPane(() => window.browserdeck.addPaneWithViewport(viewportFromPreset(preset)))
}

async function prepareMenuSnapshots(): Promise<void> {
  if (layoutMode.value !== 'canvas' || panes.value.length === 0) {
    return
  }
  if (Object.keys(paneSnapshots.value).length === 0) {
    await refreshPaneSnapshots().catch(() => undefined)
  }
}

async function openAppMenu(
  mode:
    | 'add'
    | 'canvas'
    | 'zoom'
    | 'appearance'
    | 'arrange'
    | 'pane'
    | 'viewport'
    | 'clear-site-data'
    | 'workspace'
    | 'selection',
  anchor: { x: number; y: number; align: 'start' | 'end' | 'center' },
  returnFocus: Element | null
): Promise<void> {
  if (bulkDialogOpen.value || (workspacesOpen.value && mode !== 'workspace')) {
    return
  }
  if (mode !== 'pane' && mode !== 'viewport' && mode !== 'clear-site-data') {
    paneMenuPaneId.value = null
  }
  await prepareMenuSnapshots()
  actionError.value = null
  appMenuReturnFocus = returnFocus instanceof HTMLElement ? returnFocus : null
  appMenuAnchor.value = anchor
  appMenuBounds.value = null
  appMenuMode.value = mode
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
}

async function openAddMenu(event: MouseEvent): Promise<void> {
  const button = event.currentTarget
  if (button instanceof HTMLElement) {
    await openAddMenuAt(button)
  }
}

function openAddMenuFromCommand(): void {
  const button = document.querySelector<HTMLButtonElement>('.toolbar .add-pane-button')
  if (button) {
    void openAddMenuAt(button)
  }
}

async function openAddMenuAt(button: HTMLElement): Promise<void> {
  if (addingPane.value || bulkDialogOpen.value) {
    return
  }
  const rect = button.getBoundingClientRect()
  const inToolbar = button.closest('.toolbar') !== null
  await openAppMenu(
    'add',
    {
      x: inToolbar ? rect.right : rect.left,
      y: rect.bottom + 6,
      align: inToolbar ? 'end' : 'start'
    },
    button
  )
}

function openBulkDialog(): void {
  if (bulkDialogOpen.value) {
    return
  }
  const activeElement = document.activeElement
  bulkReturnFocus =
    activeElement instanceof HTMLElement && !activeElement.closest('.app-menu')
      ? activeElement
      : document.querySelector<HTMLElement>('.toolbar .add-pane-button')
  const source = activePane.value?.viewport ?? readLastBulkViewport() ?? RESPONSIVE_VIEWPORT
  bulkUrlsText.value = ''
  bulkError.value = null
  bulkBusy.value = false
  bulkViewportPreset.value = source.preset
  bulkCustomViewport.value = source.preset === 'custom' ? { ...source } : null
  bulkDialogOpen.value = true
  void nextTick(() => {
    bulkTextarea.value?.focus()
    scheduleMeasure()
    syncCanvasMinimapVisibility()
  })
}

function closeBulkDialog(restoreFocus = true): void {
  if (bulkBusy.value) {
    return
  }
  bulkDialogOpen.value = false
  bulkError.value = null
  const target = bulkReturnFocus
  bulkReturnFocus = null
  void nextTick(() => {
    scheduleMeasure()
    syncCanvasMinimapVisibility()
    if (restoreFocus) {
      target?.focus()
    }
  })
}

function onBulkDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeBulkDialog()
    return
  }
  if (event.key !== 'Tab') {
    return
  }
  const dialog = bulkDialogEl.value
  if (!dialog) {
    return
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea, select, input, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden)
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

async function createBulkBrowsers(): Promise<void> {
  if (bulkBusy.value) {
    return
  }
  const parsed = bulkParseResult.value
  if (!parsed.ok) {
    bulkError.value = parsed.error
    return
  }
  bulkBusy.value = true
  bulkError.value = null
  const viewport = bulkSelectedViewport.value
  let created = 0
  try {
    for (const url of parsed.urls) {
      const result = await window.browserdeck.addPaneWithViewport(viewport, url)
      if (!result.ok) {
        if (created > 0) {
          bulkUrlsText.value = parsed.urls.slice(created).join('\n')
        }
        bulkError.value =
          created > 0
            ? `Added ${created} of ${parsed.urls.length} browsers. ${result.error}`
            : result.error
        return
      }
      created += 1
    }
    persistBulkViewport(viewport)
    bulkBusy.value = false
    closeBulkDialog()
    const state = await window.browserdeck.getState()
    applyState(state)
    await nextTick()
    fitCanvasToPanes()
  } catch {
    bulkError.value =
      created > 0
        ? `Added ${created} of ${parsed.urls.length} browsers. Could not add the next browser.`
        : 'Could not open the browsers.'
  } finally {
    bulkBusy.value = false
  }
}

async function openClearSiteDataConfirm(paneId: string): Promise<void> {
  if (!panes.value.some((pane) => pane.id === paneId)) {
    return
  }
  paneMenuPaneId.value = paneId
  await openAppMenu('clear-site-data', appMenuAnchor.value, null)
}

async function clearPaneSiteData(paneId: string): Promise<void> {
  actionError.value = null
  try {
    const result = await window.browserdeck.clearPaneSiteData(paneId)
    if (!result.ok) {
      actionError.value = result.error
      return
    }
    showPaneNotice({ paneId, message: 'Site data cleared' })
  } catch {
    actionError.value = 'Could not clear the browser data.'
  }
}

async function openViewportMenu(paneId: string, trigger: HTMLElement): Promise<void> {
  if (!panes.value.some((pane) => pane.id === paneId)) {
    return
  }
  paneMenuPaneId.value = paneId
  const rect = trigger.getBoundingClientRect()
  await openAppMenu(
    'viewport',
    { x: rect.left, y: rect.bottom + 6, align: 'start' },
    trigger
  )
}

async function openWorkspaceMenu(workspace: WorkspaceSummary, trigger: HTMLElement): Promise<void> {
  workspaceMenuId.value = workspace.id
  const rect = trigger.getBoundingClientRect()
  await openAppMenu(
    'workspace',
    { x: rect.right, y: rect.bottom + 4, align: 'end' },
    trigger
  )
}

function openSelectionMenu(event: MouseEvent): void {
  const trigger = event.currentTarget
  if (!(trigger instanceof HTMLElement) || selectedPaneIds.value.size === 0) {
    return
  }
  const rect = trigger.getBoundingClientRect()
  void openAppMenu(
    'selection',
    { x: rect.left, y: rect.bottom + 6, align: 'start' },
    trigger
  )
}

async function setSelectedViewport(preset: ViewportPresetId): Promise<void> {
  if (preset === 'custom') {
    return
  }
  const ids = [...selectedPaneIds.value]
  if (ids.length === 0) {
    return
  }
  const viewport = viewportFromPreset(preset)
  actionError.value = null
  try {
    const results = await Promise.all(
      ids.map((paneId) => window.browserdeck.setPaneViewport(paneId, viewport))
    )
    const failure = results.find((result) => !result.ok)
    if (failure && !failure.ok) {
      actionError.value = failure.error
    }
  } catch {
    actionError.value = 'Could not change the selected browser viewports.'
  }
}

async function reloadSelectedBrowsers(): Promise<void> {
  const ids = [...selectedPaneIds.value]
  if (ids.length === 0) {
    return
  }
  actionError.value = null
  try {
    const results = await Promise.all(ids.map((paneId) => window.browserdeck.reload(paneId)))
    const failure = results.find((result) => !result.ok)
    if (failure && !failure.ok) {
      actionError.value = failure.error
    }
  } catch {
    actionError.value = 'Could not reload the selected browsers.'
  }
}

function onWorkspaceMenuClick(workspace: WorkspaceSummary, event: MouseEvent): void {
  const trigger = event.currentTarget
  if (trigger instanceof HTMLElement) {
    void openWorkspaceMenu(workspace, trigger)
  }
}

function closeAppMenu(restoreFocus = true): void {
  if (!appMenuMode.value) {
    return
  }
  appMenuMode.value = null
  appMenuBounds.value = null
  paneMenuPaneId.value = null
  workspaceMenuId.value = null
  const target = appMenuReturnFocus
  appMenuReturnFocus = null
  syncCanvasMinimapVisibility()
  void nextTick(() => {
    scheduleMeasure()
    if (restoreFocus) {
      target?.focus()
    }
  })
}

function onAppMenuBounds(bounds: Rect): void {
  appMenuBounds.value = bounds
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
}

async function applyMenuTheme(theme: ThemePreference): Promise<void> {
  actionError.value = null
  try {
    const result = await window.browserdeck.setTheme(theme)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not apply the theme.'
  }
}

function openCanvasZoomMenu(): void {
  if (workspacesOpen.value || layoutMode.value !== 'canvas') {
    return
  }
  void openAppMenu(
    'zoom',
    {
      x: window.innerWidth / 2,
      y: window.innerHeight - CANVAS_ZOOM_MARGIN - CANVAS_ZOOM_BAR_HEIGHT - 6,
      align: 'center'
    },
    null
  )
}

function openCanvasAppearanceMenu(): void {
  if (workspacesOpen.value || layoutMode.value !== 'canvas') {
    return
  }
  void openAppMenu(
    'appearance',
    {
      x: window.innerWidth / 2,
      y: window.innerHeight - CANVAS_ZOOM_MARGIN - CANVAS_ZOOM_BAR_HEIGHT - 6,
      align: 'center'
    },
    null
  )
}

function openCanvasArrangeMenu(): void {
  if (workspacesOpen.value || layoutMode.value !== 'canvas') {
    return
  }
  void openAppMenu(
    'arrange',
    {
      x: window.innerWidth / 2,
      y: window.innerHeight - CANVAS_ZOOM_MARGIN - CANVAS_ZOOM_BAR_HEIGHT - 6,
      align: 'center'
    },
    null
  )
}

function arrangeCanvas(mode: CanvasArrangeMode): void {
  if (layoutMode.value !== 'canvas' || orderedPanes.value.length === 0) {
    return
  }
  const frames = orderedPanes.value.map((pane) => ({
    id: pane.id,
    ...canvasFrameSize(pane.viewport)
  }))
  canvasPositions.value = arrangeCanvasFrames(frames, mode)
  void nextTick(() => {
    fitCanvasToPanes()
    scheduleMeasure()
  })
}

async function runPaneMenuAction(paneId: string, action: string): Promise<void> {
  actionError.value = null
  try {
    switch (action) {
      case 'back':
        await window.browserdeck.back(paneId)
        break
      case 'forward':
        await window.browserdeck.forward(paneId)
        break
      case 'reload':
        await window.browserdeck.reload(paneId)
        break
      case 'copy-url': {
        const result = await window.browserdeck.copyPaneUrl(paneId)
        if (!result.ok) {
          actionError.value = result.error
        }
        break
      }
      case 'external':
        await openPaneExternal(paneId)
        break
      case 'rotate': {
        const result = await window.browserdeck.rotatePaneViewport(paneId)
        if (!result.ok) {
          actionError.value = result.error
        }
        break
      }
      case 'screenshot': {
        const result = await window.browserdeck.capturePaneScreenshot(paneId)
        if (!result.ok) {
          actionError.value = result.error
        }
        break
      }
      case 'duplicate':
        await duplicatePane(paneId)
        break
      case 'rename':
        requestPaneRename(paneId)
        break
      case 'clear-site-data':
        openClearSiteDataConfirm(paneId)
        break
      case 'devtools': {
        const result = await window.browserdeck.openPaneDevTools(paneId)
        if (!result.ok) {
          actionError.value = result.error
        }
        break
      }
      case 'close':
        await closePane(paneId)
        break
    }
  } catch {
    actionError.value = 'Could not complete the browser action.'
  }
}

function onAppMenuSelect(id: string): void {
  if (id.startsWith('workspace-menu:')) {
    const workspace = workspaces.value.find((entry) => entry.id === workspaceMenuId.value)
    const action = id.slice('workspace-menu:'.length)
    closeAppMenu()
    if (!workspace) {
      return
    }
    if (action === 'switch') {
      void switchToWorkspace(workspace)
    } else if (action === 'rename') {
      startWorkspaceRename(workspace)
    } else if (action === 'duplicate') {
      void duplicateWorkspace(workspace)
    } else if (action === 'delete') {
      requestWorkspaceDelete(workspace)
    }
    return
  }

  if (id === 'bulk:open') {
    closeAppMenu(false)
    openBulkDialog()
    return
  }

  if (id.startsWith('selection:viewport:')) {
    const preset = id.slice('selection:viewport:'.length)
    closeAppMenu()
    if (isViewportPresetId(preset)) {
      void setSelectedViewport(preset)
    }
    return
  }

  if (id.startsWith('pane:')) {
    const paneId = paneMenuPaneId.value
    closeAppMenu(false)
    if (paneId) {
      void runPaneMenuAction(paneId, id.slice('pane:'.length))
    }
    return
  }

  if (id.startsWith('clear-site-data:')) {
    const paneId = paneMenuPaneId.value
    closeAppMenu(false)
    if (id === 'clear-site-data:confirm' && paneId) {
      void clearPaneSiteData(paneId)
    }
    return
  }

  if (id.startsWith('zoom:')) {
    closeAppMenu(false)
    const value = id.slice('zoom:'.length)
    if (value === 'fit') {
      fitCanvasToPanes()
      return
    }
    if (value === 'reset') {
      zoomCanvasAtCenter(1)
      return
    }
    const zoom = Number(value)
    if (Number.isFinite(zoom)) {
      zoomCanvasAtCenter(zoom)
    }
    return
  }

  if (id.startsWith('arrange:')) {
    const mode = id.slice('arrange:'.length)
    closeAppMenu(false)
    if (mode === 'showcase' || mode === 'row' || mode === 'grid' || mode === 'stack') {
      arrangeCanvas(mode)
    }
    return
  }

  if (id === 'open-add-menu') {
    appMenuBounds.value = null
    appMenuMode.value = 'add'
    syncCanvasMinimapVisibility()
    void nextTick(scheduleMeasure)
    return
  }

  if (id.startsWith('viewport:')) {
    const preset = id.slice('viewport:'.length)
    const pane = viewportMenuPane.value
    if (preset === 'custom') {
      closeAppMenu(false)
      if (pane) {
        requestCustomViewport(pane.id)
      }
      return
    }
    if (pane && isViewportPresetId(preset)) {
      closeAppMenu()
      void setPaneViewport(pane.id, viewportFromPreset(preset))
    }
    return
  }

  if (id.startsWith('preset:')) {
    const preset = id.slice('preset:'.length)
    if (!isViewportPresetId(preset)) {
      return
    }
    closeAppMenu(false)
    void addPaneWithViewport(preset)
    return
  }

  const opensDialog = id === 'open-workspaces'
  closeAppMenu(!opensDialog)

  switch (id) {
    case 'fit-all':
      fitCanvasToPanes()
      break
    case 'reset-zoom':
      resetCanvasZoom()
      break
    case 'toggle-hand':
      toggleCanvasHand()
      break
    case 'open-workspaces':
      openWorkspaces()
      break
    case 'theme:system':
      void applyMenuTheme('system')
      break
    case 'theme:light':
      void applyMenuTheme('light')
      break
    case 'theme:dark':
      void applyMenuTheme('dark')
      break
  }
}

async function openPaneExternal(paneId: string): Promise<void> {
  actionError.value = null
  try {
    const result = await window.browserdeck.openPaneExternal(paneId)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not open the browser.'
  }
}

async function duplicatePane(paneId: string): Promise<void> {
  actionError.value = null
  const sourceFrame =
    layoutMode.value === 'canvas' ? canvasFrames.value.get(paneId) : undefined
  if (sourceFrame) {
    const targets = [...canvasFrames.value.entries()]
      .filter(([id]) => id !== paneId)
      .map(([, frame]) => frame)
    pendingDuplicatePlacement = {
      sourcePaneId: paneId,
      position: duplicateCanvasPosition(sourceFrame, targets)
    }
  } else {
    pendingDuplicatePlacement = null
  }
  try {
    const result = await window.browserdeck.duplicatePane(paneId)
    if (!result.ok) {
      pendingDuplicatePlacement = null
      actionError.value = result.error
    }
  } catch {
    pendingDuplicatePlacement = null
    actionError.value = 'Could not duplicate the browser.'
  }
}

async function closePane(paneId: string): Promise<void> {
  actionError.value = null
  try {
    const result = await window.browserdeck.closePane(paneId)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not close the browser.'
  }
}

function formatProfileDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : profileDateFormatter.format(date)
}

function focusAfterDialog(): void {
  const input = activePaneId.value
    ? document.querySelector<HTMLInputElement>(
        `[data-pane-id="${activePaneId.value}"] .address-input`
      )
    : document.querySelector<HTMLInputElement>('.pane-card .address-input')
  if (input) {
    input.focus()
    return
  }
  document.querySelector<HTMLButtonElement>('.toolbar .add-pane-button')?.focus()
}

function ensureDevicePaletteSelectionVisible(): void {
  void nextTick(() => {
    document
      .getElementById(`device-palette-option-${devicePaletteIndex.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function openDevicePalette(): void {
  if (workspacesOpen.value || bulkDialogOpen.value || appMenuMode.value !== null) {
    return
  }
  if (devicePaletteOpen.value) {
    devicePaletteInput.value?.focus()
    devicePaletteInput.value?.select()
    return
  }
  devicePaletteOpen.value = true
  devicePaletteQuery.value = ''
  devicePaletteIndex.value = 0
  void nextTick(() => {
    scheduleMeasure()
    devicePaletteInput.value?.focus()
  })
}

function closeDevicePalette(restoreFocus = true): void {
  if (!devicePaletteOpen.value) {
    return
  }
  devicePaletteOpen.value = false
  devicePaletteQuery.value = ''
  devicePaletteIndex.value = 0
  void nextTick(() => {
    scheduleMeasure()
    if (restoreFocus) {
      focusAfterDialog()
    }
  })
}

function chooseDevicePaletteResult(result: DevicePaletteResult | null): void {
  if (!result) {
    return
  }
  const paneId = result.pane.id
  closeDevicePalette(false)
  void nextTick(async () => {
    focusCanvasPane(paneId)
    await nextTick()
    focusPaneAddress(paneId)
  })
}

function onDevicePaletteKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDevicePalette()
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    devicePaletteInput.value?.focus()
    return
  }
  if (event.isComposing || event.keyCode === 229) {
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = devicePaletteResults.value.length
    if (count === 0) {
      return
    }
    const offset = event.key === 'ArrowDown' ? 1 : -1
    devicePaletteIndex.value =
      (devicePaletteIndex.value + offset + count) % count
    ensureDevicePaletteSelectionVisible()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    chooseDevicePaletteResult(devicePaletteSelected.value)
  }
}

watch(devicePaletteQuery, () => {
  devicePaletteIndex.value = 0
  ensureDevicePaletteSelectionVisible()
})

watch(devicePaletteResults, (results) => {
  if (devicePaletteIndex.value >= results.length) {
    devicePaletteIndex.value = Math.max(0, results.length - 1)
  }
})

async function refreshWorkspaces(): Promise<void> {
  workspacesLoading.value = true
  workspaceError.value = null
  try {
    const result = await window.browserdeck.listWorkspaces()
    if (result.ok) {
      workspaces.value = result.workspaces
    } else {
      workspaceError.value = result.error
    }
  } catch {
    workspaceError.value = 'Could not read workspaces.'
  } finally {
    workspacesLoading.value = false
  }
}

function openWorkspaces(): void {
  if (workspacesOpen.value || bulkDialogOpen.value) {
    return
  }
  workspacesOpen.value = true
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = null
  newWorkspaceName.value = ''
  void refreshWorkspaces()
  void nextTick(() => {
    scheduleMeasure()
    workspacesDialogEl.value?.focus()
  })
}

function closeWorkspaces(): void {
  if (appMenuMode.value === 'workspace') {
    closeAppMenu(false)
  }
  workspaceMenuId.value = null
  workspacesOpen.value = false
  workspaces.value = []
  workspacesLoading.value = false
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = null
  newWorkspaceName.value = ''
  void nextTick(() => {
    scheduleMeasure()
    focusAfterDialog()
  })
}

async function importWorkspaceFile(): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  workspaceNotice.value = null
  try {
    const result = await window.browserdeck.importWorkspace()
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    if (!result.canceled) {
      workspaceNotice.value = result.workspaceName
        ? `Imported “${result.workspaceName}”.`
        : 'Imported workspace.'
      await refreshWorkspaces()
    }
  } catch {
    workspaceError.value = 'Could not import the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function exportActiveWorkspace(): Promise<void> {
  const active = workspaces.value.find((workspace) => workspace.active)
  if (!active || workspaceBusy.value) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  workspaceNotice.value = null
  try {
    const result = await window.browserdeck.exportWorkspace(active.id)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    if (!result.canceled) {
      workspaceNotice.value = `Exported “${active.name}”.`
    }
  } catch {
    workspaceError.value = 'Could not export the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function createWorkspace(): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  const name = newWorkspaceName.value.trim()
  if (!name) {
    workspaceError.value = 'Enter a workspace name.'
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.browserdeck.createWorkspace(name)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    newWorkspaceName.value = ''
    workspaceNotice.value = `Created workspace “${name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not create the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

function startWorkspaceRename(workspace: WorkspaceSummary): void {
  if (workspaceBusy.value) {
    return
  }
  workspaceError.value = null
  workspaceNotice.value = null
  workspaceDeleteId.value = null
  renamingWorkspaceId.value = workspace.id
  workspaceRenameDraft.value = workspace.name
  void nextTick(() => {
    const input = workspacesDialogEl.value?.querySelector<HTMLInputElement>(
      '.workspace-rename-input'
    )
    input?.focus()
    input?.select()
  })
}

function cancelWorkspaceRename(): void {
  renamingWorkspaceId.value = null
  workspaceRenameDraft.value = ''
  workspaceError.value = null
}

async function submitWorkspaceRename(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  const name = workspaceRenameDraft.value.trim()
  if (!name) {
    workspaceError.value = 'Enter a workspace name.'
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.browserdeck.renameWorkspace(workspace.id, name)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    renamingWorkspaceId.value = null
    workspaceRenameDraft.value = ''
    workspaceNotice.value = `Renamed workspace to “${name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not rename the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

function requestWorkspaceDelete(workspace: WorkspaceSummary): void {
  if (workspaceBusy.value || workspace.active || workspaces.value.length <= 1) {
    return
  }
  workspaceError.value = null
  workspaceNotice.value = null
  renamingWorkspaceId.value = null
  workspaceDeleteId.value = workspace.id
}

function cancelWorkspaceDelete(): void {
  workspaceDeleteId.value = null
  workspaceError.value = null
}

async function confirmWorkspaceDelete(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value || workspaceDeleteId.value !== workspace.id || workspace.active) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.browserdeck.deleteWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      await refreshWorkspaces()
      return
    }
    workspaceDeleteId.value = null
    workspaceNotice.value = `Deleted workspace “${workspace.name}”.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not delete the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function duplicateWorkspace(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await window.browserdeck.duplicateWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    workspaceNotice.value = `Duplicated “${workspace.name}” as an independent copy.`
    await refreshWorkspaces()
  } catch {
    workspaceError.value = 'Could not duplicate the workspace.'
  } finally {
    workspaceBusy.value = false
  }
}

async function switchToWorkspace(workspace: WorkspaceSummary): Promise<void> {
  if (workspaceBusy.value || workspace.active) {
    return
  }
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    await saveWorkspaceLayout()
    const result = await window.browserdeck.switchWorkspace(workspace.id)
    if (!result.ok) {
      workspaceError.value = result.error
      return
    }
    closeWorkspaces()
    const state = await window.browserdeck.getState()
    applyState(state)
    await nextTick()
    scheduleMeasure()
  } catch {
    workspaceError.value = 'Could not switch workspaces.'
  } finally {
    workspaceBusy.value = false
  }
}

function onWorkspacesKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (appMenuMode.value === 'workspace') {
      return
    }
    if (renamingWorkspaceId.value) {
      cancelWorkspaceRename()
    } else if (workspaceDeleteId.value) {
      cancelWorkspaceDelete()
    } else {
      closeWorkspaces()
    }
    return
  }
  if (event.key !== 'Tab') {
    return
  }
  const dialog = workspacesDialogEl.value
  if (!dialog) {
    return
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  ).filter((element) => element.getClientRects().length > 0)
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.closest('[contenteditable="true"]') !== null
  )
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    workspacesOpen.value ||
    bulkDialogOpen.value ||
    devicePaletteOpen.value ||
    appMenuMode.value !== null
  ) {
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return
  }
  if (isTextEntryTarget(event.target)) {
    return
  }
  if (event.key === 'Escape') {
    if (selectedPaneIds.value.size > 0) {
      event.preventDefault()
      clearPaneSelection()
      return
    }
    if (selectionToolActive.value) {
      event.preventDefault()
      setSelectionToolActive(false)
      return
    }
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }
  if (selectedPaneIds.value.size > 0) {
    event.preventDefault()
    void closeSelectedPanes()
    return
  }
  const pane = currentPane()
  if (!pane) {
    return
  }
  event.preventDefault()
  void closePane(pane.id)
}

async function reloadAll(): Promise<void> {
  actionError.value = null
  const activeBefore = activePaneId.value
  // Reloading every native view can emit incidental focus events. Keep the
  // selected device stable while the bulk reload settles.
  suppressPaneFocusUntil = Date.now() + 1500
  try {
    const result = await window.browserdeck.reloadAll()
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not reload the browsers.'
  } finally {
    if (activeBefore && panes.value.some((pane) => pane.id === activeBefore)) {
      selectPane(activeBefore)
    }
  }
}

async function openPaneMenu(paneId: string, position: { x: number; y: number }): Promise<void> {
  if (workspacesOpen.value) {
    return
  }
  const pane = panes.value.find((entry) => entry.id === paneId)
  if (!pane) {
    return
  }
  paneMenuPaneId.value = paneId
  const trigger = document.querySelector<HTMLElement>(
    `[data-pane-id="${paneId}"] button[aria-label="Browser actions"]`
  )
  await openAppMenu(
    'pane',
    { x: position.x, y: position.y, align: 'end' },
    trigger
  )
}

async function openCanvasMenu(event: MouseEvent): Promise<void> {
  if (workspacesOpen.value) {
    return
  }

  event.preventDefault()
  const target = event.target
  if (target instanceof Element) {
    const paneId = target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId
    if (paneId) {
      await openPaneMenu(paneId, { x: event.clientX, y: event.clientY })
      return
    }
  }

  if (layoutMode.value !== 'canvas') {
    return
  }

  const previous = document.activeElement
  blurActiveShellControl()
  await openAppMenu(
    'canvas',
    { x: event.clientX, y: event.clientY, align: 'start' },
    previous
  )
}

async function setPaneViewport(paneId: string, viewport: PaneViewport): Promise<void> {
  actionError.value = null
  try {
    const result = await window.browserdeck.setPaneViewport(paneId, viewport)
    if (!result.ok) {
      actionError.value = result.error
    }
  } catch {
    actionError.value = 'Could not apply the viewport.'
  }
}

function onPaneLayoutChanged(): void {
  void nextTick(scheduleMeasure)
}

function dismissErrors(): void {
  actionError.value = null
  layoutError.value = null
}

function currentPane(): PaneState | undefined {
  return panes.value.find((pane) => pane.id === activePaneId.value)
}

async function reloadActivePane(): Promise<void> {
  const pane = currentPane()
  if (!pane) {
    await reloadAll()
    return
  }
  await window.browserdeck.reload(pane.id).catch(() => undefined)
}

function handlePaneCommand(command: PaneCommand): void {
  if (workspacesOpen.value) {
    return
  }
  if (devicePaletteOpen.value && command !== 'find-device') {
    return
  }
  const pane = currentPane()
  switch (command) {
    case 'find-device':
      openDevicePalette()
      break
    case 'add-pane':
      openAddMenuFromCommand()
      break
    case 'duplicate-pane':
      if (pane) {
        void duplicatePane(pane.id)
      }
      break
    case 'close-pane':
      if (pane) {
        void closePane(pane.id)
      }
      break
    case 'focus-address': {
      const target = pane ?? orderedPanes.value[0]
      if (target) {
        focusPaneAddress(target.id)
      }
      break
    }
    case 'reload-pane':
      void reloadActivePane()
      break
    case 'reload-all':
      void reloadAll()
      break
    case 'zoom-in':
      zoomCanvasAtCenter(canvasZoom.value + CANVAS_ZOOM_STEP)
      break
    case 'zoom-out':
      zoomCanvasAtCenter(canvasZoom.value - CANVAS_ZOOM_STEP)
      break
    case 'zoom-reset':
      resetCanvasZoom()
      break
    case 'open-workspaces':
      openWorkspaces()
      break
  }
}

function onWorkspaceFocusIn(event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  const paneId = target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId
  if (paneId) {
    selectPane(paneId)
  }
}

function findDropTarget(x: number, y: number, draggedPaneId: string): string | null {
  const workspace = workspaceEl.value
  if (!workspace) {
    return null
  }

  for (const card of workspace.querySelectorAll<HTMLElement>('[data-pane-id]')) {
    const paneId = card.dataset.paneId
    if (!paneId || paneId === draggedPaneId) {
      continue
    }
    const rect = card.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return paneId
    }
  }

  return null
}

function finishDrag(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)

  const state = dragState.value
  const target = dropTargetId.value
  const wasDragging = isDragging.value

  dragState.value = null
  dropTargetId.value = null
  isDragging.value = false
  clearCanvasGuides()
  document.body.classList.remove('browserdeck-dragging')

  if (wasDragging && state?.kind === 'reorder' && target) {
    const fromIndex = paneOrder.value.indexOf(state.paneId)
    const targetIndex = paneOrder.value.indexOf(target)
    if (fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex) {
      const next = reorderPaneIds(paneOrder.value, state.paneId, targetIndex)
      if (next) {
        paneOrder.value = next
      }
    }
  }

  void nextTick(scheduleMeasure)
}

function onPointerMove(event: PointerEvent): void {
  const state = dragState.value
  if (!state) {
    return
  }

  if (!isDragging.value) {
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (distance < 5) {
      return
    }
    isDragging.value = true
    document.body.classList.add('browserdeck-dragging')
    void nextTick(scheduleMeasure)
  }

  event.preventDefault()

  if (state.kind === 'reorder') {
    dropTargetId.value = findDropTarget(event.clientX, event.clientY, state.paneId)
    return
  }

  updateFreeformInteraction(event, state)
}

function onWorkspacePointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (layoutMode.value === 'canvas') {
    if (event.button !== 0 && event.button !== 1) {
      return
    }
    const canvasCard = target.closest('[data-pane-id]')
    if (canvasHandActive.value) {
      beginCanvasPan(event, !(canvasCard instanceof HTMLElement))
      return
    }
    const canvasPaneId =
      canvasCard instanceof HTMLElement ? (canvasCard.dataset.paneId ?? null) : null
    const interactive = target.closest(
      'button, a, input, select, textarea, form, [role="button"]'
    )
    if (selectionModeActive.value) {
      if (event.button !== 0 || interactive) {
        return
      }
      if (canvasPaneId) {
        selectPane(canvasPaneId)
      }
      beginMarqueeSelection(event, canvasPaneId)
      return
    }
    if (!(canvasCard instanceof HTMLElement)) {
      if (!interactive) {
        beginCanvasPan(event, true)
      }
      return
    }
    if (!canvasPaneId) {
      return
    }
    if (interactive || event.button !== 0) {
      selectOnlyPane(canvasPaneId)
      return
    }
    if (target.closest('.pane-header')) {
      beginCanvasPaneDrag(event, canvasPaneId)
      return
    }
    togglePaneSelection(canvasPaneId)
    return
  }

  if (event.button !== 0) {
    return
  }

  const card = target.closest('[data-pane-id]')
  if (!(card instanceof HTMLElement)) {
    return
  }
  const paneId = card.dataset.paneId
  if (!paneId) {
    return
  }
  selectPane(paneId)

  if (layoutMode.value === 'freeform') {
    const resizeTarget = target.closest<HTMLElement>('[data-resize]')
    const handle = resizeTarget?.dataset.resize
    if (isResizeHandle(handle)) {
      const startRect = slotRects.value.get(paneId)
      if (!startRect) {
        return
      }
      raisePane(paneId)
      beginInteraction({
        kind: 'resize',
        paneId,
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        handle
      })
      return
    }
  }

  if (!target.closest('.pane-title-row')) {
    return
  }
  if (target.closest('button, a, input, select, textarea, form, [role="button"]')) {
    return
  }

  if (layoutMode.value === 'freeform') {
    const startRect = slotRects.value.get(paneId)
    if (!startRect) {
      return
    }
    raisePane(paneId)
    beginInteraction({
      kind: 'move',
      paneId,
      startX: event.clientX,
      startY: event.clientY,
      startRect
    })
    return
  }

  beginInteraction({
    kind: 'reorder',
    paneId,
    startX: event.clientX,
    startY: event.clientY
  })
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

function rectsOverlap(a: DOMRect, b: Rect): boolean {
  return (
    a.left < b.x + b.width &&
    a.right > b.x &&
    a.top < b.y + b.height &&
    a.bottom > b.y
  )
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

async function measurePanes(): Promise<void> {
  const workspace = workspaceEl.value
  if (!workspace) {
    return
  }

  const workspaceRect = workspace.getBoundingClientRect()
  if (workspaceRect.width < 1 || workspaceRect.height < 1) {
    return
  }

  const menuOpen = appMenuMode.value !== null
  const menuRect = appMenuBounds.value
  const updates: Array<{
    paneId: string
    rect: { x: number; y: number; width: number; height: number }
    visible: boolean
  }> = []
  const suspended = new Set<string>()

  for (const element of workspace.querySelectorAll<HTMLElement>('[data-pane-content]')) {
    const paneId = element.dataset.paneContent
    if (!paneId) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      continue
    }
    const menuCovers =
      menuOpen && (menuRect === null || rectsOverlap(rect, menuRect))
    const nativeViewsHidden =
      isDragging.value ||
      workspacesOpen.value ||
      bulkDialogOpen.value ||
      devicePaletteOpen.value ||
      isCanvasPanning.value ||
      isCanvasPaneDragging.value ||
      isMarqueeSelecting.value ||
      canvasHandActive.value ||
      menuCovers
    const visible =
      !nativeViewsHidden &&
      isRectFullyVisible(rect, workspaceRect)
    if (!visible && !nativeViewsHidden) {
      suspended.add(paneId)
    }
    updates.push({
      paneId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible
    })
  }

  if (updates.length === 0) {
    updateSuspendedPanes(new Set())
    return
  }

  let result: ScriptResult
  try {
    result = await window.browserdeck.setPaneBounds(updates)
  } catch {
    layoutError.value = 'Could not synchronize browser layout.'
    return
  }

  updateSuspendedPanes(suspended)

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
    if (layoutMode.value === 'freeform') {
      ensureFreeformGeometry()
    } else if (layoutMode.value === 'canvas') {
      ensureCanvasPositions()
    }
    void nextTick(scheduleMeasure)
  }
)

watch(layoutMode, (mode) => {
  clearCanvasGuides()
  dropTargetId.value = null
  isDragging.value = false
  dragState.value = null
  document.body.classList.remove('browserdeck-dragging')
  if (workspaceEl.value) {
    workspaceEl.value.scrollTop = 0
  }

  if (mode === 'freeform') {
    const ids = orderedPanes.value.map((pane) => pane.id)
    const idSet = new Set(ids)
    const retained = freeformOrder.value.filter((paneId) => idSet.has(paneId))
    const retainedSet = new Set(retained)
    freeformOrder.value = [...retained, ...ids.filter((paneId) => !retainedSet.has(paneId))]
  }

  if (mode !== 'canvas') {
    canvasHandMode.value = false
    spaceHandMode.value = false
    isCanvasPanning.value = false
    isCanvasPaneDragging.value = false
    canvasDrag.value = null
    canvasPaneDrag.value = null
    syncCanvasZoomToMain(1)
    window.removeEventListener('pointermove', onCanvasPointerMove)
    window.removeEventListener('pointerup', finishCanvasPan)
    window.removeEventListener('pointercancel', finishCanvasPan)
    window.removeEventListener('pointermove', onCanvasPanePointerMove)
    window.removeEventListener('pointerup', finishCanvasPaneDrag)
    window.removeEventListener('pointercancel', finishCanvasPaneDrag)
    document.body.classList.remove('browserdeck-canvas-panning')
    document.body.classList.remove('browserdeck-canvas-pane-dragging')
  } else {
    syncCanvasZoomToMain(canvasZoom.value)
  }
  syncCanvasMinimapVisibility()

  void nextTick(() => {
    if (mode === 'freeform') {
      ensureFreeformGeometry()
    }
    if (mode === 'canvas') {
      ensureCanvasPositions()
      scheduleSnapshotRefresh(150)
    }
    scheduleMeasure()
  })
})

watch(isDragging, (dragging) => {
  void nextTick(scheduleMeasure)
  if (!dragging) {
    void saveWorkspaceLayout()
  }
})

watch(workspacesOpen, () => {
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
})

watch(devicePaletteOpen, () => {
  syncCanvasMinimapVisibility()
  void nextTick(scheduleMeasure)
})

watch(
  [paneOrder, gridColumns, layoutMode, freeformGeometries, freeformOrder, canvasPositions],
  () => {
    if (!layoutPersistenceReady || isDragging.value || isCanvasPaneDragging.value) {
      return
    }
    void saveWorkspaceLayout()
  }
)

watch(
  () => [canvasPan.value.x, canvasPan.value.y, canvasZoom.value, activePaneId.value] as const,
  () => {
    scheduleCanvasViewSave()
  }
)

watch(
  () => JSON.stringify(canvasMinimapState.value),
  () => {
    scheduleCanvasMinimapState()
  },
  { flush: 'post' }
)

watch(
  () =>
    panes.value
      .map((pane) =>
        [
          pane.id,
          pane.url,
          pane.isLoading,
          pane.viewport.preset,
          pane.viewport.width,
          pane.viewport.height,
          pane.viewport.rotated === true ? 'rotated' : 'upright'
        ].join(':')
      )
      .join('|'),
  () => {
    if (
      layoutMode.value === 'canvas' &&
      !isCanvasPanning.value &&
      !isCanvasPaneDragging.value &&
      !canvasHandActive.value
    ) {
      scheduleSnapshotRefresh(600)
    }
  }
)

watch(resolvedTheme, () => {
  if (layoutMode.value === 'canvas') {
    scheduleSnapshotRefresh(600)
  }
})

onMounted(async () => {
  disposeStateListener = window.browserdeck.onStateChanged(applyState)
  disposeMinimapActionListener = window.browserdeck.onCanvasMinimapAction(
    onCanvasMinimapAction
  )
  disposeZoomActionListener = window.browserdeck.onCanvasZoomAction(
    applyCanvasZoomAction
  )
  void window.browserdeck.setCanvasHandMode(canvasHandActive.value).catch(() => undefined)
  disposeMeasureListener = window.browserdeck.onRequestMeasurement(scheduleMeasure)
  disposeCommandListener = window.browserdeck.onPaneCommand(handlePaneCommand)
  disposeFocusListener = window.browserdeck.onPaneFocused((paneId) => {
    if (Date.now() < suppressPaneFocusUntil) {
      return
    }
    if (panes.value.some((pane) => pane.id === paneId)) {
      selectPane(paneId)
    }
    if (appMenuMode.value !== null) {
      closeAppMenu(false)
    }
  })
  disposeRenameListener = window.browserdeck.onPaneRenameRequested(requestPaneRename)
  disposeNoticeListener = window.browserdeck.onPaneNotice(showPaneNotice)

  resizeObserver = new ResizeObserver(() => {
    readWorkspaceSize()
    scheduleMeasure()
  })
  if (workspaceEl.value) {
    resizeObserver.observe(workspaceEl.value)
  }
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('keydown', onCanvasSpaceDown)
  window.addEventListener('keyup', onCanvasSpaceUp)
  window.addEventListener('keydown', onCanvasSelectDown)
  window.addEventListener('keyup', onCanvasSelectUp)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('beforeunload', flushCanvasView)
  readWorkspaceSize()

  try {
    const initialState = await window.browserdeck.getState()
    applyState(initialState)
    await nextTick()
    if (initialState.panes.length > 0 || initialState.layout.gridOrder.length === 0) {
      layoutPersistenceReady = true
      await saveWorkspaceLayout()
    }
    if (layoutMode.value === 'canvas') {
      scheduleSnapshotRefresh(200)
    }
  } catch {
    actionError.value = 'Could not read browser state.'
  } finally {
    focusManagementEnabled = true
  }
})

onBeforeUnmount(() => {
  disposeStateListener?.()
  disposeMinimapActionListener?.()
  disposeZoomActionListener?.()
  disposeMeasureListener?.()

  disposeCommandListener?.()
  disposeFocusListener?.()
  disposeNoticeListener?.()
  disposeRenameListener?.()
  resizeObserver?.disconnect()
  clearAllPaneNotices()
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', onGlobalKeyDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', finishDrag)
  window.removeEventListener('pointermove', onCanvasPointerMove)
  window.removeEventListener('pointerup', finishCanvasPan)
  window.removeEventListener('pointercancel', finishCanvasPan)
  window.removeEventListener('pointermove', onCanvasPanePointerMove)
  window.removeEventListener('pointerup', finishCanvasPaneDrag)
  window.removeEventListener('pointercancel', finishCanvasPaneDrag)
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', finishMarqueeSelection)
  window.removeEventListener('pointercancel', finishMarqueeSelection)
  window.removeEventListener('keydown', onCanvasSpaceDown)
  window.removeEventListener('keyup', onCanvasSpaceUp)
  window.removeEventListener('keydown', onCanvasSelectDown)
  window.removeEventListener('keyup', onCanvasSelectUp)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('beforeunload', flushCanvasView)
  document.body.classList.remove('browserdeck-dragging')
  document.body.classList.remove('browserdeck-canvas-panning')
  document.body.classList.remove('browserdeck-canvas-pane-dragging')
  document.body.classList.remove('browserdeck-canvas-selecting')
  snapshotRequest += 1
  if (snapshotRefreshTimer !== null) {
    clearTimeout(snapshotRefreshTimer)
    snapshotRefreshTimer = null
  }
  if (canvasWheelEndTimer !== null) {
    clearTimeout(canvasWheelEndTimer)
    canvasWheelEndTimer = null
  }
  if (canvasViewSaveTimer !== null) {
    clearTimeout(canvasViewSaveTimer)
    canvasViewSaveTimer = null
  }
  if (minimapStateTimer !== null) {
    clearTimeout(minimapStateTimer)
    minimapStateTimer = null
  }
  void window.browserdeck.setCanvasMinimapVisible(false).catch(() => undefined)
  if (measureFrame !== 0) {
    window.cancelAnimationFrame(measureFrame)
  }
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'is-dragging': isDragging, 'mac-titlebar': usesMacTitlebar }"
    :data-layout-mode="layoutMode"
  >
    <header class="toolbar">
      <h1 class="sr-only">BrowserDeck</h1>

      <span class="pane-count sr-only" role="status" aria-live="polite">{{ paneCountLabel }}</span>
      <div
        v-if="selectedPaneIds.size > 0"
        class="selection-summary"
        role="status"
        aria-live="polite"
      >
        <span class="selection-count">{{ selectedPaneIds.size }} selected</span>
        <button
          class="selection-viewport"
          type="button"
          :title="`Viewport for ${selectedPaneIds.size} selected browser${selectedPaneIds.size === 1 ? '' : 's'}`"
          :aria-label="`Viewport for ${selectedPaneIds.size} selected browser${selectedPaneIds.size === 1 ? '' : 's'}: ${selectionViewportLabel}`"
          aria-haspopup="menu"
          :aria-expanded="appMenuMode === 'selection'"
          @click="openSelectionMenu"
        >
          {{ selectionViewportLabel }}
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
        <button
          class="icon-button selection-reload"
          type="button"
          :title="`Reload ${selectedPaneIds.size} selected browser${selectedPaneIds.size === 1 ? '' : 's'}`"
          :aria-label="`Reload ${selectedPaneIds.size} selected browser${selectedPaneIds.size === 1 ? '' : 's'}`"
          @click="reloadSelectedBrowsers"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M12.6 6.3A5 5 0 1 0 13 8" />
            <path d="M12.8 3.3v3.2H9.6" />
          </svg>
        </button>
      </div>
      <button
        class="icon-button toolbar-icon add-pane-button"
        type="button"
        title="Add browser"
        aria-label="Add browser"
        aria-haspopup="menu"
        :aria-expanded="appMenuMode === 'add'"
        :disabled="addingPane"
        @click="openAddMenu"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
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

    <main
      ref="workspaceEl"
      class="workspace"
      :class="{
        'workspace-canvas': layoutMode === 'canvas',
        'canvas-panning': isCanvasPanning,
        'canvas-hand': canvasHandActive,
        'canvas-select': selectionModeActive
      }"
      :style="canvasWorkspaceStyle"
      aria-label="Browser workspace"
      @scroll.passive="scheduleMeasure"
      @pointerdown="onWorkspacePointerDown"
      @focusin="onWorkspaceFocusIn"
      @contextmenu.prevent="openCanvasMenu"
      @wheel="onWorkspaceWheel"
    >
      <div
        v-if="orderedPanes.length > 0"
        class="pane-grid"
        :style="{ height: `${paneGridHeight}px` }"
      >
        <div
          v-for="pane in orderedPanes"
          :key="pane.id"
          class="pane-slot"
          :class="{
            'pane-slot-active': activePaneId === pane.id,
            'pane-slot-selected': selectedPaneIds.has(pane.id),
            'pane-slot-dragging': isDragging && dragState?.paneId === pane.id,
            'pane-slot-drop-target': dropTargetId === pane.id
          }"
          :style="paneSlotStyle(pane.id)"
        >
          <PaneCard
            :pane="pane"
            :freeform="layoutMode === 'freeform'"
            :suspended="suspendedPaneIds.has(pane.id)"
            :active="activePaneId === pane.id"
            :rename-request="paneRenameRequests[pane.id] ?? 0"
            :custom-viewport-request="customViewportRequests[pane.id] ?? 0"
            :notice="paneNotices[pane.id]"
            :snapshot="layoutMode === 'canvas' ? paneSnapshots[pane.id] : undefined"
            :canvas="layoutMode === 'canvas'"
            :viewport-menu-open="appMenuMode === 'viewport' && paneMenuPaneId === pane.id"
            @close="closePane(pane.id)"
            @menu="openPaneMenu(pane.id, $event)"
            @raise-pane="raisePane(pane.id)"
            @lower-pane="lowerPane(pane.id)"
            @set-viewport="setPaneViewport(pane.id, $event)"
            @layout-changed="onPaneLayoutChanged"
            @open-viewport-menu="openViewportMenu"
            @open-external="openPaneExternal(pane.id)"
          />
        </div>
        <span
          v-for="(guide, index) in proximityGuides.vertical"
          :key="`pv-${index}`"
          class="alignment-guide proximity vertical"
          :style="{ left: `${guide}px` }"
          aria-hidden="true"
        ></span>
        <span
          v-for="(guide, index) in proximityGuides.horizontal"
          :key="`ph-${index}`"
          class="alignment-guide proximity horizontal"
          :style="{ top: `${guide}px` }"
          aria-hidden="true"
        ></span>
        <span
          v-for="(guide, index) in guides.vertical"
          :key="`v-${index}`"
          class="alignment-guide vertical"
          :style="{ left: `${guide}px` }"
          aria-hidden="true"
        ></span>
        <span
          v-for="(guide, index) in guides.horizontal"
          :key="`h-${index}`"
          class="alignment-guide horizontal"
          :style="{ top: `${guide}px` }"
          aria-hidden="true"
        ></span>
      </div>

      <div v-else class="empty-state">
        <p class="empty-title">No browsers</p>
        <p class="empty-detail">
          Add a browser to open a real, isolated session in this workspace.
        </p>
        <button
          class="toolbar-button primary"
          type="button"
          title="Add browser"
          aria-haspopup="menu"
          :aria-expanded="appMenuMode === 'add'"
          :disabled="addingPane"
          @click="openAddMenu"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          <span>Add browser</span>
        </button>
        <button class="bulk-link" type="button" @click="openBulkDialog">
          Open multiple browsers…
        </button>
      </div>
    </main>

    <div
      v-if="bulkDialogOpen"
      class="modal-backdrop bulk-backdrop"
      @click.self="closeBulkDialog()"
    >
      <section
        ref="bulkDialogEl"
        class="bulk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        aria-describedby="bulk-description"
        tabindex="-1"
        @keydown="onBulkDialogKeydown"
      >
        <header class="bulk-header">
          <div>
            <h2 id="bulk-title" class="bulk-title">Open multiple browsers</h2>
            <p id="bulk-description" class="bulk-description">
              One URL per line. Each browser gets its own isolated session.
            </p>
          </div>
          <button
            class="icon-button"
            type="button"
            title="Close multiple browsers"
            aria-label="Close multiple browsers"
            :disabled="bulkBusy"
            @click="closeBulkDialog()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <form class="bulk-form" @submit.prevent="createBulkBrowsers">
          <label class="sr-only" for="bulk-urls">URLs, one per line</label>
          <textarea
            id="bulk-urls"
            ref="bulkTextarea"
            v-model="bulkUrlsText"
            class="bulk-textarea"
            rows="8"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            placeholder="https://example.com&#10;https://example.org"
            :disabled="bulkBusy"
            @input="bulkError = null"
          ></textarea>

          <div class="bulk-viewport-row">
            <label for="bulk-viewport">Default viewport</label>
            <select
              id="bulk-viewport"
              v-model="bulkViewportPreset"
              class="bulk-select"
              :disabled="bulkBusy"
            >
              <option value="responsive">Responsive</option>
              <optgroup
                v-for="group in PRESET_CATEGORIES"
                :key="group.category"
                :label="group.label"
              >
                <option
                  v-for="preset in group.presets"
                  :key="preset.id"
                  :value="preset.id"
                >
                  {{ presetLabel(preset) }} · {{ preset.width }} × {{ preset.height }}
                </option>
              </optgroup>
              <option v-if="bulkCustomViewport" value="custom">
                Custom · {{ bulkCustomViewport.width }} × {{ bulkCustomViewport.height }}
              </option>
            </select>
          </div>

          <p class="bulk-hint">
            Starts from the selected browser's viewport. Up to {{ MAX_BULK_BROWSERS }} URLs at once.
          </p>
          <p v-if="bulkError" class="bulk-error" role="alert">{{ bulkError }}</p>

          <footer class="bulk-footer">
            <span class="bulk-count">
              {{ bulkUrlCount }} {{ bulkUrlCount === 1 ? 'browser' : 'browsers' }}
            </span>
            <div class="bulk-actions">
              <button
                class="text-button"
                type="button"
                :disabled="bulkBusy"
                @click="closeBulkDialog()"
              >
                Cancel
              </button>
              <button
                class="toolbar-button primary"
                type="submit"
                :disabled="bulkBusy || bulkUrlCount === 0"
              >
                {{ bulkSubmitLabel }}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="workspacesOpen"
      class="modal-backdrop workspace-dialog-backdrop"
      @click.self="closeWorkspaces"
    >
      <section
        ref="workspacesDialogEl"
        class="profiles-dialog workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspaces-title"
        aria-describedby="workspaces-description"
        tabindex="-1"
        @keydown="onWorkspacesKeydown"
      >
        <div class="profiles-header">
          <h2 id="workspaces-title" class="profiles-title">Workspaces</h2>
          <p id="workspaces-description" class="sr-only">
            Each workspace keeps its own browsers, layout, URLs, and viewport settings.
          </p>
          <button
            class="icon-button"
            type="button"
            title="Close workspaces"
            aria-label="Close workspaces"
            @click="closeWorkspaces"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div v-if="workspaceError" class="profiles-message profiles-error" role="alert">
          {{ workspaceError }}
        </div>
        <div v-else-if="workspaceNotice" class="profiles-message profiles-notice" role="status">
          {{ workspaceNotice }}
        </div>

        <form class="workspace-create" @submit.prevent="createWorkspace">
          <input
            v-model="newWorkspaceName"
            class="workspace-name-input"
            type="text"
            maxlength="80"
            autocomplete="off"
            aria-label="New workspace name"
            placeholder="New workspace name"
            :disabled="workspaceBusy"
            @input="workspaceError = null"
          />
          <button class="text-button" type="submit" :disabled="workspaceBusy">Create</button>
        </form>

        <div v-if="workspacesLoading" class="profiles-empty" role="status">
          Loading workspaces…
        </div>
        <div v-else-if="workspaces.length === 0" class="profiles-empty">
          No workspaces yet.
        </div>
        <ul v-else class="profile-list">
          <li
            v-for="workspace in workspaces"
            :key="workspace.id"
            class="profile-row workspace-row"
            :data-workspace-id="workspace.id"
          >
            <div v-if="renamingWorkspaceId === workspace.id" class="profile-rename-form">
              <input
                v-model="workspaceRenameDraft"
                class="profile-rename-input workspace-rename-input"
                type="text"
                maxlength="80"
                autocomplete="off"
                aria-label="Workspace name"
                @input="workspaceError = null"
              />
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="submitWorkspaceRename(workspace)"
              >
                Save
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="cancelWorkspaceRename"
              >
                Cancel
              </button>
            </div>
            <button
              v-else
              class="workspace-select"
              type="button"
              :class="{ 'workspace-select-active': workspace.active }"
              :aria-label="
                workspace.active
                  ? `Workspace ${workspace.name} is active`
                  : `Switch to workspace ${workspace.name}`
              "
              :aria-disabled="workspaceBusy || workspace.active ? 'true' : undefined"
              @click="switchToWorkspace(workspace)"
            >
              <span class="profile-label">
                <span class="workspace-label-text">{{ workspace.name }}</span>
                <span v-if="workspace.active" class="workspace-badge">Active</span>
              </span>
              <span class="profile-meta">
                {{ workspace.paneCount }} {{ workspace.paneCount === 1 ? 'browser' : 'browsers' }} ·
                Updated {{ formatProfileDate(workspace.updatedAt) }}
              </span>
            </button>

            <button
              v-if="renamingWorkspaceId !== workspace.id"
              class="icon-button workspace-more"
              type="button"
              title="Workspace actions"
              :aria-label="`Workspace actions for ${workspace.name}`"
              aria-haspopup="menu"
              :aria-expanded="workspaceMenuId === workspace.id"
              :disabled="workspaceBusy"
              @click="onWorkspaceMenuClick(workspace, $event)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.1" />
                <circle cx="8" cy="8" r="1.1" />
                <circle cx="13" cy="8" r="1.1" />
              </svg>
            </button>

            <div
              v-if="workspaceDeleteId === workspace.id"
              class="profile-confirm"
              role="group"
              :aria-label="`Confirm delete workspace ${workspace.name}`"
            >
              <span>Delete “{{ workspace.name }}” and its saved layout? This cannot be undone.</span>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="confirmWorkspaceDelete(workspace)"
              >
                Delete workspace
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="workspaceBusy"
                @click="cancelWorkspaceDelete"
              >
                Cancel
              </button>
            </div>
          </li>
        </ul>

        <footer class="profiles-footer">
          <span class="profiles-count">
            {{ workspaces.length }} workspace{{ workspaces.length === 1 ? '' : 's' }}
          </span>
          <div class="workspace-footer-actions">
            <button
              class="text-button"
              type="button"
              :disabled="workspaceBusy"
              @click="importWorkspaceFile"
            >
              Import…
            </button>
            <button
              class="text-button"
              type="button"
              :disabled="workspaceBusy || !workspaces.some((workspace) => workspace.active)"
              @click="exportActiveWorkspace"
            >
              Export active
            </button>
          </div>
        </footer>
      </section>
    </div>

    <div
      v-if="devicePaletteOpen"
      class="modal-backdrop device-palette-backdrop"
      @click.self="closeDevicePalette()"
    >
      <section
        class="device-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Find browser"
      >
        <input
          ref="devicePaletteInput"
          v-model="devicePaletteQuery"
          class="device-palette-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="DEVICE_PALETTE_LIST_ID"
          :aria-activedescendant="devicePaletteSelectedId"
          aria-label="Find browser"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Find a browser by name, host, or viewport"
          @keydown="onDevicePaletteKeydown"
        />
        <ul
          :id="DEVICE_PALETTE_LIST_ID"
          class="device-palette-list"
          role="listbox"
          aria-label="Browsers"
        >
          <li
            v-for="(result, index) in devicePaletteResults"
            :id="`device-palette-option-${index}`"
            :key="result.pane.id"
            class="device-palette-option"
            :class="{ 'device-palette-option-selected': index === devicePaletteIndex }"
            role="option"
            :aria-selected="index === devicePaletteIndex"
            @mouseenter="devicePaletteIndex = index"
            @mousedown.prevent
            @click="chooseDevicePaletteResult(result)"
          >
            <span class="device-palette-option-top">
              <span class="device-palette-title">
                <template
                  v-for="(segment, segmentIndex) in highlightSegments(
                    result.title,
                    devicePaletteQuery
                  )"
                  :key="`title-${segmentIndex}`"
                >
                  <mark v-if="segment.match" class="device-palette-match">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
              <span class="device-palette-viewport">
                <template
                  v-for="(segment, segmentIndex) in highlightSegments(
                    result.viewport,
                    devicePaletteQuery
                  )"
                  :key="`viewport-${segmentIndex}`"
                >
                  <mark v-if="segment.match" class="device-palette-match">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
            </span>
            <span class="device-palette-detail">
              <template
                v-for="(segment, segmentIndex) in highlightSegments(
                  result.detail,
                  devicePaletteQuery
                )"
                :key="`detail-${segmentIndex}`"
              >
                <mark v-if="segment.match" class="device-palette-match">{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
          </li>
        </ul>
        <div
          v-if="devicePaletteResults.length === 0"
          class="device-palette-empty"
          role="status"
        >
          {{
            devicePaletteQuery.trim()
              ? 'No matching browsers.'
              : 'No browsers in this workspace.'
          }}
        </div>
        <footer class="device-palette-footer" aria-hidden="true">
          <span>↑↓ Navigate</span>
          <span>Enter Open</span>
          <span>Esc Close</span>
        </footer>
      </section>
    </div>

    <div
      v-if="marqueeRect"
      class="canvas-marquee"
      :style="marqueeStyle"
      aria-hidden="true"
    ></div>

    <AppMenu
      v-if="appMenuMode"
      :key="appMenuMode"
      :model="
        appMenuMode === 'viewport'
          ? viewportMenuModel
          : appMenuMode === 'add'
            ? addPaneMenuModel
            : appMenuMode === 'zoom'
              ? zoomMenuModel
              : appMenuMode === 'appearance'
                ? appearanceMenuModel
                : appMenuMode === 'arrange'
                  ? arrangeMenuModel
                  : appMenuMode === 'pane'
                    ? paneMenuModel
                    : appMenuMode === 'clear-site-data'
                      ? clearSiteDataMenuModel
                      : appMenuMode === 'workspace'
                        ? workspaceMenuModel
                        : appMenuMode === 'selection'
                          ? selectionMenuModel
                          : canvasMenuModel
      "
      :anchor="appMenuAnchor"
      :placement="isBottomBarMenu() ? 'above' : 'below'"
      :width="
        isBottomBarMenu()
          ? CANVAS_ZOOM_MENU_WIDTH
          : appMenuMode === 'workspace'
            ? 176
            : appMenuMode === 'selection'
              ? 260
              : undefined
      "
      @select="onAppMenuSelect"
      @close="closeAppMenu()"
      @bounds="onAppMenuBounds"
    />
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
  gap: 6px;
  height: 42px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  user-select: none;
}

.app-shell.mac-titlebar .toolbar {
  padding-left: 84px;
  -webkit-app-region: drag;
}

.app-shell.mac-titlebar .toolbar button,
.app-shell.mac-titlebar .toolbar select,
.app-shell.mac-titlebar .toolbar input {
  -webkit-app-region: no-drag;
}

.toolbar .address-input,
.toolbar .custom-field input {
  user-select: text;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
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
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.toolbar-button.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-soft) 82%, var(--accent) 18%);
}

.selection-summary {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 2px 0 9px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.selection-count {
  font-variant-numeric: tabular-nums;
}

.selection-viewport {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 5px;
  border-radius: 4px;
  color: inherit;
  font-size: 11.5px;
  font-weight: 500;
}

.selection-viewport:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.selection-viewport svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.selection-reload {
  width: 24px;
  height: 24px;
  color: inherit;
}

.selection-reload svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.selection-reload:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.add-pane-button {
  margin-left: auto;
  color: var(--text-muted);
}

.add-pane-button svg {
  width: 15px;
  height: 15px;
  stroke-width: 1.8;
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
  overflow-x: hidden;
  overflow-y: auto;
}

.workspace-canvas {
  overflow: hidden;
  background-color: var(--bg);
  background-image: radial-gradient(var(--border) 1.2px, transparent 1.2px);
  background-size: 20px 20px;
  cursor: grab;
  touch-action: none;
}

.workspace-canvas.canvas-select {
  cursor: crosshair;
}

.workspace-canvas.canvas-panning,
.workspace-canvas.canvas-hand {
  cursor: grabbing;
}

.canvas-marquee {
  position: fixed;
  z-index: 1500;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--accent-soft);
  opacity: 0.55;
  pointer-events: none;
}

.workspace-canvas .pane-grid {
  min-height: 100%;
}

.pane-grid {
  position: relative;
  min-height: 100%;
}

.pane-slot {
  position: absolute;
}

.pane-slot-active,
.pane-slot-selected {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}

.pane-slot-dragging {
  opacity: 0.65;
}

.pane-slot-drop-target {
  border-radius: 11px;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.alignment-guide {
  position: absolute;
  z-index: 1000;
  background: var(--accent);
  pointer-events: none;
}

.alignment-guide.vertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.alignment-guide.horizontal {
  right: 0;
  left: 0;
  height: 1px;
}

.alignment-guide.proximity {
  opacity: 0.45;
}

.alignment-guide.proximity.vertical {
  background: repeating-linear-gradient(
    to bottom,
    var(--accent) 0 3px,
    transparent 3px 7px
  );
}

.alignment-guide.proximity.horizontal {
  background: repeating-linear-gradient(
    to right,
    var(--accent) 0 3px,
    transparent 3px 7px
  );
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

.bulk-link {
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.bulk-link:hover {
  background: var(--surface-inset);
  color: var(--text);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(18, 18, 17, 0.35);
}

.bulk-backdrop {
  background: rgba(18, 18, 17, 0.28);
}

.bulk-dialog {
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(680px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  outline: none;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.12);
}

:root[data-theme='dark'] .bulk-dialog {
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.46),
    0 2px 10px rgba(0, 0, 0, 0.36);
}

.bulk-dialog:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.bulk-header {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 11px;
  border-bottom: 1px solid var(--border);
}

.bulk-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.005em;
}

.bulk-description {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.bulk-header .icon-button {
  flex: none;
  width: 24px;
  height: 24px;
}

.bulk-header .icon-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.bulk-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow-y: auto;
}

.bulk-textarea {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-inset);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.55;
}

.bulk-textarea:focus {
  border-color: var(--accent);
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.bulk-viewport-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.bulk-select {
  flex: 1;
  min-width: 180px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 11.5px;
}

.bulk-hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.45;
}

.bulk-error {
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
  line-height: 1.45;
}

.bulk-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.bulk-count {
  color: var(--text-faint);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bulk-actions .text-button {
  padding: 3px 7px;
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.bulk-actions .text-button:hover:not(:disabled) {
  background: var(--surface-inset);
  color: var(--text);
}

.device-palette-backdrop {
  align-items: flex-start;
  padding-top: 88px;
  background: rgba(18, 18, 17, 0.28);
}

.device-palette {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(560px, calc(100vh - 120px));
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  outline: none;
}

.device-palette:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.device-palette-input {
  flex: none;
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.device-palette-input::placeholder {
  color: var(--text-faint);
}

.device-palette-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
}

.device-palette-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.device-palette-option-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.device-palette-option-selected {
  background: var(--accent-soft);
}

.device-palette-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-palette-viewport {
  flex: none;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-inset);
  color: var(--text-muted);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.device-palette-option-selected .device-palette-viewport {
  background: transparent;
  color: var(--accent-strong);
}

.device-palette-match {
  background: transparent;
  color: var(--accent-strong);
  font-weight: 650;
}

.device-palette-detail {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-palette-option-selected .device-palette-detail {
  color: var(--accent-strong);
}

.device-palette-empty {
  padding: 24px 14px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.device-palette-footer {
  flex: none;
  display: flex;
  gap: 12px;
  padding: 7px 14px;
  border-top: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 10.5px;
}

.workspace-dialog-backdrop {
  background: rgba(18, 18, 17, 0.2);
}

.profiles-dialog {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(70vh, 620px);
  overflow: hidden;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  outline: none;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.12);
}

:root[data-theme='dark'] .profiles-dialog {
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.46),
    0 2px 10px rgba(0, 0, 0, 0.36);
}

.profiles-dialog:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.profiles-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 4px 6px 8px;
}

.profiles-header .icon-button {
  width: 24px;
  height: 24px;
}

.profiles-header .icon-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.profiles-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.profiles-description {
  margin: 0;
}

.profiles-message {
  margin: 0 2px 6px;
  padding: 5px 7px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.4;
}

.profiles-error {
  background: var(--danger-soft);
  color: var(--danger);
}

.profiles-notice {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.profiles-empty {
  padding: 18px 8px;
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: center;
}

.profile-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px;
  align-items: center;
  padding: 1px 2px;
  border-radius: 6px;
}

.profile-row:hover {
  background: var(--surface-inset);
}

.profile-row:has(.workspace-select-active):hover {
  background: transparent;
}

.workspace-select {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 6px 7px;
  border-radius: 5px;
  text-align: left;
}

.workspace-select-active {
  cursor: default;
}

.workspace-more {
  width: 24px;
  height: 24px;
  margin-right: 2px;
  color: var(--text-faint);
}

.workspace-more svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
  stroke: none;
}

.profile-label {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-meta {
  color: var(--text-faint);
  font-size: 10.5px;
  line-height: 1.4;
}

.profile-rename-form {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
}

.profile-rename-form .text-button,
.profile-confirm .text-button {
  margin-top: 0;
  padding: 2px 7px;
  font-size: 11px;
}

.profile-rename-input {
  width: min(280px, 100%);
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 12px;
}

.profile-rename-input:focus {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.profile-confirm {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-inset);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.profiles-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 4px 2px;
  border-top: 1px solid var(--border);
}

.profiles-count {
  color: var(--text-faint);
  font-size: 10.5px;
}

.workspace-create {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
  padding: 4px 2px 6px;
  border-bottom: 1px solid var(--border);
}

.workspace-name-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: var(--surface-inset);
  color: var(--text);
  font-size: 11.5px;
}

.workspace-name-input:focus {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.workspace-create .text-button {
  margin-top: 0;
  padding: 2px 8px;
  font-size: 11px;
}

.workspace-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  vertical-align: 1px;
}

.workspace-rename-input {
  width: min(300px, 100%);
}

.workspace-footer-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.workspace-footer-actions .text-button {
  margin-top: 0;
  padding: 2px 6px;
  font-size: 11px;
}

@media (max-width: 820px) {
  .toolbar {
    gap: 4px;
    padding: 0 8px;
  }
}
</style>
