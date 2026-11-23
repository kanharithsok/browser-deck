import { normalizeAddress } from './url'

export const MAX_BULK_BROWSERS = 50

export type BulkUrlParseResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: string }

/**
 * Parse one URL per line. Blank lines are ignored. The renderer uses this for
 * immediate feedback, but main validates every URL again before creating a pane.
 */
export function parseBulkUrlInput(input: string): BulkUrlParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return { ok: false, error: 'Paste at least one URL.' }
  }
  if (lines.length > MAX_BULK_BROWSERS) {
    return { ok: false, error: `Open at most ${MAX_BULK_BROWSERS} browsers at once.` }
  }

  const urls: string[] = []
  for (const [index, line] of lines.entries()) {
    const normalized = normalizeAddress(line)
    if (!normalized.ok) {
      return { ok: false, error: `Line ${index + 1}: ${normalized.error}` }
    }
    urls.push(normalized.url)
  }

  return { ok: true, urls }
}
