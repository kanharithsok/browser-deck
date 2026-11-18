import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'

export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export type JsonReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'invalid' }

export async function readJsonFile(filePath: string): Promise<JsonReadResult> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) {
      return { status: 'missing' }
    }
    throw error
  }

  try {
    return { status: 'ok', value: JSON.parse(raw) as unknown }
  } catch {
    return { status: 'invalid' }
  }
}

export async function writeJsonAtomically(filePath: string, data: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
  const handle = await open(temporaryPath, 'w')
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function preserveCorruptFile(filePath: string): Promise<void> {
  await rename(filePath, `${filePath}.corrupt-${timestampSuffix()}`).catch(() => undefined)
}
