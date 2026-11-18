import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveShellAssetPath, shellContentType } from '../../src/main/shell-assets'

const ROOT = resolve('/tmp/paneflow-renderer')

describe('resolveShellAssetPath', () => {
  it('maps the root and normal assets inside the renderer directory', () => {
    expect(resolveShellAssetPath(ROOT, '/')).toBe(resolve(ROOT, 'index.html'))
    expect(resolveShellAssetPath(ROOT, '/index.html')).toBe(resolve(ROOT, 'index.html'))
    expect(resolveShellAssetPath(ROOT, '/assets/app-123.js')).toBe(
      resolve(ROOT, 'assets/app-123.js')
    )
    expect(resolveShellAssetPath(ROOT, '/assets/app%20name.css')).toBe(
      resolve(ROOT, 'assets/app name.css')
    )
  })

  it('rejects traversal, null bytes, backslashes, and malformed encoding', () => {
    expect(resolveShellAssetPath(ROOT, '/../package.json')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/assets/../../package.json')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/%2e%2e/package.json')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/assets%2f..%2f..%2fpackage.json')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/bad%00name.js')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/assets\\app.js')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '/assets/%E0%A4%A.js')).toBeNull()
    expect(resolveShellAssetPath(ROOT, '//index.html')).toBeNull()
  })
})

describe('shellContentType', () => {
  it('serves Vue shell assets with explicit MIME types', () => {
    expect(shellContentType('index.html')).toBe('text/html; charset=utf-8')
    expect(shellContentType('app.js')).toBe('text/javascript; charset=utf-8')
    expect(shellContentType('app.css')).toBe('text/css; charset=utf-8')
    expect(shellContentType('icon.svg')).toBe('image/svg+xml')
    expect(shellContentType('font.woff2')).toBe('font/woff2')
    expect(shellContentType('unknown.bin')).toBe('application/octet-stream')
  })
})
