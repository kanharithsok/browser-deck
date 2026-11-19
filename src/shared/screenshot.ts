// eslint-disable-next-line no-control-regex
const WINDOWS_RESERVED_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

function safeHostname(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
      .toLowerCase()
      .replace(WINDOWS_RESERVED_CHARACTERS, '-')
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80)
  } catch {
    return ''
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Builds a friendly, filesystem-safe default screenshot name. The caller still
 * goes through the native save dialog, so this is only a suggestion.
 */
export function screenshotFileName(url: string, now: Date): string {
  const host = safeHostname(url) || 'device'
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('')
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('')
  return `${host}-${stamp}-${time}.png`
}
