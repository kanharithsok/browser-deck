import { spawn } from 'node:child_process'
import serverModule from '../tests/fixtures/server.cjs'

const { startFixtureServer } = serverModule

const fixturePort = Number(process.env.BROWSERDECK_FIXTURE_PORT ?? '0')
const fixture = await startFixtureServer({ port: Number.isFinite(fixturePort) ? fixturePort : 0 })

const startUrls = [
  `${fixture.url}/pane/one?user=alice`,
  `${fixture.url}/pane/two?user=bob`
].join(',')

console.log(`BrowserDeck fixtures: ${fixture.url}`)
console.log('Starting electron-vite development server…')

const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BROWSERDECK_START_URLS: startUrls
  }
})

let shuttingDown = false

async function shutdown(code) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  if (!child.killed) {
    child.kill('SIGTERM')
  }

  try {
    await fixture.close()
  } finally {
    process.exit(code)
  }
}

child.on('exit', (code, signal) => {
  if (shuttingDown) {
    return
  }
  const exitCode = code ?? (signal ? 1 : 0)
  void shutdown(exitCode)
})

child.on('error', (error) => {
  console.error('Failed to start electron-vite.', error)
  void shutdown(1)
})

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})
