import type { BrowserDeckApi } from '../shared/ipc'

declare global {
  interface Window {
    browserdeck: BrowserDeckApi
  }
}

export {}
