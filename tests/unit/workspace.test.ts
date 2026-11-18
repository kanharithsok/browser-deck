import { describe, expect, it } from 'vitest'
import { viewportFromPreset } from '../../src/shared/viewports'
import {
  APP_STATE_VERSION,
  DEFAULT_WORKSPACE_ID,
  MAX_PANE_TITLE_LENGTH,
  WORKSPACE_STORE_VERSION,
  adjacentWorkspaceId,
  createEmptyWorkspace,
  defaultWorkspaceLayout,
  normalizeWorkspaceLayout,
  parseAppStateData,
  parsePaneTitle,
  parseWorkspaceData
} from '../../src/shared/workspace'

const PANE_A = '11111111-1111-4111-8111-111111111111'
const PANE_B = '22222222-2222-4222-8222-222222222222'
const PROFILE_A = '33333333-3333-4333-8333-333333333333'
const PROFILE_B = '44444444-4444-4444-8444-444444444444'

function workspaceInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: WORKSPACE_STORE_VERSION,
    id: DEFAULT_WORKSPACE_ID,
    name: 'Responsive QA',
    panes: [
      {
        id: PANE_A,
        profileId: PROFILE_A,
        url: 'https://example.com/one',
        viewport: viewportFromPreset('mobile', 'fit')
      },
      {
        id: PANE_B,
        profileId: PROFILE_B,
        url: 'http://localhost:3000/two',
        viewport: viewportFromPreset('responsive')
      }
    ],
    layout: {
      mode: 'freeform',
      columns: 3,
      gridOrder: [PANE_B, PANE_A],
      freeform: {
        [PANE_A]: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }
      },
      freeformOrder: [PANE_A, PANE_B]
    },
    updatedAt: '2026-11-18T12:00:00.000Z',
    ...overrides
  }
}

describe('workspace data validation', () => {
  it('accepts a versioned workspace and preserves per-pane definitions', () => {
    const parsed = parseWorkspaceData(workspaceInput())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    expect(parsed.data.id).toBe(DEFAULT_WORKSPACE_ID)
    expect(parsed.data.name).toBe('Responsive QA')
    expect(parsed.data.panes).toHaveLength(2)
    expect(parsed.data.panes[0]).toMatchObject({
      id: PANE_A,
      profileId: PROFILE_A,
      url: 'https://example.com/one',
      viewport: { preset: 'mobile', width: 390, height: 844, deviceScaleFactor: 3 }
    })
    expect(parsed.data.layout).toMatchObject({
      mode: 'freeform',
      columns: 3,
      gridOrder: [PANE_B, PANE_A],
      freeformOrder: [PANE_A, PANE_B]
    })
  })

  it('rejects unsupported versions, invalid IDs, URLs, and viewports', () => {
    expect(parseWorkspaceData(null).ok).toBe(false)
    expect(parseWorkspaceData(workspaceInput({ version: 2 })).ok).toBe(false)
    expect(parseWorkspaceData(workspaceInput({ id: 'Bad ID' })).ok).toBe(false)
    expect(parseWorkspaceData(workspaceInput({ name: '   ' })).ok).toBe(false)

    const invalidPaneId = workspaceInput()
    ;(invalidPaneId.panes as Array<Record<string, unknown>>)[0]!.id = 'not-a-pane'
    expect(parseWorkspaceData(invalidPaneId).ok).toBe(false)

    const invalidProfile = workspaceInput()
    ;(invalidProfile.panes as Array<Record<string, unknown>>)[0]!.profileId = 'not-a-profile'
    expect(parseWorkspaceData(invalidProfile).ok).toBe(false)

    const dangerousUrl = workspaceInput()
    ;(dangerousUrl.panes as Array<Record<string, unknown>>)[0]!.url = 'javascript:alert(1)'
    expect(parseWorkspaceData(dangerousUrl).ok).toBe(false)

    const invalidViewport = workspaceInput()
    ;(invalidViewport.panes as Array<Record<string, unknown>>)[0]!.viewport = {
      preset: 'custom',
      width: 20,
      height: 600,
      deviceScaleFactor: 1,
      displayScale: 'fit'
    }
    expect(parseWorkspaceData(invalidViewport).ok).toBe(false)
  })

  it('rejects duplicate pane IDs and invalid update dates', () => {
    const duplicate = workspaceInput()
    ;(duplicate.panes as Array<Record<string, unknown>>)[1]!.id = PANE_A
    expect(parseWorkspaceData(duplicate).ok).toBe(false)
    expect(parseWorkspaceData(workspaceInput({ updatedAt: 'never' })).ok).toBe(false)
  })

  it('preserves optional custom pane titles and ignores blank ones', () => {
    const input = workspaceInput()
    ;(input.panes as Array<Record<string, unknown>>)[0]!.title = '  Alice QA  '
    ;(input.panes as Array<Record<string, unknown>>)[1]!.title = '   '

    const parsed = parseWorkspaceData(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.data.panes[0]).toMatchObject({ title: 'Alice QA' })
    expect(parsed.data.panes[1]).not.toHaveProperty('title')
  })

  it('rejects unsafe custom pane titles', () => {
    const tooLong = workspaceInput()
    ;(tooLong.panes as Array<Record<string, unknown>>)[0]!.title = 'x'.repeat(
      MAX_PANE_TITLE_LENGTH + 1
    )
    expect(parseWorkspaceData(tooLong).ok).toBe(false)

    const controlCharacter = workspaceInput()
    ;(controlCharacter.panes as Array<Record<string, unknown>>)[0]!.title = 'Alice\u0007QA'
    expect(parseWorkspaceData(controlCharacter).ok).toBe(false)

    const wrongType = workspaceInput()
    ;(wrongType.panes as Array<Record<string, unknown>>)[0]!.title = 42
    expect(parseWorkspaceData(wrongType).ok).toBe(false)
  })
})

