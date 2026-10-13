/**
 * features/social/notifications/notifications.guards.test.ts
 * ---------------------------------------------------------------------------
 * Structural guards for the notifications feature (demo-polish F7, story 16): the rules that
 * must hold however the code is edited later.
 *
 *   TWO WORLDS. Nothing under `notifications/**` imports MUI, the COBRA theme / styled
 *   components, emotion or the MUI icon set; icons are FontAwesome.
 *   SCENARIO TIME (COR-053). No source reads the wall clock (`Date.now()` / `new Date()`).
 *   LIGHT ONLY. No stylesheet this feature owns (its own sheets and the nav rail's, where the
 *   bell's badge lives) carries a dark-mode, `data-theme` or `color-scheme` rule -- the local
 *   version of the global `forcedLight.guard.test.ts`.
 *   CONTRAST (WCAG 2.1 AA). Every text/background pair the page draws is COMPUTED from the
 *   stylesheet text that ships, not asserted from a number typed in a comment.
 *
 * Sources come from Vite's eager `?raw` glob (as `social/layout/twoWorldsLayout.test.ts`
 * does); stylesheets are read off disk (`readSrcFile`), because Vitest blanks every `*.css`
 * import. Non-vacuity: each scan must find real files, and each detector must bite.
 */
import { describe, expect, it } from 'vitest'
import { brightened, contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { accessibleAccent } from '../theme/accent'
import { DEFAULT_ACCENT, LIGHT_PALETTE } from '../theme/tokens'

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const SHEETS = [
  'features/social/notifications/NotificationsPage.module.css',
  'features/social/notifications/NotificationsEngine.module.css',
  'features/social/layout/NavRail.module.css',
] as const

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const stripCodeComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function importSpecifiers(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== undefined) found.push(match[1])
  }
  return found
}

const FORBIDDEN_IMPORTS: readonly RegExp[] = [
  /^@mui\//,
  /^@emotion\//,
  /^@\/theme(\/|$)/,
  /cobraTheme|styledComponents|CobraStyles|staffShellTokens/,
]

describe('two worlds: the feature stays participant-world', () => {
  it('scans a real set of files (cannot pass vacuously)', () => {
    const names = Object.keys(sources)
    expect(names.length).toBeGreaterThanOrEqual(10)
    expect(names).toContain('./notificationsStore.ts')
    expect(names).toContain('./NotificationsPage.tsx')
  })

  it('imports no MUI, no COBRA theme / styled components, no emotion', () => {
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      importSpecifiers(source)
        .filter(specifier => FORBIDDEN_IMPORTS.some(pattern => pattern.test(specifier)))
        .map(specifier => `${file} -> ${specifier}`))
    expect(offenders).toEqual([])
  })

  it('the detector bites on a synthetic offender', () => {
    // Assembled at run time: a literal import line in this file would itself trip the
    // repo-wide two-worlds scans (`staffShell/twoWorldsSeparation.test.ts`), which read every
    // participant file's text -- tests included.
    const mui = ['@mui', 'material'].join('/')
    const cobra = ['@', 'theme', 'styledComponents'].join('/')
    const synthetic = importSpecifiers(`import { Badge } from '${mui}'\nimport { x } from '${cobra}'`)
    expect(synthetic).toEqual([mui, cobra])
    expect(synthetic.filter(s => FORBIDDEN_IMPORTS.some(p => p.test(s)))).toHaveLength(2)
  })

  it('takes its icons from FontAwesome', () => {
    const row = sources['./NotificationRow.tsx']
    expect(row).toBeDefined()
    expect(importSpecifiers(row ?? '')).toContain('@fortawesome/free-solid-svg-icons')
  })
})

