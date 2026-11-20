export const PROFILE_STORE_VERSION = 1

export interface BrowserProfile {
  id: string
  label: string
  createdAt: string
}

export interface ProfileStoreData {
  version: typeof PROFILE_STORE_VERSION
  profiles: BrowserProfile[]
}

export interface ProfileSummary extends BrowserProfile {
  paneIds: string[]
  inUse: boolean
}

const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_LABEL_LENGTH = 80
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function isValidProfileId(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_ID_PATTERN.test(value)
}

/**
 * Directory names below Electron's `Partitions` folder are derived only from
 * validated internal profile IDs, never from user-entered labels or URLs.
 */
export function profilePartitionDirectoryName(profileId: string): string {
  if (!isValidProfileId(profileId)) {
    throw new Error('Invalid profile ID')
  }
  return `browserdeck-profile-${profileId}`
}

/**
 * Partition names are derived only from validated internal profile IDs, never
 * from user-entered labels or URLs.
 */
export function partitionForProfile(profileId: string): string {
  return `persist:${profilePartitionDirectoryName(profileId)}`
}

export function normalizeProfileLabel(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed || trimmed.length > MAX_LABEL_LENGTH || CONTROL_CHARACTERS.test(trimmed)) {
    return null
  }
  return trimmed
}

export function validateProfileStoreData(
  input: unknown
): { ok: true; data: ProfileStoreData } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Profile store must be an object.' }
  }

  const record = input as Record<string, unknown>
  if (record.version !== PROFILE_STORE_VERSION) {
    return { ok: false, error: 'Unsupported profile store version.' }
  }

  if (!Array.isArray(record.profiles)) {
    return { ok: false, error: 'Profiles must be an array.' }
  }

  const seen = new Set<string>()
  const profiles: BrowserProfile[] = []

  for (const entry of record.profiles) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Profile entry must be an object.' }
    }

    const profile = entry as Record<string, unknown>
    if (!isValidProfileId(profile.id) || seen.has(profile.id)) {
      return { ok: false, error: 'Profile ID is invalid or duplicated.' }
    }

    if (typeof profile.label !== 'string') {
      return { ok: false, error: 'Profile label is invalid.' }
    }

    const label = normalizeProfileLabel(profile.label)
    if (!label) {
      return { ok: false, error: 'Profile label is invalid.' }
    }

    if (typeof profile.createdAt !== 'string' || Number.isNaN(Date.parse(profile.createdAt))) {
      return { ok: false, error: 'Profile creation date is invalid.' }
    }

    seen.add(profile.id)
    profiles.push({
      id: profile.id,
      label,
      createdAt: new Date(profile.createdAt).toISOString()
    })
  }

  return { ok: true, data: { version: PROFILE_STORE_VERSION, profiles } }
}
