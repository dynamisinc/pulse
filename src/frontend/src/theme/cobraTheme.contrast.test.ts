/**
 * theme/cobraTheme.contrast.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback 25 (#543; DF-37; #461 §1; #450 F-6; NFR-001 WCAG 2.1 AA). The COBRA
 * muted-text token, COMPUTED against every COBRA surface it is painted on (never an
 * eyeballed ratio), plus the other staff inks this story checked: the dark console
 * chrome's `inkMuted` / `inkFaint`, the navy header's muted ink, and the delete
 * button's hover fill under its white label.
 *
 * And the two-worlds boundary for the token: no participant file (`features/social/**`,
 * `features/participant-shell/**`) imports `theme/cobraTheme`, so no participant brand
 * can inherit `text.muted`. (The broader staff-chrome gate is
 * `features/staffShell/twoWorldsSeparation.test.ts`.)
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb } from '@/test/contrast'
import { consoleChrome } from '@/features/controller/consoleChrome'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { cobraTheme } from './cobraTheme'

const AA_TEXT = 4.5
const { palette } = cobraTheme
const muted = palette.text.muted

/** `fg` at `opacity` over an opaque `bg` (both #rrggbb) — what an `alpha()` tint renders as. */
function over(fg: string, opacity: number, bg: string): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  return '#' + f.map((c, i) => Math.round(c * opacity + (b[i] ?? 0) * (1 - opacity))
    .toString(16).padStart(2, '0')).join('')
}

/**
 * Every light COBRA ground the token is painted on (staff world). Named so a failure says
 * which surface broke.
 */
const SURFACES: Record<string, string> = {
  'background.paper (white panels, dialogs, menus, evaluator cards)': palette.background.paper,
  'background.default (staff work area, evaluator tabs)': palette.background.default,
  'breadcrumb.background': palette.breadcrumb.background,
  'grid.light (table header)': palette.grid.light,
  'grid.main (selected row, command-palette highlight)': palette.grid.main,
  'primary.light (the "not started" status chip)': palette.primary.light,
  'grey.100 (persona edit preview ground)': palette.grey[100],
  'toolstrip active tint (navy at 8% over white)':
    over(staffShellTokens.header.background, 0.08, palette.background.paper),
  'persona context band (#eaf1f9)': '#eaf1f9',
  'evaluator stream row / hover (#f4f7fa)': '#f4f7fa',
  'evaluator off-platform row (#f7f4fc)': '#f7f4fc',
  'evaluator dial row (#fffaf0)': '#fffaf0',
  'evaluator stage frame (#fbfcfd)': '#fbfcfd',
}

describe('COBRA muted-text token (palette.text.muted)', () => {
  it('is a #rrggbb value and text.secondary is the same token (MUI labels and helper text)', () => {
    expect(muted).toMatch(/^#[0-9a-f]{6}$/i)
    expect(palette.text.secondary).toBe(muted)
  })

  it.each(Object.entries(SURFACES))('clears AA (4.5:1) on %s', (_name, surface) => {
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('carries a white label when used as a fill (the toolstrip count badge)', () => {
    expect(contrastRatio('#ffffff', muted)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the staff shell secondary text IS the token, not a second grey', () => {
    expect(staffShellTokens.accent.secondaryText).toBe(muted)
  })
})

describe('other staff inks checked by story 25', () => {
  const darkSurfaces = {
    bg: consoleChrome.bg,
    panel: consoleChrome.panel,
    card: consoleChrome.card,
  }

  it.each(Object.entries(darkSurfaces))('console inkMuted and inkFaint clear AA on %s', (_n, surface) => {
    expect(contrastRatio(consoleChrome.inkMuted, surface)).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrastRatio(consoleChrome.inkFaint, surface)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the navy header muted ink clears AA on the header and its border', () => {
    const { header } = staffShellTokens
    expect(contrastRatio(header.textMuted, header.background)).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrastRatio(header.textMuted, header.borderColor)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('CobraDeleteButton keeps its white label at AA at rest, on hover and pressed (#461 §1)', () => {
    const { buttonDelete } = palette
    for (const fill of [buttonDelete.main, buttonDelete.light, buttonDelete.dark]) {
      expect(contrastRatio(buttonDelete.contrastText, fill)).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
})

describe('two worlds: no participant code imports the COBRA theme', () => {
  const participantFiles: Record<string, string> = {
    ...import.meta.glob('../features/social/**/*.{ts,tsx}', {
      eager: true, query: '?raw', import: 'default',
    }),
    ...import.meta.glob('../features/participant-shell/**/*.{ts,tsx}', {
      eager: true, query: '?raw', import: 'default',
    }),
  }

  /** Import/require specifiers only, so prose in comments that mentions COBRA never matches. */
  function specifiers(source: string): string[] {
    const found: string[] = []
    for (const pattern of [
      /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]) {
      for (const match of source.matchAll(pattern)) {
        if (match[1] !== undefined) found.push(match[1])
      }
    }
    return found
  }

  it('scans real files from both roots (never passes on an empty glob)', () => {
    const paths = Object.keys(participantFiles)
    expect(paths.some(p => p.startsWith('../features/social/'))).toBe(true)
    expect(paths.some(p => p.startsWith('../features/participant-shell/'))).toBe(true)
  })

  const COBRA_THEME_SPECIFIER = /(^|\/)theme\/cobraTheme$|^@\/theme$/

  it('the check itself catches the aliased, relative and side-effect import forms', () => {
    const fixture = [
      "import { cobraTheme } from '@/theme/cobraTheme'",
      "import cobra from '../../../theme/cobraTheme'",
      "import '@/theme/cobraTheme'",
      "const t = await import('@/theme/cobraTheme')",
    ].join('\n')
    expect(specifiers(fixture).filter(s => COBRA_THEME_SPECIFIER.test(s))).toHaveLength(4)
  })

  it('finds no import of theme/cobraTheme under features/social or features/participant-shell', () => {
    const offenders = Object.entries(participantFiles)
      .flatMap(([file, source]) => specifiers(source)
        .filter(s => COBRA_THEME_SPECIFIER.test(s))
        .map(s => `${file} -> ${s}`))
    expect(offenders).toEqual([])
  })
})
