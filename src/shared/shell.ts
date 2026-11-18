export const SHELL_SCHEME = 'paneflow'
export const SHELL_HOST = 'shell'
export const SHELL_ORIGIN = `${SHELL_SCHEME}://${SHELL_HOST}`
export const SHELL_ENTRY_URL = `${SHELL_ORIGIN}/index.html`

/**
 * Builds the trusted shell CSP. Production has no remote network allowance.
 * The development server origin is added only for the local Vite HMR client.
 * `style-src 'unsafe-inline'` stays because Vue binds pane geometry through
 * inline style attributes; scripts never receive 'unsafe-inline' or eval.
 */
export function buildShellCsp(devServerUrl: string | null): string {
  let connectSources = ["'self'"]

  if (devServerUrl) {
    try {
      const devServer = new URL(devServerUrl)
      if (
        (devServer.protocol === 'http:' || devServer.protocol === 'https:') &&
        devServer.host
      ) {
        const socketProtocol = devServer.protocol === 'https:' ? 'wss:' : 'ws:'
        connectSources = [
          "'self'",
          devServer.origin,
          `${socketProtocol}//${devServer.host}`
        ]
      }
    } catch {
      // A malformed development URL falls back to the production policy.
    }
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

/**
 * Returns true only for the built shell document or the validated development
 * shell origin. IPC sender checks use this in addition to WebContents identity.
 */
export function isTrustedShellDocumentUrl(
  rawUrl: string,
  devServerUrl: string | null
): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }

  if (devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  return (
    parsed.protocol === `${SHELL_SCHEME}:` &&
    parsed.hostname === SHELL_HOST &&
    parsed.pathname === '/index.html'
  )
}
