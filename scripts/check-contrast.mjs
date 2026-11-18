import { readFile } from 'node:fs/promises'

const css = await readFile('src/renderer/src/assets/app.css', 'utf8')

function tokensFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (!match) {
    throw new Error(`Missing CSS token block: ${selector}`)
  }
  const tokens = {}
  for (const line of match[1].split('\n')) {
    const token = /--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/.exec(line)
    if (token) {
      tokens[token[1]] = token[2]
    }
  }
  return tokens
}

function channel(value) {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function contrast(foreground, background) {
  const first = luminance(foreground)
  const second = luminance(background)
  const light = Math.max(first, second)
  const dark = Math.min(first, second)
  return (light + 0.05) / (dark + 0.05)
}

const themes = {
  light: tokensFor(":root[data-theme='light']"),
  dark: tokensFor(":root[data-theme='dark']")
}

const checks = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-raised', 4.5],
  ['text', 'surface-inset', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-faint', 'bg', 4.5],
  ['text-faint', 'surface', 4.5],
  ['accent-strong', 'accent-soft', 4.5],
  ['accent', 'surface', 3],
  ['focus', 'surface', 3],
  ['danger', 'danger-soft', 4.5],
  ['danger', 'surface', 4.5]
]

let failed = false
for (const [theme, tokens] of Object.entries(themes)) {
  console.log(`\n${theme}`)
  for (const [foreground, background, minimum] of checks) {
    if (!tokens[foreground] || !tokens[background]) {
      throw new Error(`Missing ${foreground}/${background} in ${theme}`)
    }
    const ratio = contrast(tokens[foreground], tokens[background])
    const passed = ratio >= minimum
    failed ||= !passed
    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${foreground} on ${background}: ${ratio.toFixed(2)} (min ${minimum})`
    )
  }
}

if (failed) {
  process.exitCode = 1
}
