export type PaneChromeStyle = 'a' | 'b' | 'c'

export const PANE_CHROME_STYLES: readonly PaneChromeStyle[] = ['a', 'b', 'c']

export function isPaneChromeStyle(value: unknown): value is PaneChromeStyle {
  return value === 'a' || value === 'b' || value === 'c'
}

export function paneChromeLabel(style: PaneChromeStyle): string {
  switch (style) {
    case 'a':
      return 'Quiet bar'
    case 'b':
      return 'Canvas label'
    case 'c':
      return 'Global bar'
  }
}
