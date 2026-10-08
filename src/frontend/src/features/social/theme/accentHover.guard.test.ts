/**
 * features/social/theme/accentHover.guard.test.ts
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 H-2. `accent.ts` certifies the brand accent against a FIXED set of
 * derived states (see its module header), one of which is "white text on the accent
 * FILL after `filter: brightness(1.08)`" (`HOVER_BRIGHTNESS`). A stylesheet that
 * brightens more than that, or that brightens an element that is NOT a filled accent
 * with white text, paints a state the model never measured:
 *
 *  - the nav rail's Post button used `brightness(1.12)`: white on the default amber
 *    fill (`#a55a05` -> `#b96506`) is 4.26:1;
 *  - `FollowButton`'s transparent "Following" state (accent TEXT, sitting on the row's
 *    hover tint `#f4f4f5`) also got `brightness(1.08)`: brightened text on that tint is
 *    ~4.15:1.
 *
 * This guard reads the REAL stylesheets off disk (a `?raw` CSS import is blanked by
 * Vitest, so a guard built on it would pass vacuously -- see `forcedLight.guard.test.ts`
 * for the technique) and fails on:
 *   1. any `brightness(<n>)` with n above `HOVER_BRIGHTNESS`;
 *   2. a brightening (`> 1`) rule that targets a class the SAME sheet declares with a
 *      `background: transparent` (an accent-TEXT state) without excluding it via
 *      `:not(.thatClass)`.
 * and it recomputes, from the largest brightening found on disk, that white text on the
 * default accent's brightened fill still clears 4.5:1 (so the numeric cap is tied to a
 * contrast, not just a constant).
 *
 * NON-VACUITY. The detector is proven to bite on literal bad CSS before it is trusted,
 * and the scan must see the real sheets and the real brightening rules.
 */
import { describe, expect, it } from 'vitest'
import { brightened, contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { DEFAULT_ACCENT } from './tokens'
import {
  HOVER_BRIGHTNESS,
  MIN_ACCENT_CONTRAST,
  accentStateContrasts,
  accessibleAccent,
} from './accent'

/** A floor (not an exact count): the number of sheets under features/social/**. */
const MIN_SHEETS_SCANNED = 39

/** The filled-accent hovers known today (FollowButton, NewPostsPill, NavRail, QuoteComposer). */
const MIN_BRIGHTENING_RULES = 4

/** `../components/X.module.css` -> `components/X.module.css`; `./y.css` -> `theme/y.css`. */
function fromSocialRoot(globKey: string): string {
  return globKey.startsWith('../') ? globKey.slice(3) : `theme/${globKey.slice(2)}`
}

/** Every stylesheet under features/social/** (raw text read off disk), by path. */
const sheets: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('../**/*.css'))
    .map(fromSocialRoot)
    .map(path => [path, readSrcFile(`features/social/${path}`)] as const),
)

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

interface CssRule {
  readonly selector: string
  readonly body: string
}

/** The flat `selector { declarations }` rules of a sheet (at-rule wrappers are skipped). */
function rulesOf(css: string): CssRule[] {
  const rules: CssRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (const match of stripCssComments(css).matchAll(pattern)) {
    rules.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' })
  }
  return rules
}

/** Every `brightness(<n>)` value in a rule body (percentages are normalised to a factor). */
function brightnessValues(body: string): number[] {
  const values: number[] = []
  for (const match of body.matchAll(/filter\s*:[^;}]*?brightness\(\s*([\d.]+)(%?)\s*\)/g)) {
    const raw = Number(match[1])
    values.push(match[2] === '%' ? raw / 100 : raw)
  }
  return values
}

/** The classes a sheet declares as `{ background: transparent }` (accent-TEXT states). */
function transparentBackgroundClasses(rules: readonly CssRule[]): string[] {
  const classes: string[] = []
  for (const { selector, body } of rules) {
    if (!/background\s*:\s*transparent\b/i.test(body)) continue
    const single = /^\.([A-Za-z_][\w-]*)$/.exec(selector)
    if (single?.[1] !== undefined) classes.push(single[1])
  }
  return classes
}

interface Violation {
  readonly selector: string
  readonly reason: string
}

/** The two checks on one sheet's text (exported shape kept local; used by both suites). */
function violationsIn(css: string): Violation[] {
  const rules = rulesOf(css)
  const transparent = transparentBackgroundClasses(rules)
  const violations: Violation[] = []
  for (const { selector, body } of rules) {
    for (const value of brightnessValues(body)) {
      if (value > HOVER_BRIGHTNESS) {
        violations.push({
          selector,
          reason: `brightness(${value}) exceeds the modelled HOVER_BRIGHTNESS ${HOVER_BRIGHTNESS}`,
        })
      }
      if (value > 1) {
        for (const cls of transparent) {
          const targetsIt = new RegExp(`\\.${cls}(?![\\w-])`).test(selector)
          const excludesIt = selector.includes(`:not(.${cls})`)
          if (targetsIt && !excludesIt) {
            violations.push({
              selector,
              reason: `brightens .${cls}, a transparent (accent-text) state, which accent.ts does not model`,
            })
          }
        }
      }
    }
  }
  return violations
}

