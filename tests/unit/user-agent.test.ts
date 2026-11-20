import { describe, expect, it } from 'vitest'
import { userAgentForViewport } from '../../src/shared/user-agent'
import type { PaneViewport } from '../../src/shared/viewports'

function viewport(preset: PaneViewport['preset']): PaneViewport {
  return { preset, width: 390, height: 844, deviceScaleFactor: 3 }
}

describe('preset user agents', () => {
  it('keeps the default UA for responsive and custom viewports', () => {
    expect(userAgentForViewport(viewport('responsive'), '142.0.7444.59')).toBeNull()
    expect(userAgentForViewport(viewport('custom'), '142.0.7444.59')).toBeNull()
  })

  it('uses iPhone Safari for Apple and generic phones', () => {
    for (const preset of ['mobile', 'iphone-15-pro', 'iphone-15-pro-max', 'iphone-se'] as const) {
      const ua = userAgentForViewport(viewport(preset), '142.0.7444.59')
      expect(ua).toContain('iPhone')
      expect(ua).toContain('Mobile/15E148')
      expect(ua).not.toContain('Chrome/')
    }
  })

  it('uses Android Chrome for Galaxy and Pixel phones', () => {
    for (const preset of [
      'galaxy-s24',
      'galaxy-s24-ultra',
      'pixel-8',
      'pixel-8-pro'
    ] as const) {
      const ua = userAgentForViewport(viewport(preset), '142.0.7444.59')
      expect(ua).toContain('Android 14')
      expect(ua).toContain('Chrome/142.0.7444.59 Mobile Safari')
    }
  })

  it('distinguishes iPad and Android tablets', () => {
    expect(userAgentForViewport(viewport('tablet'), '142.0.7444.59')).toContain('iPad')
    expect(userAgentForViewport(viewport('ipad-air'), '142.0.7444.59')).toContain('iPad')
    const androidTablet = userAgentForViewport(viewport('galaxy-tab-s9'), '142.0.7444.59')
    expect(androidTablet).toContain('Android 14')
    expect(androidTablet).toContain('SM-X710')
    expect(androidTablet).not.toContain('Mobile Safari')
  })

  it('uses a clean desktop Chrome UA for desktop presets', () => {
    for (const preset of ['laptop', 'macbook-air', 'desktop'] as const) {
      const ua = userAgentForViewport(viewport(preset), '142.0.7444.59')
      expect(ua).toContain('Macintosh')
      expect(ua).toContain('Chrome/142.0.7444.59')
      expect(ua).not.toContain('Mobile')
      expect(ua).not.toContain('Electron')
    }
  })

  it('falls back to a safe Chrome version for malformed input', () => {
    const ua = userAgentForViewport(viewport('laptop'), 'not-a-version')
    expect(ua).toContain('Chrome/131.0.0.0')
  })
})
