import { extname, isAbsolute, relative, resolve } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

/**
 * Maps a custom-protocol URL path to a file inside the built renderer root.
 * Rejects empty, dot, parent, backslash, and null-byte segments so the shell
 * protocol cannot read outside its own asset directory.
 */
export function resolveShellAssetPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  if (decoded.includes('\0') || decoded.includes('\\') || decoded.startsWith('//')) {
    return null
  }

  const withoutLeadingSlashes = decoded.replace(/^\/+/, '')
  const relativePath = withoutLeadingSlashes === '' ? 'index.html' : withoutLeadingSlashes
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  const rootPath = resolve(root)
  const filePath = resolve(rootPath, relativePath)
  const relativeToRoot = relative(rootPath, filePath)
  if (
    relativeToRoot === '' ||
    relativeToRoot.startsWith('..') ||
    isAbsolute(relativeToRoot)
  ) {
    return null
  }

  return filePath
}

export function shellContentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
