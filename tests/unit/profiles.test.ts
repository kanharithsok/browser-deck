import { describe, expect, it } from 'vitest'
import {
  PROFILE_STORE_VERSION,
  isValidProfileId,
  normalizeProfileLabel,
  partitionForProfile,
  profilePartitionDirectoryName,
  validateProfileStoreData
} from '../../src/shared/profiles'

const ID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const ID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

describe('profile IDs and partitions', () => {
  it('accepts internally generated UUID v4 IDs', () => {
    expect(isValidProfileId(ID_A)).toBe(true)
    expect(isValidProfileId('not-a-uuid')).toBe(false)
    expect(isValidProfileId(ID_A.toUpperCase())).toBe(false)
  })

  it('derives a persistent partition only from the validated ID', () => {
    expect(partitionForProfile(ID_A)).toBe(`persist:browserdeck-profile-${ID_A}`)
    expect(profilePartitionDirectoryName(ID_A)).toBe(`browserdeck-profile-${ID_A}`)
    expect(() => partitionForProfile('Alice')).toThrow()
    expect(() => profilePartitionDirectoryName('../../outside')).toThrow()
  })

  it('does not leak labels into partition names', () => {
    const partition = partitionForProfile(ID_A)
    expect(partition).not.toContain('Alice')
    expect(partition.startsWith('persist:browserdeck-profile-')).toBe(true)
  })
})

describe('normalizeProfileLabel', () => {
  it('trims valid labels', () => {
    expect(normalizeProfileLabel('  Client work  ')).toBe('Client work')
  })

  it('rejects empty, overlong, and control-character labels', () => {
    expect(normalizeProfileLabel('   ')).toBeNull()
    expect(normalizeProfileLabel('a'.repeat(81))).toBeNull()
    expect(normalizeProfileLabel('bad\u0000label')).toBeNull()
  })
})

describe('validateProfileStoreData', () => {
  it('accepts a valid versioned store', () => {
    const data = {
      version: PROFILE_STORE_VERSION,
      profiles: [
        { id: ID_A, label: 'Profile 1', createdAt: '2026-11-18T10:00:00.000Z' },
        { id: ID_B, label: 'Profile 2', createdAt: '2026-11-18T10:01:00.000Z' }
      ]
    }

    expect(validateProfileStoreData(data)).toEqual({
      ok: true,
      data: {
        version: PROFILE_STORE_VERSION,
        profiles: [
          { id: ID_A, label: 'Profile 1', createdAt: '2026-11-18T10:00:00.000Z' },
          { id: ID_B, label: 'Profile 2', createdAt: '2026-11-18T10:01:00.000Z' }
        ]
      }
    })
  })

  it('rejects unsupported versions and malformed roots', () => {
    expect(validateProfileStoreData({ version: 99, profiles: [] }).ok).toBe(false)
    expect(validateProfileStoreData(null).ok).toBe(false)
    expect(validateProfileStoreData({ version: 1, profiles: {} }).ok).toBe(false)
  })

  it('rejects duplicate or invalid profile IDs', () => {
    expect(
      validateProfileStoreData({
        version: 1,
        profiles: [
          { id: ID_A, label: 'A', createdAt: '2026-11-18T10:00:00.000Z' },
          { id: ID_A, label: 'B', createdAt: '2026-11-18T10:00:00.000Z' }
        ]
      }).ok
    ).toBe(false)

    expect(
      validateProfileStoreData({
        version: 1,
        profiles: [{ id: 'Alice', label: 'A', createdAt: '2026-11-18T10:00:00.000Z' }]
      }).ok
    ).toBe(false)
  })

  it('rejects invalid labels and timestamps', () => {
    expect(
      validateProfileStoreData({
        version: 1,
        profiles: [{ id: ID_A, label: '', createdAt: '2026-11-18T10:00:00.000Z' }]
      }).ok
    ).toBe(false)

    expect(
      validateProfileStoreData({
        version: 1,
        profiles: [{ id: ID_A, label: 'A', createdAt: 'not-a-date' }]
      }).ok
    ).toBe(false)
  })
})
