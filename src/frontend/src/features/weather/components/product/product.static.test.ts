/**
 * Static rules over the weather product components' source (weather-source 07, #758):
 *  - COR-053: no wall clock (`Date.now`, bare `new Date`) and no `toLocale*` (browser zone).
 *    ESLint enforces the same on this folder; this is the backstop that also covers the
 *    rule being edited away.
 *  - Two worlds: no COBRA, no MUI (no default enterprise look), FontAwesome only.
 *  - Styling only through skin variables: every colour in a stylesheet is a
 *    `var(--pulse-skin-…, fallback)` or a system colour keyword, and nothing transforms text
 *    (the headline and the severity words are shown as stored, D4-010).
 * Read off disk, so it covers every file added to the folder later.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { extractImportSpecifiers, FORBIDDEN_SPECIFIER_PATTERNS } from '@/test/twoWorlds'

const SOURCES = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const STYLES: readonly (readonly [string, string])[] = [
  'IbwGrid.module.css',
  'ProductStateBanner.module.css',
  'ProductText.module.css',
  'ProductTimes.module.css',
  'SeverityChip.module.css',
].map(path => [path, readSrcFile(`features/weather/components/product/${path}`)] as const)

/** Strips comments so prose that names a banned API is ignored. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const CLOCK_BANS: readonly RegExp[] = [
  /\bDate\s*(\.\s*now|\[\s*['"]now['"]\s*\])/,
  /\bnew\s+Date\s*(\(\s*\)|(?!\s*\())/,
  /\bperformance\s*\.\s*now/,
  /\.toLocale[A-Za-z]*\s*\(/,
  /\.get(Hours|Minutes|Seconds|Date|Day|Month|FullYear|Year|TimezoneOffset)\s*\(/,
  /\.to(Time|Date)String\s*\(/,
]

const files = Object.entries(SOURCES)

describe('weather product components: static rules', () => {
  it('covers the module', () => {
    expect(files.map(([path]) => path)).toEqual(expect.arrayContaining([
      './SeverityChip.tsx',
      './IbwGrid.tsx',
      './ProductText.tsx',
      './ProductTimes.tsx',
      './ProductStateBanner.tsx',
      './ProductImagery.tsx',
      './productBanner.ts',
      './severity.ts',
    ]))
  })

  it.each(files)('%s never reads the wall clock or the browser zone (COR-053)', (_path, source) => {
    const body = code(source)
    for (const banned of CLOCK_BANS) expect(body).not.toMatch(banned)
    expect(body).not.toMatch(/\bIntl\s*\.\s*DateTimeFormat/)
  })

  it.each(files)('%s imports no COBRA, no MUI and no MUI icons', (_path, source) => {
    for (const specifier of extractImportSpecifiers(source)) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) expect(specifier).not.toMatch(pattern)
      expect(specifier).not.toMatch(/^@mui\//)
    }
  })

  it.each(files)('%s writes no raw HTML', (_path, source) => {
    expect(code(source))
      .not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/)
  })

  it.each(STYLES)('%s: no MUI class, skin-variable colours, no text-transform', (path, css) => {
    const body = code(css)
    expect(body).not.toMatch(/\.Mui[A-Z]/)
    expect(body, path).not.toMatch(/text-transform:\s*(uppercase|lowercase|capitalize)/)
    const declarations =
      /(?:^|[;{\s])(color|background(?:-color)?|border(?:-[a-z]+)?|outline):\s*([^;]+);/g
    for (const match of body.matchAll(declarations)) {
      const value = match[2] ?? ''
      if (!/#[0-9a-f]{3,8}\b|rgb|hsl/i.test(value)) continue
      expect(value, `${path} ${match[1]}`).toMatch(/var\(--pulse-skin-/)
    }
  })
})
