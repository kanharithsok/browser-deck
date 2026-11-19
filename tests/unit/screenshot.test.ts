import { describe, expect, it } from 'vitest'
import { screenshotFileName } from '../../src/shared/screenshot'

describe('screenshotFileName', () => {
  const now = new Date(2026, 10, 19, 14, 5, 9)

  it('builds a stable, filesystem-safe PNG name from the hostname', () => {
    expect(screenshotFileName('https://app.example.com/path?q=1', now)).toBe(
      'app.example.com-20261119-140509.png'
    )
  })

  it('falls back to a generic name for blank or invalid URLs', () => {
    expect(screenshotFileName('about:blank', now)).toBe('device-20261119-140509.png')
    expect(screenshotFileName('not a url', now)).toBe('device-20261119-140509.png')
  })

  it('reserves no characters that are invalid in file names', () => {
    const name = screenshotFileName('https://exa:mple.com', now)
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/)
    expect(name.endsWith('.png')).toBe(true)
  })
})
