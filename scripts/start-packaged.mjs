import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const dist = join(root, 'dist')

const entries = await readdir(dist, { withFileTypes: true }).catch(() => [])
const appDirectory = entries.find(
  (entry) => entry.isDirectory() && entry.name.startsWith('mac')
)

if (!appDirectory) {
  console.error('Could not find a packaged macOS app under dist/. Run `npm run package:dir` first.')
  process.exit(1)
}

const appBundle = join(dist, appDirectory.name, 'PaneFlow.app')
const binary = join(appBundle, 'Contents', 'MacOS', 'PaneFlow')

try {
  await access(binary)
} catch {
  console.error(`Could not find the PaneFlow executable at ${binary}.`)
  process.exit(1)
}

const child = spawn(binary, [], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown || child.killed) {
    return
  }
  shuttingDown = true
  child.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal))
}

child.on('error', (error) => {
  console.error('Could not launch the packaged PaneFlow app.', error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
