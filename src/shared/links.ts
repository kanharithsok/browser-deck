export const PROJECT_LINKS = {
  repository: 'https://github.com/kanharithsok/browser-deck',
  sponsor: 'https://github.com/sponsors/kanharithsok'
} as const

export type ProjectLink = keyof typeof PROJECT_LINKS

export function isProjectLink(value: unknown): value is ProjectLink {
  return value === 'repository' || value === 'sponsor'
}
