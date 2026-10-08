/**
 * features/social/theme/forcedLight.guard.test.ts
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Forced light" AC. The Social skin is LIGHT ONLY: a dark-mode OS
 * must leave the page fully light. The defect was a set of per-module
 * `@media (prefers-color-scheme: dark)` and `[data-theme='dark']` blocks that
 * flipped SOME modules dark and left the shell light (a half-dark page), and left
 * F3's active like/repost accent at 1.65:1 on the dark canvas.
 *
 * This guard reads the REAL source and fails if any stylesheet under
 * `features/social/**` carries a dark-mode rule, or if any social TS/TSX reads
 * the OS colour scheme or sets a `data-theme`.
 *
 * HOW IT READS THEM. TS/TSX come from Vite's `import.meta.glob` with `?raw` (the
 * repo's usual technique, e.g. `app-shell/participantLocationBlindness.test.ts`).
 * CSS CANNOT: Vitest's `vitest:css-empty-post` plugin blanks every `*.css` id —
 * `?raw` included — so a `?raw` CSS import yields `{}` / `""`, and a guard built
 * on it would pass vacuously. The stylesheet LIST therefore comes from a lazy
 * `import.meta.glob` (its keys are real paths; nothing is loaded) and each file's
 * TEXT is read off disk with `readSrcFile` (`src/test/readSource.ts`, `node:fs` via a
 * variable specifier). Non-vacuity is asserted: a floor on the number of sheets
 * scanned, real (non-empty) content, and a detector proven to bite.
 *
 * COMMENTS are stripped first, so a sheet may DOCUMENT the ban (several do).
 *
 * NON-VACUITY. The detector is proven to bite on literal dark-mode CSS before it
 * is trusted, and the scan must see the real sheets.
 *
 * PENDING SWEEP. The sheets owned by the other Wave-2 stories (F1, F4, F6) were
 * not in this story's branch when it was written, so they still carry their
 * dark-mode blocks. They are listed in {@link PENDING_SWEEP} and reported as
 * SKIPPED (visible in the run, not silently excluded). The F5 integration merge
 * ("merges last") sweeps them and empties the list; a stale entry (a sheet that
 * no longer has a dark rule, or no longer exists) FAILS, so the list can only
 * shrink. The AC is met when `PENDING_SWEEP` is empty.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

/**
 * The number of stylesheets under features/social/** when this guard was written (a
 * floor, not an exact count: later stories add sheets). If the glob ever matches fewer,
 * the guard is no longer looking at the real tree and must fail rather than pass.
 */
const MIN_SHEETS_SCANNED = 21

/**
 * A glob key -> its path from `features/social/`:
 * `../components/X.module.css` -> `components/X.module.css`,
 * `./social.module.css` -> `theme/social.module.css`.
 */
function fromSocialRoot(globKey: string): string {
  return globKey.startsWith('../') ? globKey.slice(3) : `theme/${globKey.slice(2)}`
}

/**
 * Every stylesheet under features/social/** (raw text read off disk), keyed by path from
 * `features/social/`. The glob is LAZY: only its keys (real paths) are used.
 */
const sheets: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('../**/*.css'))
    .map(fromSocialRoot)
    .map(path => [path, readSrcFile(`features/social/${path}`)] as const),
)

/** Every NON-test TS/TSX source under features/social/**. */
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/**
 * Sheets still carrying a dark-mode rule because another Wave-2 story owns them.
 * Path (from `features/social/`) -> owning story. EMPTY at integration.
 */
