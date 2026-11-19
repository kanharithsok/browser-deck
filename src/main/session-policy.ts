import { session, type Session } from 'electron'
import { partitionForProfile } from '../shared/profiles'

export type BlockedActionEvent =
  | { kind: 'permission'; webContentsId: number; permission: string }
  | { kind: 'download'; profileId: string; origin: string }

let blockedActionReporter: ((event: BlockedActionEvent) => void) | null = null
const sessionProfileIds = new WeakMap<Session, string>()
const hardenedSessions = new WeakSet<Session>()

/** Installs the app-level reporter for actions denied by the remote policy. */
export function setBlockedActionReporter(
  reporter: ((event: BlockedActionEvent) => void) | null
): void {
  blockedActionReporter = reporter
}

function reportBlockedAction(event: BlockedActionEvent): void {
  try {
    blockedActionReporter?.(event)
  } catch {
    // A reporting failure must never change the deny-by-default outcome.
  }
}

/**
 * Applies the deny-by-default policy to a session. This covers remote pane
 * profiles and the trusted shell session; the shell never needs web
 * permissions, device access, screen capture, or downloads.
 */
export function hardenSession(targetSession: Session): void {
  if (hardenedSessions.has(targetSession)) {
    return
  }

  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false)
    const webContentsId = webContents.id
    if (!webContents.isDestroyed()) {
      reportBlockedAction({ kind: 'permission', webContentsId, permission })
    }
  })
  targetSession.setPermissionCheckHandler(() => false)
  targetSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback(null)
  })
  targetSession.setDevicePermissionHandler(() => false)
  targetSession.setBluetoothPairingHandler((_details, callback) => {
    callback({ confirmed: false })
  })
  targetSession.on('will-download', (event, item) => {
    // Downloads are outside the MVP. Deny rather than hand remote content an
    // unmanaged filesystem path.
    event.preventDefault()
    const profileId = sessionProfileIds.get(targetSession)
    if (!profileId) {
      return
    }
    let origin = item.getInitiatorOrigin()
    if (!origin) {
      try {
        origin = new URL(item.getURL()).origin
      } catch {
        origin = ''
      }
    }
    reportBlockedAction({ kind: 'download', profileId, origin })
  })

  hardenedSessions.add(targetSession)
}

/**
 * Returns a persistent Electron session for an internally generated profile ID
 * and applies the remote-content policy to it.
 */
export function getProfileSession(profileId: string): Session {
  const targetSession = session.fromPartition(partitionForProfile(profileId), { cache: true })
  sessionProfileIds.set(targetSession, profileId)
  hardenSession(targetSession)
  return targetSession
}
