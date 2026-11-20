import { describe, expect, it } from 'vitest'
import {
  SHELL_ENTRY_URL,
  SHELL_MINIMAP_URL,
  SHELL_ZOOM_URL,
  buildShellCsp,
  isTrustedMinimapDocumentUrl,
  isTrustedShellDocumentUrl,
  isTrustedZoomDocumentUrl
} from '../../src/shared/shell'

describe('shell CSP', () => {
  it('uses a production policy without local development connections', () => {
    const csp = buildShellCsp(null)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("script-src-attr 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('ws://')
    expect(csp).not.toContain('localhost')
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('allows only the explicit loopback development origin and socket', () => {
    const csp = buildShellCsp('http://localhost:5173')
    expect(csp).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173")
    expect(csp).not.toContain('*')

    const secure = buildShellCsp('https://127.0.0.1:5174')
    expect(secure).toContain("connect-src 'self' https://127.0.0.1:5174 wss://127.0.0.1:5174")
  })

  it('falls back to production sources for malformed development URLs', () => {
    expect(buildShellCsp('not a url')).toContain("connect-src 'self'")
    expect(buildShellCsp('file:///tmp/index.html')).toContain("connect-src 'self'")
  })
})

describe('trusted shell documents', () => {
  it('accepts only the built shell entry document in production', () => {
    expect(isTrustedShellDocumentUrl(SHELL_ENTRY_URL, null)).toBe(true)
    expect(isTrustedShellDocumentUrl(`${SHELL_ENTRY_URL}?theme=dark`, null)).toBe(true)
    expect(isTrustedShellDocumentUrl('browserdeck://shell/', null)).toBe(false)
    expect(isTrustedShellDocumentUrl('browserdeck://shell/other.html', null)).toBe(false)
    expect(isTrustedShellDocumentUrl('browserdeck://evil/index.html', null)).toBe(false)
    expect(isTrustedShellDocumentUrl('file:///tmp/index.html', null)).toBe(false)
    expect(isTrustedShellDocumentUrl('https://example.com/index.html', null)).toBe(false)
    expect(isTrustedShellDocumentUrl('not a url', null)).toBe(false)
  })

  it('accepts the validated development origin only', () => {
    expect(
      isTrustedShellDocumentUrl('http://localhost:5173/', 'http://localhost:5173')
    ).toBe(true)
    expect(
      isTrustedShellDocumentUrl('http://localhost:5173/index.html', 'http://localhost:5173')
    ).toBe(true)
    expect(
      isTrustedShellDocumentUrl('https://example.com/', 'http://localhost:5173')
    ).toBe(false)
    expect(isTrustedShellDocumentUrl('http://localhost:5173/', 'not a url')).toBe(false)
  })
})

describe('trusted zoom documents', () => {
  it('accepts only the built zoom document in production', () => {
    expect(isTrustedZoomDocumentUrl(SHELL_ZOOM_URL, null)).toBe(true)
    expect(isTrustedZoomDocumentUrl(`${SHELL_ZOOM_URL}?theme=dark`, null)).toBe(true)
    expect(isTrustedZoomDocumentUrl(SHELL_ENTRY_URL, null)).toBe(false)
    expect(isTrustedZoomDocumentUrl(SHELL_MINIMAP_URL, null)).toBe(false)
    expect(isTrustedZoomDocumentUrl('browserdeck://shell/other.html', null)).toBe(false)
    expect(isTrustedZoomDocumentUrl('browserdeck://evil/zoom.html', null)).toBe(false)
    expect(isTrustedZoomDocumentUrl('not a url', null)).toBe(false)
  })

  it('requires the zoom path on the validated development origin', () => {
    expect(
      isTrustedZoomDocumentUrl('http://localhost:5173/zoom.html', 'http://localhost:5173')
    ).toBe(true)
    expect(
      isTrustedZoomDocumentUrl('http://localhost:5173/minimap.html', 'http://localhost:5173')
    ).toBe(false)
    expect(
      isTrustedZoomDocumentUrl('https://example.com/zoom.html', 'http://localhost:5173')
    ).toBe(false)
  })
})

describe('trusted minimap documents', () => {
  it('accepts only the built minimap document in production', () => {
    expect(isTrustedMinimapDocumentUrl(SHELL_MINIMAP_URL, null)).toBe(true)
    expect(isTrustedMinimapDocumentUrl(`${SHELL_MINIMAP_URL}?theme=dark`, null)).toBe(true)
    expect(isTrustedMinimapDocumentUrl(SHELL_ENTRY_URL, null)).toBe(false)
    expect(isTrustedMinimapDocumentUrl('browserdeck://shell/other.html', null)).toBe(false)
    expect(isTrustedMinimapDocumentUrl('browserdeck://evil/minimap.html', null)).toBe(false)
    expect(isTrustedMinimapDocumentUrl('file:///tmp/minimap.html', null)).toBe(false)
    expect(isTrustedMinimapDocumentUrl('not a url', null)).toBe(false)
  })

  it('requires the minimap path on the validated development origin', () => {
    expect(
      isTrustedMinimapDocumentUrl('http://localhost:5173/minimap.html', 'http://localhost:5173')
    ).toBe(true)
    expect(
      isTrustedMinimapDocumentUrl('http://localhost:5173/', 'http://localhost:5173')
    ).toBe(false)
    expect(
      isTrustedMinimapDocumentUrl('https://example.com/minimap.html', 'http://localhost:5173')
    ).toBe(false)
    expect(isTrustedMinimapDocumentUrl('http://localhost:5173/minimap.html', 'not a url')).toBe(
      false
    )
  })
})
