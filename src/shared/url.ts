export type NormalizedUrl =
  | { ok: true; url: string; insecureRemote: boolean }
  | { ok: false; error: string }

const BARE_HOST_PORT = /^(?:[a-zA-Z0-9._-]+|\[[0-9a-fA-F:.]+\]):\d{1,5}(?:[/?#].*)?$/
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true
  }

  const ipv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return Boolean(ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255))
}

function isLoopbackOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (isLoopbackHostname(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!ipv4) {
    return false
  }

  const octets = ipv4.slice(1).map((part) => Number(part))
  if (octets.some((part) => part > 255)) {
    return false
  }

  const [first, second] = octets as [number, number, number, number]
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

export function isAllowedNavigationUrl(url: string): boolean {
  if (url === 'about:blank') {
    return true
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalizes a user-entered address. Local and bare host:port development
 * addresses default to HTTP; other hostnames default to HTTPS. Only http,
 * https, and about:blank survive validation.
 */
export function normalizeAddress(rawInput: string): NormalizedUrl {
  const input = rawInput.trim()
  if (!input) {
    return { ok: false, error: 'Enter an address.' }
  }

  if (input === 'about:blank') {
    return { ok: true, url: input, insecureRemote: false }
  }

  if (/^about:/i.test(input)) {
    return { ok: false, error: 'Only about:blank is supported.' }
  }

  let candidate = input
  const hasScheme = SCHEME.test(input)

  if (BARE_HOST_PORT.test(input)) {
    candidate = `http://${input}`
  } else if (!hasScheme) {
    const hostPart = input.split(/[/?#]/, 1)[0] ?? ''
    const hostname = hostPart.replace(/:\d+$/, '')
    const scheme = isLoopbackOrLocalHostname(hostname) ? 'http' : 'https'
    candidate = `${scheme}://${input}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, error: 'Enter a valid URL.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'Only http, https, and about:blank addresses are allowed.'
    }
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'Enter a valid URL with a hostname.' }
  }

  const isLocal = isLoopbackOrLocalHostname(parsed.hostname)
  return {
    ok: true,
    url: parsed.toString(),
    insecureRemote: parsed.protocol === 'http:' && !isLocal
  }
}
