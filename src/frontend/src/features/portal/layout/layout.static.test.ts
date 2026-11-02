/**
 * Static rules over `features/portal/layout/` (story 07, #772), read off disk
 * so files added later are covered:
 *  - AC "Two worlds": no COBRA, no MUI import at all (no default MUI look),
 *    FontAwesome only; spacing and type come from skin variables with a
 *    neutral fallback.
 *  - AC "Anchor layout": `grid-template-areas`, a 336 px rail from 1024 px,
 *    and no fixed width that could scroll a 320 px screen sideways.
 *  - AC "Accessibility": 44 px touch targets on coarse pointers, visible focus.
 *  - COR-053: no wall-clock read except the telemetry envelope's own stamp.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { extractImportSpecifiers, FORBIDDEN_SPECIFIER_PATTERNS } from '@/test/twoWorlds'

const SOURCES = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const GRID_CSS = readSrcFile('features/portal/layout/PortalLayout.module.css')
const FRAME_CSS = readSrcFile('features/portal/layout/ModuleFrame.module.css')

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const files = Object.entries(SOURCES)

describe('layout: two worlds', () => {
  it('covers the folder', () => {
    expect(files.map(([path]) => path)).toEqual(expect.arrayContaining([
      './PortalLayout.tsx', './ModuleFrame.tsx', './ModuleLink.tsx', './registry.ts', './testing/renderPortalSubset.tsx',
    ]))
  })

  it.each(files)('%s imports no COBRA, no MUI and no other icon set', (_path, source) => {
    for (const specifier of extractImportSpecifiers(source)) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) expect(specifier).not.toMatch(pattern)
      expect(specifier).not.toMatch(/^@mui\//)
    }
  })

  it.each(files)('%s never reads the wall clock except the telemetry stamp (COR-053)', (path, source) => {
    const body = code(source)
    expect(body).not.toMatch(/\bDate\s*\.\s*now|\bnew\s+Date\s*\(\s*\)|\.toLocale[A-Za-z]*\s*\(/)
    if (path !== './moduleClickTelemetry.ts') expect(body).not.toMatch(/wallClockNowIso/)
  })

  it.each([['grid', GRID_CSS], ['frame', FRAME_CSS]])('%s CSS reads skin variables with fallbacks', (_name, css) => {
    const uses = css.match(/var\(--pulse-skin-[a-z-]+[^)]*\)/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) expect(use).toMatch(/var\(--pulse-skin-[a-z-]+,\s*[^)]+\)/)
  })
})

describe('layout: anchor grid', () => {
  it('places regions with grid-template-areas, lead + a 336 px rail from 1024 px', () => {
    expect(GRID_CSS).toMatch(/\.lead\s*\{[^}]*grid-area:\s*lead/)
    expect(GRID_CSS).toMatch(/\.rail\s*\{[^}]*grid-area:\s*rail/)
    const wide = GRID_CSS.match(/@media \(min-width: 1024px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(wide).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 336px/)
    expect(wide).toMatch(/grid-template-areas:\s*'lead rail'/)
  })

  it('stacks the rail under the lead by default (mobile first)', () => {
    const base = GRID_CSS.match(/\n\.grid\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(base).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(base).toMatch(/grid-template-areas:\s*'lead'\s*'rail'/)
  })

  it('has no fixed width outside the wide breakpoint (320 px never scrolls sideways)', () => {
    const narrow = GRID_CSS.replace(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}/, '') + FRAME_CSS
    // A max-width only caps; any other 3-digit px length could overflow 320 px.
    const lengths = narrow.split('\n').filter(line => !/max-width:/.test(line)).join('\n')
    expect(lengths).not.toMatch(/\b\d{3,}px\b/)
  })
})

describe('layout: touch and focus', () => {
  it('"See all" is at least 44 px on coarse pointers', () => {
    const coarse = FRAME_CSS.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(coarse).toMatch(/\.seeAll\s*\{[^}]*min-height:\s*44px/)
  })

  it('"See all" has a visible focus style', () => {
    expect(FRAME_CSS).toMatch(/\.seeAll:focus-visible\s*\{[^}]*outline:\s*3px solid/)
  })
})
