import { describe, expect, it } from 'vitest'
import { MAX_URL_LENGTH } from '../../src/shared/url'
import { viewportFromPreset } from '../../src/shared/viewports'
import {
  WORKSPACE_TRANSFER_FORMAT,
  WORKSPACE_TRANSFER_VERSION,
  materializeWorkspaceTransfer,
  parseWorkspaceTransfer,
  serializeWorkspaceTransfer
} from '../../src/shared/workspace-transfer'
import { MAX_PANE_TITLE_LENGTH, WORKSPACE_STORE_VERSION, type WorkspaceData } from '../../src/shared/workspace'

const PANE_A = '11111111-1111-4111-8111-111111111111'
const PANE_B = '22222222-2222-4222-8222-222222222222'
const PANE_C = '33333333-3333-4333-8333-333333333333'
const PANE_D = '44444444-4444-4444-8444-444444444444'
const PROFILE_A = '55555555-5555-4555-8555-555555555555'
const PROFILE_B = '66666666-6666-4666-8666-666666666666'
const PROFILE_C = '77777777-7777-4777-8777-777777777777'
const PROFILE_D = '88888888-8888-4888-8888-888888888888'

function workspace(): WorkspaceData {
  return {
    version: WORKSPACE_STORE_VERSION,
    id: 'default',
    name: 'Responsive QA',
    panes: [
      {
        id: PANE_A,
        profileId: PROFILE_A,
        url: 'https://example.com/one',
        viewport: viewportFromPreset('mobile', 'fit'),
        title: 'Alice QA'
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
    updatedAt: '2026-11-19T00:00:00.000Z'
  }
}

describe('workspace transfer serialization', () => {
  it('strips profile IDs and maps pane layout to indices', () => {
    const transfer = serializeWorkspaceTransfer(workspace())
    expect(transfer).toMatchObject({
      format: WORKSPACE_TRANSFER_FORMAT,
      version: WORKSPACE_TRANSFER_VERSION,
      name: 'Responsive QA',
      panes: [
        {
          url: 'https://example.com/one',
          viewport: { preset: 'mobile' },
          title: 'Alice QA'
        },
        { url: 'http://localhost:3000/two', viewport: { preset: 'responsive' } }
      ],
      layout: {
        mode: 'freeform',
        columns: 3,
        gridOrder: [1, 0],
        freeformOrder: [0, 1]
      }
    })
    expect(transfer.layout.freeform).toEqual({
      '0': { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }
    })
    expect(JSON.stringify(transfer)).not.toContain('profileId')
    expect(JSON.stringify(transfer)).not.toContain(PROFILE_A)
  })

  it('round-trips through JSON and materializes fresh pane/profile IDs', () => {
    const transfer = parseWorkspaceTransfer(
      JSON.parse(JSON.stringify(serializeWorkspaceTransfer(workspace())))
    )
    expect(transfer.ok).toBe(true)
    if (!transfer.ok) {
      return
    }

    const materialized = materializeWorkspaceTransfer(
      transfer.transfer,
      '99999999-9999-4999-8999-999999999999',
      'Imported Copy',
      [PANE_C, PANE_D],
      [PROFILE_C, PROFILE_D]
    )
    expect(materialized.panes).toEqual([
      {
        id: PANE_C,
        profileId: PROFILE_C,
        url: 'https://example.com/one',
        viewport: expect.objectContaining({ preset: 'mobile' }),
        title: 'Alice QA'
      },
      {
        id: PANE_D,
        profileId: PROFILE_D,
        url: 'http://localhost:3000/two',
        viewport: expect.objectContaining({ preset: 'responsive' })
      }
    ])
    expect(materialized.layout.gridOrder).toEqual([PANE_D, PANE_C])
    expect(materialized.layout.freeformOrder).toEqual([PANE_C, PANE_D])
    expect(materialized.layout.freeform).toEqual({
      [PANE_C]: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }
    })
  })
})

describe('workspace transfer validation', () => {
  const valid = () => serializeWorkspaceTransfer(workspace()) as unknown as Record<string, unknown>

  it('rejects wrong formats and unsafe pane settings', () => {
    expect(parseWorkspaceTransfer(null).ok).toBe(false)
    expect(parseWorkspaceTransfer({ ...valid(), format: 'other' }).ok).toBe(false)
    expect(parseWorkspaceTransfer({ ...valid(), version: 2 }).ok).toBe(false)

    const unsafeUrl = valid()
    ;(unsafeUrl.panes as Array<Record<string, unknown>>)[0]!.url = 'javascript:alert(1)'
    expect(parseWorkspaceTransfer(unsafeUrl).ok).toBe(false)

    const credentialUrl = valid()
    ;(credentialUrl.panes as Array<Record<string, unknown>>)[0]!.url =
      'https://alice:secret@example.com/'
    expect(parseWorkspaceTransfer(credentialUrl).ok).toBe(false)

    const oversizedUrl = valid()
    ;(oversizedUrl.panes as Array<Record<string, unknown>>)[0]!.url =
      `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`
    expect(parseWorkspaceTransfer(oversizedUrl).ok).toBe(false)

    const badViewport = valid()
    ;(badViewport.panes as Array<Record<string, unknown>>)[0]!.viewport = {
      preset: 'custom',
      width: 10,
      height: 700,
      deviceScaleFactor: 2,
      displayScale: 'fit'
    }
    expect(parseWorkspaceTransfer(badViewport).ok).toBe(false)

    const badTitle = valid()
    ;(badTitle.panes as Array<Record<string, unknown>>)[0]!.title = 'x'.repeat(
      MAX_PANE_TITLE_LENGTH + 1
    )
    expect(parseWorkspaceTransfer(badTitle).ok).toBe(false)

    const controlCharacter = valid()
    ;(controlCharacter.panes as Array<Record<string, unknown>>)[0]!.title = 'Alice\u0007QA'
    expect(parseWorkspaceTransfer(controlCharacter).ok).toBe(false)
  })

  it('rejects invalid pane order and freeform geometry', () => {
    const badOrder = valid()
    ;(badOrder.layout as Record<string, unknown>).gridOrder = [0, 0]
    expect(parseWorkspaceTransfer(badOrder).ok).toBe(false)

    const missingPane = valid()
    ;(missingPane.layout as Record<string, unknown>).freeformOrder = [0]
    expect(parseWorkspaceTransfer(missingPane).ok).toBe(false)

    const badRect = valid()
    ;((badRect.layout as Record<string, unknown>).freeform as Record<string, unknown>)['0'] = {
      x: 0.9,
      y: 0.1,
      width: 0.4,
      height: 0.2
    }
    expect(parseWorkspaceTransfer(badRect).ok).toBe(false)

    const badKey = valid()
    ;((badKey.layout as Record<string, unknown>).freeform as Record<string, unknown>).unknown = {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2
    }
    expect(parseWorkspaceTransfer(badKey).ok).toBe(false)

    const polluted = valid()
    ;(polluted.layout as Record<string, unknown>).freeform = JSON.parse(
      '{"__proto__":{"x":0.1,"y":0.1,"width":0.2,"height":0.2}}'
    ) as unknown
    expect(parseWorkspaceTransfer(polluted).ok).toBe(false)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('rejects mismatched materialization mappings', () => {
    const transfer = parseWorkspaceTransfer(serializeWorkspaceTransfer(workspace()))
    if (!transfer.ok) {
      throw new Error('Expected valid transfer')
    }
    expect(() =>
      materializeWorkspaceTransfer(transfer.transfer, 'id', 'name', [PANE_C], [PROFILE_C])
    ).toThrow()
  })
})
