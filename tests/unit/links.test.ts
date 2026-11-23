import { describe, expect, it } from 'vitest'
import { PROJECT_LINKS, isProjectLink } from '../../src/shared/links'

describe('project links', () => {
  it('maps only the fixed repository and sponsor destinations', () => {
    expect(PROJECT_LINKS).toEqual({
      repository: 'https://github.com/kanharithsok/browser-deck',
      sponsor: 'https://github.com/sponsors/kanharithsok'
    })
  })

  it('rejects arbitrary URLs and unknown targets', () => {
    expect(isProjectLink('repository')).toBe(true)
    expect(isProjectLink('sponsor')).toBe(true)
    expect(isProjectLink('https://example.com')).toBe(false)
    expect(isProjectLink('stargazers')).toBe(false)
    expect(isProjectLink(null)).toBe(false)
    expect(isProjectLink(undefined)).toBe(false)
  })
})
