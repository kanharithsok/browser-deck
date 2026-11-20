import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileStore } from '../../src/main/profile-store'
import { PROFILE_STORE_VERSION, validateProfileStoreData } from '../../src/shared/profiles'

const tempDirectories: string[] = []

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'paneflow-profiles-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('ProfileStore', () => {
  it('seeds two distinctly labelled profiles and persists them', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()

    expect(store.list()).toHaveLength(2)
    expect(store.list().map((profile) => profile.label)).toEqual(['Profile 1', 'Profile 2'])
    expect(store.list()[0]?.id).not.toBe(store.list()[1]?.id)

    const raw = await readFile(join(directory, 'profiles.json'), 'utf8')
    const validated = validateProfileStoreData(JSON.parse(raw))
    expect(validated.ok).toBe(true)
    if (validated.ok) {
      expect(validated.data.version).toBe(PROFILE_STORE_VERSION)
      expect(validated.data.profiles).toHaveLength(2)
    }

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.list().map((profile) => profile.id)).toEqual(
      store.list().map((profile) => profile.id)
    )
  })

  it('adds a new profile with a unique label when all slots are used', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()

    const created = await store.create()
    expect(created.label).toBe('Profile 3')
    expect(store.list()).toHaveLength(3)
  })

  it('restores a workspace-referenced profile ID without changing its partition identity', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()

    const restoredId = '11111111-1111-4111-8111-111111111111'
    const restored = await store.ensure(restoredId)
    expect(restored.id).toBe(restoredId)
    expect(restored.label).toBe('Profile 3')
    expect(store.get(restoredId)?.id).toBe(restoredId)

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.get(restoredId)?.label).toBe('Profile 3')
    await expect(store.ensure('not-a-profile')).rejects.toThrow()
  })

  it('removes profile metadata', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()
    const [first, second] = store.list()
    if (!first || !second) {
      throw new Error('Expected seeded profiles')
    }

    await store.remove(second.id)
    expect(store.get(second.id)).toBeUndefined()

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.get(first.id)?.id).toBe(first.id)
    expect(reloaded.get(second.id)).toBeUndefined()
  })

  it('preserves a corrupt file and recovers to safe defaults', async () => {
    const directory = await makeDirectory()
    await writeFile(join(directory, 'profiles.json'), '{ definitely not json', 'utf8')

    const store = new ProfileStore(directory)
    await store.load()

    expect(store.list()).toHaveLength(2)
    const entries = await readdir(directory)
    expect(entries.some((entry) => entry.includes('.corrupt-'))).toBe(true)

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(2)
  })

  it('does not create duplicate IDs when loading an existing store', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()
    const originalIds = store.list().map((profile) => profile.id)

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.list().map((profile) => profile.id)).toEqual(originalIds)
  })

  it('serializes concurrent profile writes without losing records', async () => {
    const directory = await makeDirectory()
    const store = new ProfileStore(directory)
    await store.load()

    const created = await Promise.all([
      store.create('Concurrent A'),
      store.create('Concurrent B'),
      store.create('Concurrent C')
    ])

    const reloaded = new ProfileStore(directory)
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(5)
    for (const profile of created) {
      expect(reloaded.list().some((entry) => entry.id === profile.id)).toBe(true)
    }
  })
})
