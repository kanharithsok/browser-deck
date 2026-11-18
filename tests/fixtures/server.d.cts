export interface FixtureServer {
  url: string
  port: number
  close: () => Promise<void>
}

export function startFixtureServer(options?: { port?: number }): Promise<FixtureServer>
