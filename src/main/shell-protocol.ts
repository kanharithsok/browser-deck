import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import { SHELL_HOST, SHELL_SCHEME } from '../shared/shell'
import { resolveShellAssetPath, shellContentType } from './shell-assets'

const SHELL_RESPONSE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
} as const

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { ...SHELL_RESPONSE_HEADERS }
  })
}

/**
 * Registers the internal shell scheme before `app` is ready. It is a standard,
 * secure origin with no service workers, extensions, CORS, or CSP bypass.
 */
export function registerShellScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SHELL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: false,
        allowServiceWorkers: false,
        allowExtensions: false,
        bypassCSP: false
      }
    }
  ])
}

/**
 * Serves the built Vue shell from a custom protocol instead of exposing broad
 * `file://` access. Every response is same-origin, MIME-typed, and carries the
 * production shell CSP.
 */
export function installShellProtocol(rendererRoot: string, csp: string): void {
  protocol.handle(SHELL_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return emptyResponse(405)
    }

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return emptyResponse(400)
    }

    if (url.hostname !== SHELL_HOST) {
      return emptyResponse(404)
    }

    const filePath = resolveShellAssetPath(rendererRoot, url.pathname)
    if (!filePath) {
      return emptyResponse(404)
    }

    let data: Buffer
    try {
      data = await readFile(filePath)
    } catch {
      return emptyResponse(404)
    }

    return new Response(request.method === 'HEAD' ? null : new Uint8Array(data), {
      status: 200,
      headers: {
        ...SHELL_RESPONSE_HEADERS,
        'Content-Type': shellContentType(filePath),
        'Content-Security-Policy': csp
      }
    })
  })
}