const PENDING_SWEEP: Readonly<Record<string, string>> = {
  'SocialChannel.module.css': 'F1',
  'components/Composer.module.css': 'F4',
  'components/ThreadView.module.css': 'F4',
  'pages/Feed.module.css': 'F4',
  'pages/HashtagFeed.module.css': 'F6',
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Strips block and line comments (a line comment must not be a `://` in a URL). */
function stripCodeComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The dark-mode / colour-scheme constructs a CSS sheet must not contain. */
const CSS_DARK_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: '@media (prefers-color-scheme)', pattern: /prefers-color-scheme/i },
  { name: '[data-theme] selector', pattern: /\[\s*data-theme/i },
  { name: 'color-scheme declaration', pattern: /(^|[\s;{])color-scheme\s*:/i },
]

/** The names of the dark-mode constructs found in a stylesheet (comments ignored). */
function darkRulesIn(css: string): string[] {
  const live = stripCssComments(css)
  return CSS_DARK_PATTERNS.filter(p => p.pattern.test(live)).map(p => p.name)
}

const CODE_DARK_PATTERN = /prefers-color-scheme|data-theme|colorScheme/

describe('forced light — the detector is real', () => {
  it('finds each dark-mode construct in literal CSS', () => {
    expect(darkRulesIn('@media (prefers-color-scheme: dark) { .a { color: #fff } }'))
      .toContain('@media (prefers-color-scheme)')
    expect(darkRulesIn(":global([data-theme='dark']) .a { color: #fff }"))
      .toContain('[data-theme] selector')
    expect(darkRulesIn('.a:global([data-theme="dark"]) { color: #fff }'))
      .toContain('[data-theme] selector')
    expect(darkRulesIn(':root { color-scheme: light dark; }')).toContain('color-scheme declaration')
  })

  it('ignores a comment that merely documents the ban, and clean CSS', () => {
    expect(darkRulesIn('/* no @media (prefers-color-scheme: dark) here */ .a { color: #000 }'))
      .toEqual([])
    expect(darkRulesIn('.a { color: #000; background: #fff }')).toEqual([])
  })

  it('scans the real stylesheets, including the shared token sheet (cannot pass vacuously)', () => {
    const paths = Object.keys(sheets)
    expect(paths.length).toBeGreaterThanOrEqual(MIN_SHEETS_SCANNED)
    // At least one sheet has real text, and EVERY sheet does (an empty read would pass).
    expect(Object.values(sheets).some(css => css.trim().length > 0)).toBe(true)
    expect(Object.entries(sheets).filter(([, css]) => css.trim().length === 0)).toEqual([])
    expect(paths).toContain('theme/social.module.css')
    expect(paths).toContain('pages/Profile.module.css')
    // And the four orphan modules this story sweeps.
    for (const orphan of ['FollowerList', 'WhoToFollow', 'NewPostsPill', 'FollowButton']) {
      expect(paths).toContain(`components/${orphan}.module.css`)
    }
    // Real content, not the blank string Vitest substitutes for CSS imports.
    expect(sheets['theme/social.module.css']).toContain('.tokens')
  })
})

describe('forced light — no dark-mode rule in any features/social stylesheet', () => {
  const entries = Object.entries(sheets).sort(([a], [b]) => a.localeCompare(b))

  for (const [path, css] of entries) {
    const owner = PENDING_SWEEP[path]
    if (owner !== undefined) {
      it.skip(`${path} has no dark-mode rule (PENDING: swept at integration, owned by ${owner})`, () => {
        expect(darkRulesIn(css)).toEqual([])
      })
    } else {
      it(`${path} has no dark-mode rule`, () => {
        expect(darkRulesIn(css)).toEqual([])
      })
    }
  }

  it('every PENDING_SWEEP entry is still real: the sheet exists AND still has a dark rule', () => {
    for (const path of Object.keys(PENDING_SWEEP)) {
      const css = sheets[path]
      expect(css, `${path} no longer exists; remove it from PENDING_SWEEP`).toBeDefined()
      expect(
        darkRulesIn(css ?? ''),
        `${path} is already clean; remove it from PENDING_SWEEP`,
      ).not.toEqual([])
    }
  })
})

describe('forced light — no social code reads the OS colour scheme or sets data-theme', () => {
  it('scans the real sources (cannot pass vacuously)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
  })

  it('finds none outside comments', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => CODE_DARK_PATTERN.test(stripCodeComments(code)))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
