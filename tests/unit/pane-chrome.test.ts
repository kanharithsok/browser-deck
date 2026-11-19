import { describe, expect, it } from 'vitest'
import {
  PANE_CHROME_STYLES,
  isPaneChromeStyle,
  paneChromeLabel
} from '../../src/shared/pane-chrome'

describe('pane chrome preferences', () => {
  it('accepts only the supported preview styles', () => {
    expect(PANE_CHROME_STYLES).toEqual(['a', 'b', 'c'])
    expect(isPaneChromeStyle('a')).toBe(true)
    expect(isPaneChromeStyle('b')).toBe(true)
    expect(isPaneChromeStyle('c')).toBe(true)
    expect(isPaneChromeStyle('d')).toBe(false)
    expect(isPaneChromeStyle(null)).toBe(false)
    expect(isPaneChromeStyle(undefined)).toBe(false)
  })

  it('provides a label for each style', () => {
    expect(paneChromeLabel('a')).toBe('Quiet bar')
    expect(paneChromeLabel('b')).toBe('Canvas label')
    expect(paneChromeLabel('c')).toBe('Global bar')
  })
})