describe('accent hover guard — the detector bites (non-vacuity)', () => {
  it('flags a brightness above HOVER_BRIGHTNESS', () => {
    const bad = '.post:hover { filter: brightness(1.12); }'
    expect(violationsIn(bad)).toHaveLength(1)
    expect(violationsIn(bad)[0]?.reason).toMatch(/exceeds/)
  })

  it('flags a brightening of a transparent (accent-text) state, however small', () => {
    const bad = `
      .following { background: transparent; color: var(--fb-accent); }
      .button:hover:not(:disabled) { filter: brightness(1.08); }
      .following:hover { filter: brightness(1.05); }
    `
    // `.button:hover` does not mention `.following`; only the explicit one is caught.
    expect(violationsIn(bad).map(v => v.selector)).toEqual(['.following:hover'])
  })

  it('accepts the filled-only form and a plain darkening', () => {
    const good = `
      .following { background: transparent; color: var(--fb-accent); }
      .button:not(.following):hover:not(:disabled) { filter: brightness(1.08); }
      .tile:hover { filter: brightness(0.94); }
    `
    expect(violationsIn(good)).toEqual([])
  })
})

describe('accent hover guard — the real social stylesheets', () => {
  it('sees the real sheets and the real brightening rules (non-vacuous)', () => {
    expect(Object.keys(sheets).length).toBeGreaterThanOrEqual(MIN_SHEETS_SCANNED)
    const brightening = Object.values(sheets)
      .flatMap(css => rulesOf(css))
      .flatMap(rule => brightnessValues(rule.body))
      .filter(value => value > 1)
    expect(brightening.length).toBeGreaterThanOrEqual(MIN_BRIGHTENING_RULES)
  })

  it('exports the modelled brightening as 1.08', () => {
    expect(HOVER_BRIGHTNESS).toBe(1.08)
  })

  it('no sheet brightens above HOVER_BRIGHTNESS or brightens a transparent accent-text state', () => {
    const report = Object.entries(sheets).flatMap(([path, css]) =>
      violationsIn(css).map(v => `${path}: ${v.selector} -- ${v.reason}`),
    )
    expect(report).toEqual([])
  })

  it('the nav rail Post button and the Follow fill use exactly the modelled hover', () => {
    const nav = rulesOf(sheets['layout/NavRail.module.css'] ?? '')
      .find(rule => rule.selector === '.post:hover')
    expect(nav).toBeDefined()
    expect(brightnessValues(nav?.body ?? '')).toEqual([HOVER_BRIGHTNESS])

    const follow = rulesOf(sheets['components/FollowButton.module.css'] ?? '')
    const hovers = follow.filter(rule => brightnessValues(rule.body).length > 0)
    expect(hovers.map(rule => rule.selector)).toEqual([
      '.button:not(.following):hover:not(:disabled)',
    ])
    // ...and the outlined state gets a BACKGROUND tint on hover instead of a filter.
    const followingHover = follow.find(rule => rule.selector === '.following:hover:not(:disabled)')
    expect(followingHover?.body).toMatch(/background\s*:\s*#f4f4f5/i)
  })

  it('"Following" accent TEXT on its hover tint is >= 4.5:1, and that tint is the modelled surface', () => {
    const follow = rulesOf(sheets['components/FollowButton.module.css'] ?? '')
    const tint = /background\s*:\s*(#[0-9a-f]{6})/i.exec(
      follow.find(rule => rule.selector === '.following:hover:not(:disabled)')?.body ?? '',
    )?.[1]
    expect(tint).toBeDefined()
    const amber = accessibleAccent('#d97706')
    expect(contrastRatio(amber, tint ?? '#000000')).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    // The very surface accent.ts certifies (`onHover`), not a stacked translucent tint.
    expect(accentStateContrasts(amber)?.onHover).toBeCloseTo(
      contrastRatio(amber, tint ?? '#000000'),
      2,
    )
    // Brightening that text instead (the old rule) falls out of the model.
    expect(contrastRatio(brightened(amber, HOVER_BRIGHTNESS), tint ?? '#000000'))
      .toBeLessThan(MIN_ACCENT_CONTRAST)
  })

  it('white on the default accent fill at the LARGEST brightening on disk is >= 4.5:1', () => {
    const largest = Math.max(
      ...Object.values(sheets).flatMap(css =>
        rulesOf(css).flatMap(rule => brightnessValues(rule.body)),
      ),
    )
    const accent = accessibleAccent(DEFAULT_ACCENT)
    // The unconfigured brand amber (#d97706) is nudged to #a55a05; the navy default clears too.
    const amber = accessibleAccent('#d97706')
    expect(amber).toBe('#a55a05')
    for (const colour of [accent, amber]) {
      expect(contrastRatio(brightened(colour, largest), '#ffffff'))
        .toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    }
    // The model's own number agrees with the local computation at the modelled factor.
    expect(accentStateContrasts(amber)?.hoverFill).toBeCloseTo(
      contrastRatio(brightened(amber, HOVER_BRIGHTNESS), '#ffffff'),
      2,
    )
    // And the former nav-rail value really was out of model (4.26:1).
    expect(contrastRatio(brightened(amber, 1.12), '#ffffff')).toBeLessThan(MIN_ACCENT_CONTRAST)
  })
})
