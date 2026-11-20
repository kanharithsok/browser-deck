import { findViewportPreset, type PaneViewport } from './viewports'

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const IPAD_USER_AGENT =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const ANDROID_TABLET_MODEL = 'SM-X710'

const FALLBACK_CHROME_VERSION = '131.0.0.0'

const CHROME_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/

const ANDROID_PHONE_PRESETS = new Set([
  'galaxy-s24',
  'galaxy-s24-ultra',
  'pixel-8',
  'pixel-8-pro'
])

function safeChromeVersion(version: string): string {
  return CHROME_VERSION_PATTERN.test(version) ? version : FALLBACK_CHROME_VERSION
}

export function desktopChromeUserAgent(chromeVersion: string): string {
  const version = safeChromeVersion(chromeVersion)
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
}

export function androidPhoneUserAgent(chromeVersion: string): string {
  const version = safeChromeVersion(chromeVersion)
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`
}

export function androidTabletUserAgent(chromeVersion: string): string {
  const version = safeChromeVersion(chromeVersion)
  return `Mozilla/5.0 (Linux; Android 14; ${ANDROID_TABLET_MODEL}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
}

/**
 * Category-appropriate browser identity for a fixed device preset. Responsive
 * and custom viewports return null so the pane keeps Electron's default UA.
 * The user agent exists for layout fidelity, not to bypass site restrictions.
 */
export function userAgentForViewport(
  viewport: PaneViewport,
  chromeVersion: string
): string | null {
  const preset = findViewportPreset(viewport.preset)
  if (!preset) {
    return null
  }

  if (preset.category === 'desktop') {
    return desktopChromeUserAgent(chromeVersion)
  }

  if (preset.category === 'tablet') {
    return preset.id === 'galaxy-tab-s9'
      ? androidTabletUserAgent(chromeVersion)
      : IPAD_USER_AGENT
  }

  return ANDROID_PHONE_PRESETS.has(preset.id)
    ? androidPhoneUserAgent(chromeVersion)
    : IPHONE_USER_AGENT
}
