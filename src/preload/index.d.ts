import type { PaneFlowApi } from '../shared/ipc'

declare global {
  interface Window {
    paneflow: PaneFlowApi
  }
}

export {}
