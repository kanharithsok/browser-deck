import { session, type Session } from 'electron'
import { partitionForProfile } from '../shared/profiles'

const hardenedSessions = new WeakSet<Session>()

function hardenSession(targetSession: Session): void {
  if (hardenedSessions.has(targetSession)) {
    return
  }

  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  targetSession.setPermissionCheckHandler(() => false)
  targetSession.on('will-download', (event) => {
    // Downloads are outside the Phase 0 spike. Deny rather than hand remote
    // content an unmanaged filesystem path.
    event.preventDefault()
  })

  hardenedSessions.add(targetSession)
}

/**
 * Returns a persistent Electron session for an internally generated profile ID
 * and applies the remote-content policy to it.
 */
export function getProfileSession(profileId: string): Session {
  const targetSession = session.fromPartition(partitionForProfile(profileId), { cache: true })
  hardenSession(targetSession)
  return targetSession
}