describe('scenario time: no source reads the wall clock (COR-053)', () => {
  it('has no Date.now() / new Date() outside comments', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => /Date\.now\s*\(|new Date\s*\(\s*\)/.test(stripCodeComments(code)))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

describe('light only', () => {
  const sheets = SHEETS.map(path => [path, stripCssComments(readSrcFile(path))] as const)

  it.each(sheets)('%s has real content (the guard is not vacuous)', (_path, css) => {
    expect(css.length).toBeGreaterThan(100)
    expect(css).toMatch(/\{[^}]*\}/)
  })

  it.each(sheets)('%s has no dark-mode, data-theme or color-scheme rule', (_path, css) => {
    expect(css).not.toMatch(/prefers-color-scheme/i)
    expect(css).not.toMatch(/data-theme/i)
    expect(css).not.toMatch(/(^|[\s;{])color-scheme\s*:/i)
    expect(css).not.toMatch(/\bdark\b/i)
  })

  it.each(sheets)('%s reads no staff (COBRA) or MUI styling', (_path, css) => {
    expect(css).not.toMatch(/cobra|--mui-|\.Mui/i)
  })

  it('no notifications source reads the OS colour scheme or sets data-theme', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) =>
        /prefers-color-scheme|data-theme|colorScheme/.test(stripCodeComments(code)))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

describe('contrast (WCAG 2.1 AA), computed from the shipped stylesheet', () => {
  const page = stripCssComments(readSrcFile(SHEETS[0]))
  const rail = stripCssComments(readSrcFile(SHEETS[2]))

  /** A custom property's declared `#rrggbb` value in a sheet. */
  function token(css: string, name: string): string {
    const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)
    if (match?.[1] === undefined) throw new Error(`token ${name} not declared as #rrggbb`)
    return match[1]
  }

  /** `rgba(14, 21, 24, .045)` composited over an opaque `#rrggbb` -- the hover wash. */
  function hoverOver(background: string): string {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16))
    const ink = [14, 21, 24]
    const mixed = [r, g, b].map((c, i) => Math.round((c ?? 0) * 0.955 + (ink[i] ?? 0) * 0.045))
    return '#' + mixed.map(c => c.toString(16).padStart(2, '0')).join('')
  }

  const WHITE = '#ffffff'
  const PANEL = LIGHT_PALETTE.panel
  const muted = token(page, '--nt-muted')
  const ink = LIGHT_PALETTE.ink

  it('the page\'s muted text is >= 4.5:1 on white, the unread panel and the hover wash', () => {
    for (const background of [WHITE, PANEL, hoverOver(WHITE)]) {
      expect(contrastRatio(muted, background)).toBeGreaterThanOrEqual(4.5)
    }
    // Where the wash would sit over the panel it is still AA -- which the shared muted is NOT.
    expect(contrastRatio(muted, hoverOver(PANEL))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(LIGHT_PALETTE.inkMuted, hoverOver(PANEL))).toBeLessThan(4.5)
  })

  it('ink (titles, kind label, summary) is >= 4.5:1 on every surface a row sits on', () => {
    for (const background of [WHITE, PANEL, hoverOver(WHITE)]) {
      expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the "Mark all read" outline is a >= 3:1 control edge (WCAG 1.4.11)', () => {
    expect(contrastRatio(LIGHT_PALETTE.controlLine, WHITE)).toBeGreaterThanOrEqual(3)
  })

  it('the unread tint is the panel, and hover on an unread row does not stack a wash on it', () => {
    expect(page).toMatch(
      /\.rowUnread \.link,\s*\.rowUnread \.link:hover\s*\{\s*background:\s*var\(--pc-panel\)/,
    )
  })

  it('the muted ink is only used on rows that sit on white / panel / hover-over-white', () => {
    // `.link:hover` washes the row; an unread row keeps the panel. Both are covered above.
    expect(page).toMatch(/\.link:hover\s*\{\s*background:\s*var\(--pc-hover\)/)
  })

  it('the badge is white on the exercise accent, so it needs the accent model to be AA', () => {
    const badge = /\.badge\s*\{([^}]*)\}/.exec(rail)?.[1] ?? ''
    expect(badge).toMatch(/background:\s*var\(--pc-accent\)/)
    expect(badge).toMatch(/color:\s*#fff\b/)
    // The default navy, and a brand the accent model has to darken (the default amber).
    for (const accent of [DEFAULT_ACCENT, accessibleAccent('#d97706'), accessibleAccent('#f1c40f')]) {
      expect(contrastRatio(WHITE, accent)).toBeGreaterThanOrEqual(4.5)
      // ... even brightened by the one hover filter the skin allows (the badge has none).
      expect(contrastRatio(WHITE, brightened(accent, 1.08))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the "New" tag and kind icon use the accent on white / the panel', () => {
    for (const accent of [DEFAULT_ACCENT, accessibleAccent('#d97706'), accessibleAccent('#f1c40f')]) {
      expect(contrastRatio(accent, WHITE)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(accent, PANEL)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
