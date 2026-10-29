/**
 * Static rules over the primitives' source (channels-foundation 14):
 *  - COR-053 / XC-008: no wall-clock (`Date.now`, `new Date()`) and no `toLocale*` (which
 *    renders in the BROWSER's zone) anywhere in this module.
 *  - Two worlds: no COBRA, no MUI component (no default enterprise look), FontAwesome only.
 *  - No Social import (news FU-9), and `dangerouslySetInnerHTML` only in `SanitizedBody`.
 * Read off disk, so it covers every file added to the folder later.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { extractImportSpecifiers, FORBIDDEN_SPECIFIER_PATTERNS } from '@/test/twoWorlds'

const SOURCES = import.meta.glob([
  './**/*.{ts,tsx}',
  '!./**/*.test.{ts,tsx}',
  '!./primitivesTestUtils.ts',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The stylesheets, read off disk (a `?raw` glob of a CSS Module yields the module object). */
const STYLES: readonly (readonly [string, string])[] = [
  'announcer/LiveRegionAnnouncer.module.css',
  'body/SanitizedBody.module.css',
  'dateline/ScenarioDateline.module.css',
  'media/ContentMedia.module.css',
  'watermark/WatermarkSlot.module.css',
].map(path => [path, readSrcFile(`features/channels/primitives/${path}`)] as const)

/** The shared player the primitives render through (`core/media/player`, news FU-9). */
const PLAYER_SOURCES = import.meta.glob([
  '../../../core/media/player/**/*.{ts,tsx}',
  '!../../../core/media/player/**/*.test.{ts,tsx}',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Strips comments so prose that NAMES a banned API (as this module's docs do) is ignored.
 * A line comment must start the line or follow whitespace, so a `'//'` string literal
 * (e.g. `startsWith('//')`) does not hide the rest of its line.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** Wall-clock reads and browser-zone renderings (COR-053 / XC-008). */
const CLOCK_BANS: readonly RegExp[] = [
  /\bDate\s*(\.\s*now|\[\s*['"]now['"]\s*\])/,
  /\bnew\s+Date\s*(\(\s*\)|(?!\s*\())/,
  /\bperformance\s*\.\s*now/,
  /\.toLocale[A-Za-z]*\s*\(/,
  /\.get(Hours|Minutes|Seconds|Date|Day|Month|FullYear|Year|TimezoneOffset)\s*\(/,
  /\.to(Time|Date)String\s*\(/,
]

const files = Object.entries(SOURCES)
const playerFiles = Object.entries(PLAYER_SOURCES)

describe('primitives: static rules', () => {
  it('covers the module (the glob found the primitives)', () => {
    const names = files.map(([path]) => path)
    expect(names).toEqual(expect.arrayContaining([
      './dateline/ScenarioDateline.tsx',
      './dateline/datelineFormats.ts',
      './watermark/WatermarkSlot.tsx',
      './media/ContentMedia.tsx',
      './body/SanitizedBody.tsx',
      './announcer/LiveRegionAnnouncer.tsx',
    ]))
  })

  it.each([...files, ...playerFiles])('%s never reads wall-clock or the browser zone (COR-053)', (_path, source) => {
    const body = code(source)
    for (const banned of CLOCK_BANS) expect(body).not.toMatch(banned)
    // Every Intl date formatter is pinned to an explicit zone (never the browser's).
    for (const match of body.matchAll(/new\s+Intl\s*\.\s*DateTimeFormat\s*\(/g)) {
      expect(body.slice(match.index, match.index + 200)).toMatch(/timeZone/)
    }
  })

  it('the clock bans catch the evasions they target (the rule is not vacuous)', () => {
    const evasions = [
      'Date.now()', 'Date[\'now\']()', 'new Date()', 'new Date;', 'performance.now()',
      'x.toLocaleTimeString()', 'd.getHours()', 'd.getFullYear()', 'd.toTimeString()',
      'd.toDateString()',
    ]
    for (const evasion of evasions) {
      expect(CLOCK_BANS.some(banned => banned.test(evasion)), evasion).toBe(true)
    }
    // Parsing or formatting a GIVEN instant stays allowed.
    for (const allowed of ['Date.parse(iso)', 'new Date(epoch)', 'formatScenarioTime(x)']) {
      expect(CLOCK_BANS.some(banned => banned.test(allowed)), allowed).toBe(false)
    }
  })

  it.each(files)('%s imports no COBRA, no MUI, no MUI icons and no Social', (_path, source) => {
    for (const specifier of extractImportSpecifiers(source)) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) expect(specifier).not.toMatch(pattern)
      expect(specifier).not.toMatch(/^@mui\//)
      expect(specifier).not.toMatch(/(^|\/)features\/social(\/|$)|(^|\/)social\//)
    }
  })

  it.each(files)('%s writes HTML only in SanitizedBody', (path, source) => {
    if (path === './body/SanitizedBody.tsx') return
    expect(code(source))
      .not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/)
  })

  it.each(STYLES)('%s: no MUI class; colours only via skin variables', (path, css) => {
    expect(css).not.toMatch(/\.Mui[A-Z]/)
    // Every colour outside the watermark chip (fixed, NFR-008) is a skin variable + fallback.
    if (path.startsWith('watermark/')) return
    const declarations =
      /(?:^|[;{\s])(color|background-color|border(?:-[a-z]+)?|outline):\s*([^;]+);/g
    for (const match of css.matchAll(declarations)) {
      const value = match[2] ?? ''
      if (!/#[0-9a-f]{3,8}\b/i.test(value)) continue
      expect(value, `${path} ${match[1]}`).toMatch(/var\(--pulse-skin-/)
    }
  })
})
