import { app } from 'electron'
import type { PaneViewRect, ShellState } from '../shared/ipc'

export interface PaneflowTestHook {
  snapshot: () => ShellState
  viewBounds: () => Array<{ paneId: string; rect: PaneViewRect }>
  viewStates: () => Array<{ paneId: string; rect: PaneViewRect; visible: boolean }>
  readCookie: (paneId: string) => Promise<string | null>
  webContentsId: (paneId: string) => number | null
  shellWebContentsId: () => number | null
  contentBounds: () => PaneViewRect | null
}

/**
 * Exposes read-mostly inspection hooks for the Playwright integration test.
 * Disabled in packaged builds and unless PANEFLOW_TEST=1 is set explicitly.
 */
export function installTestHook(hook: PaneflowTestHook): void {
  if (process.env.PANEFLOW_TEST !== '1' || app.isPackaged) {
    return
  }

  Object.defineProperty(globalThis, '__paneflowTest', {
    value: hook,
    configurable: true,
    enumerable: false,
    writable: false
  })
}