describe('pane title validation', () => {
  it('trims valid titles, treats blank input as a reset, and rejects unsafe text', () => {
    expect(parsePaneTitle('  Alice QA  ')).toEqual({ ok: true, title: 'Alice QA' })
    expect(parsePaneTitle('   ')).toEqual({ ok: true, title: null })
    expect(parsePaneTitle(42).ok).toBe(false)
    expect(parsePaneTitle('Alice\u0007QA').ok).toBe(false)
    expect(parsePaneTitle('x'.repeat(MAX_PANE_TITLE_LENGTH + 1)).ok).toBe(false)
  })
})

describe('workspace layout normalization', () => {
  it('filters unknown pane references and appends missing panes', () => {
    const layout = normalizeWorkspaceLayout(
      {
        mode: 'freeform',
        columns: 9,
        gridOrder: [PANE_B, '55555555-5555-4555-8555-555555555555', PANE_B],
        freeform: {
          [PANE_A]: { x: -0.1, y: 0.2, width: 0.3, height: 0.3 },
          [PANE_B]: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
          unknown: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }
        },
        freeformOrder: [PANE_A]
      },
      [PANE_A, PANE_B]
    )

    expect(layout.mode).toBe('freeform')
    expect(layout.columns).toBe(2)
    expect(layout.gridOrder).toEqual([PANE_A, PANE_B])
    expect(layout.freeformOrder).toEqual([PANE_A, PANE_B])
    expect(layout.freeform).toEqual({
      [PANE_B]: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 }
    })
  })

  it('falls back safely for malformed input', () => {
    expect(normalizeWorkspaceLayout(null, [PANE_A])).toEqual(defaultWorkspaceLayout([PANE_A]))
    expect(normalizeWorkspaceLayout('bad', [])).toEqual(defaultWorkspaceLayout([]))
    expect(normalizeWorkspaceLayout({ mode: 'unknown', columns: 0 }, [])).toEqual(
      defaultWorkspaceLayout([])
    )
  })
})

