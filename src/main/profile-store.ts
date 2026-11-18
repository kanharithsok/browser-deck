import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PROFILE_STORE_VERSION,
  normalizeProfileLabel,
  validateProfileStoreData,
  type BrowserProfile,
  type ProfileStoreData
} from '../shared/profiles'

const PROFILE_FILE = 'profiles.json'

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function writeJsonAtomically(filePath: string, data: unknown): Promise<void> {
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

/**
 * Minimal Phase 0 profile registry. It owns persistent profile records so the
 * same Electron partitions can be reused across restarts. Full profile
 * management (rename/clear/delete) arrives in Phase 3.
 */
export class ProfileStore {
  private profiles: BrowserProfile[] = []
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  private get filePath(): string {
    return join(this.directory, PROFILE_FILE)
  }

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true })

    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (!isNotFound(error)) {
        throw error
      }
      this.profiles = []
      await this.ensureCount(2)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await this.preserveCorruptFile()
      this.profiles = []
      await this.ensureCount(2)
      return
    }

    const validated = validateProfileStoreData(parsed)
    if (!validated.ok) {
      await this.preserveCorruptFile()
      this.profiles = []
      await this.ensureCount(2)
      return
    }

    this.profiles = validated.data.profiles
    await this.ensureCount(2)
  }

  list(): readonly BrowserProfile[] {
    return this.profiles
  }

  get(profileId: string): BrowserProfile | undefined {
    return this.profiles.find((profile) => profile.id === profileId)
  }

  async create(label?: string): Promise<BrowserProfile> {
    const normalized = label === undefined ? null : normalizeProfileLabel(label)
    const profile: BrowserProfile = {
      id: randomUUID(),
      label: normalized ?? this.nextDefaultLabel(),
      createdAt: new Date().toISOString()
    }
    this.profiles = [...this.profiles, profile]
    await this.save()
    return profile
  }

  async ensureCount(count: number): Promise<void> {
    if (this.profiles.length >= count) {
      return
    }

    const usedLabels = new Set(this.profiles.map((profile) => profile.label))
    const additions: BrowserProfile[] = []

    for (let index = this.profiles.length; index < count; index += 1) {
      let number = 1
      while (usedLabels.has(`Profile ${number}`)) {
        number += 1
      }
      const label = `Profile ${number}`
      usedLabels.add(label)
      additions.push({
        id: randomUUID(),
        label,
        createdAt: new Date().toISOString()
      })
    }

    this.profiles = [...this.profiles, ...additions]
    await this.save()
  }

  private nextDefaultLabel(): string {
    const usedLabels = new Set(this.profiles.map((profile) => profile.label))
    let number = 1
    while (usedLabels.has(`Profile ${number}`)) {
      number += 1
    }
    return `Profile ${number}`
  }

  private save(): Promise<void> {
    const data: ProfileStoreData = {
      version: PROFILE_STORE_VERSION,
      profiles: [...this.profiles]
    }

    // Serialize writes so an older snapshot cannot rename over a newer one.
    const next = this.saveQueue.then(() => writeJsonAtomically(this.filePath, data))
    this.saveQueue = next.catch(() => undefined)
    return next
  }

  private async preserveCorruptFile(): Promise<void> {
    const preservedPath = `${this.filePath}.corrupt-${timestampSuffix()}`
    await rename(this.filePath, preservedPath).catch(() => undefined)
  }
}
