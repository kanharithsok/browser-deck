import { describe, expect, it } from 'vitest'
import { MAX_BULK_BROWSERS, parseBulkUrlInput } from '../../src/shared/bulk'

describe('parseBulkUrlInput', () => {
  it('normalizes one URL per line and ignores blank lines', () => {
    expect(
      parseBulkUrlInput(`
        example.com/a
        https://example.org/b?x=1

        localhost:3000
      `)
    ).toEqual({
      ok: true,
      urls: ['https://example.com/a', 'https://example.org/b?x=1', 'http://localhost:3000/']
    })
  })

  it('reports the offending line without echoing the URL', () => {
    const result = parseBulkUrlInput('https://example.com\njavascript:alert(1)')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Line 2')
      expect(result.error).not.toContain('javascript')
    }
  })

  it('rejects empty input and excessive batches', () => {
    expect(parseBulkUrlInput(' \n ')).toEqual({ ok: false, error: 'Paste at least one URL.' })
    const lines = Array.from({ length: MAX_BULK_BROWSERS + 1 }, (_, index) => `example.com/${index}`)
    expect(parseBulkUrlInput(lines.join('\n')).ok).toBe(false)
  })
})