describe('app state validation', () => {
  it('accepts a known active workspace and rejects malformed state', () => {
    expect(
      parseAppStateData({ version: APP_STATE_VERSION, activeWorkspaceId: DEFAULT_WORKSPACE_ID })
    ).toEqual({
      ok: true,
      data: { version: APP_STATE_VERSION, activeWorkspaceId: DEFAULT_WORKSPACE_ID }
    })
    expect(parseAppStateData(null).ok).toBe(false)
    expect(parseAppStateData({ version: 2, activeWorkspaceId: DEFAULT_WORKSPACE_ID }).ok).toBe(false)
    expect(parseAppStateData({ version: APP_STATE_VERSION, activeWorkspaceId: '../x' }).ok).toBe(
      false
    )
  })

  it('restores valid window bounds and drops invalid ones', () => {
    const valid = parseAppStateData({
      version: APP_STATE_VERSION,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      windowBounds: { x: 40, y: 50, width: 1100, height: 760 }
    })
    expect(valid).toEqual({
      ok: true,
      data: {
        version: APP_STATE_VERSION,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        windowBounds: { x: 40, y: 50, width: 1100, height: 760 }
      }
    })

    const invalid = parseAppStateData({
      version: APP_STATE_VERSION,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      windowBounds: { x: 0, y: 0, width: 120, height: 80 }
    })
    expect(invalid).toEqual({
      ok: true,
      data: { version: APP_STATE_VERSION, activeWorkspaceId: DEFAULT_WORKSPACE_ID }
    })
  })

  it('restores valid window presentation flags and ignores invalid ones', () => {
    const valid = parseAppStateData({
      version: APP_STATE_VERSION,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      maximized: true,
      fullScreen: true
    })
    expect(valid).toEqual({
      ok: true,
      data: {
        version: APP_STATE_VERSION,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        maximized: true,
        fullScreen: true
      }
    })

    const invalid = parseAppStateData({
      version: APP_STATE_VERSION,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      maximized: 'yes',
      fullScreen: 1
    })
    expect(invalid).toEqual({
      ok: true,
      data: { version: APP_STATE_VERSION, activeWorkspaceId: DEFAULT_WORKSPACE_ID }
    })
  })

  it('accepts valid theme preferences and ignores invalid values', () => {
    expect(
      parseAppStateData({
        version: APP_STATE_VERSION,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        theme: 'dark'
      })
    ).toEqual({
      ok: true,
      data: {
        version: APP_STATE_VERSION,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        theme: 'dark'
      }
    })
    expect(
      parseAppStateData({
        version: APP_STATE_VERSION,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        theme: 'sepia'
      })
    ).toEqual({
      ok: true,
      data: { version: APP_STATE_VERSION, activeWorkspaceId: DEFAULT_WORKSPACE_ID }
    })
  })

  it('creates empty workspaces with a valid default layout', () => {
    const workspace = createEmptyWorkspace()
    expect(workspace.version).toBe(WORKSPACE_STORE_VERSION)
    expect(workspace.id).toBe(DEFAULT_WORKSPACE_ID)
    expect(workspace.panes).toEqual([])
    expect(workspace.layout).toEqual(defaultWorkspaceLayout([]))
  })
})

describe('workspace cycling', () => {
  const workspaces = [
    { id: 'charlie', name: 'Charlie' },
    { id: 'alpha', name: 'Alpha' },
    { id: 'bravo', name: 'Bravo' }
  ]

  it('selects the next and previous workspace in stable name order', () => {
    expect(adjacentWorkspaceId(workspaces, 'alpha', 'next')).toBe('bravo')
    expect(adjacentWorkspaceId(workspaces, 'bravo', 'next')).toBe('charlie')
    expect(adjacentWorkspaceId(workspaces, 'charlie', 'previous')).toBe('bravo')
    expect(adjacentWorkspaceId(workspaces, 'bravo', 'previous')).toBe('alpha')
  })

  it('wraps at both ends without mutating the input order', () => {
    expect(adjacentWorkspaceId(workspaces, 'charlie', 'next')).toBe('alpha')
    expect(adjacentWorkspaceId(workspaces, 'alpha', 'previous')).toBe('charlie')
    expect(workspaces.map((workspace) => workspace.id)).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('returns null when there is no other workspace to activate', () => {
    expect(adjacentWorkspaceId([], 'alpha', 'next')).toBeNull()
    expect(adjacentWorkspaceId([{ id: 'alpha', name: 'Alpha' }], 'alpha', 'previous')).toBeNull()
    expect(adjacentWorkspaceId(workspaces, 'unknown', 'next')).toBeNull()
  })
})
