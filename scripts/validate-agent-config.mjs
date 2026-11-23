#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures = []
const warnings = []

function pass(message) {
  console.log(`PASS  ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`FAIL  ${message}`)
}

function warn(message) {
  warnings.push(message)
  console.warn(`WARN  ${message}`)
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function frontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') {
    return null
  }
  const end = lines.indexOf('---', 1)
  return end === -1 ? null : lines.slice(1, end).join('\n')
}

const requiredFiles = [
  'AGENTS.md',
  'SPEC.md',
  '.factory/STATE.md',
  'docs/ARCHITECTURE.md',
  'docs/DECISIONS.md',
  'docs/MANUAL_CHECKS.md',
  'docs/PHASE_REPORTS.md',
  'docs/ROADMAP.md'
]

for (const file of requiredFiles) {
  if (existsSync(join(root, file))) {
    pass(file)
  } else {
    fail(`missing ${file}`)
  }
}

const commandsDir = join(root, '.opencode/commands')
if (!existsSync(commandsDir)) {
  fail('missing .opencode/commands/')
} else {
  const commandFiles = readdirSync(commandsDir)
    .filter((file) => file.endsWith('.md'))
    .sort()

  if (commandFiles.length === 0) {
    fail('.opencode/commands/ has no commands')
  }

  for (const file of commandFiles) {
    const relativePath = `.opencode/commands/${file}`
    const fields = frontmatter(read(relativePath))
    if (!fields) {
      fail(`${relativePath} is missing YAML frontmatter`)
    } else if (!/^description:\s*\S.+$/m.test(fields)) {
      fail(`${relativePath} is missing a non-empty description`)
    } else {
      pass(relativePath)
    }
  }
}

const skillsDir = join(root, '.opencode/skills')
if (!existsSync(skillsDir)) {
  fail('missing .opencode/skills/')
} else {
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  if (skillDirs.length === 0) {
    fail('.opencode/skills/ has no skills')
  }

  for (const dir of skillDirs) {
    const relativePath = `.opencode/skills/${dir}/SKILL.md`
    if (!existsSync(join(root, relativePath))) {
      fail(`missing ${relativePath}`)
      continue
    }

    const fields = frontmatter(read(relativePath))
    if (!fields) {
      fail(`${relativePath} is missing YAML frontmatter`)
      continue
    }

    const name = fields.match(/^name:\s*(.+?)\s*$/m)?.[1]
    const description = fields.match(/^description:\s*(\S.+)$/m)?.[1]
    const slug = name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    if (!name) {
      fail(`${relativePath} is missing a name`)
    } else if (name !== dir && slug !== dir) {
      fail(`${relativePath} name must match its folder (${dir})`)
    } else if (!description) {
      fail(`${relativePath} is missing a non-empty description`)
    } else {
      pass(relativePath)
    }
  }
}

const roadmapPath = 'docs/ROADMAP.md'
const validStatuses = new Set(['NEXT', 'READY', 'BLOCKED', 'IDEA', 'DONE'])

if (existsSync(join(root, roadmapPath))) {
  const roadmap = read(roadmapPath)
  const blocks = roadmap.split(/^### /m).slice(1)
  const ids = []
  const statuses = []

  for (const block of blocks) {
    const heading = block.split('\n', 1)[0]
    const id = heading.match(/^(BD-\d{3})\b/)?.[1]
    if (!id) {
      continue
    }

    ids.push(id)
    const status = block.match(/^- Status:\s*(\S+)/m)?.[1]

    if (!status) {
      fail(`${id} has no Status field`)
      continue
    }
    if (!validStatuses.has(status)) {
      fail(`${id} has invalid status ${status}`)
      continue
    }

    statuses.push(status)
    const requiredFields =
      status === 'IDEA'
        ? ['Priority:', 'Depends:', 'Source:', 'Scope:']
        : ['Priority:', 'Depends:', 'Source:', 'Scope:', 'Done when:', 'Verify:']

    for (const field of requiredFields) {
      if (!block.includes(field)) {
        fail(`${id} is missing ${field}`)
      }
    }

    if (status === 'BLOCKED' && !block.includes('Blocker:')) {
      fail(`${id} is BLOCKED without a Blocker line`)
    }
    if (status === 'DONE' && !/^- Evidence:\s*\S.+$/m.test(block)) {
      fail(`${id} is DONE without an Evidence line`)
    }

    pass(`${id} ${status}`)
  }

  if (ids.length === 0) {
    fail(`${roadmapPath} has no BD-### tasks`)
  }

  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicateIds.length > 0) {
    fail(`${roadmapPath} has duplicate IDs: ${duplicateIds.join(', ')}`)
  }

  const nextCount = statuses.filter((status) => status === 'NEXT').length
  if (nextCount > 1) {
    fail(`${roadmapPath} has ${nextCount} NEXT tasks; keep exactly one or none`)
  } else if (nextCount === 0) {
    warn(`${roadmapPath} has no NEXT task; /next will pick the first READY task`)
  }
}

const statePath = '.factory/STATE.md'
if (existsSync(join(root, statePath))) {
  const state = read(statePath)
  const requiredFields = [
    'Last updated:',
    'Current focus:',
    'Next up:',
    'Blockers:',
    'Last recorded verification:'
  ]

  for (const field of requiredFields) {
    if (!state.includes(field)) {
      fail(`${statePath} is missing "${field}"`)
    }
  }

  if (!/^- Last updated:\s*\d{4}-\d{2}-\d{2}$/m.test(state)) {
    fail(`${statePath} Last updated must be YYYY-MM-DD`)
  }

  if (existsSync(join(root, roadmapPath))) {
    const roadmap = read(roadmapPath)
    const roadmapIds = new Set(
      [...roadmap.matchAll(/^### (BD-\d{3})\b/gm)].map((match) => match[1])
    )
    const stateIds = [
      ...new Set([...state.matchAll(/\bBD-\d{3}\b/g)].map((match) => match[0]))
    ]
    const missingIds = stateIds.filter((id) => !roadmapIds.has(id))

    if (missingIds.length > 0) {
      fail(`${statePath} references unknown roadmap IDs: ${missingIds.join(', ')}`)
    } else if (stateIds.length > 0) {
      pass(`${statePath} roadmap references resolve`)
    }
  }
}

if (failures.length > 0) {
  console.error(
    `\nAgent configuration validation FAILED (${failures.length} issue(s), ${warnings.length} warning(s)).`
  )
  process.exitCode = 1
} else {
  console.log(
    `\nAgent configuration validation PASSED (${warnings.length} warning(s)).`
  )
}
