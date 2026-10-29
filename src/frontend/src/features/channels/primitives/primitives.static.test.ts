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

/** Strips comments so prose that NAMES a banned API (as this module's docs do) is ignored. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const files = Object.entries(SOURCES)

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

  it.each(files)('%s never reads wall-clock or the browser zone (COR-053)', (_path, source) => {
    const body = code(source)
    expect(body).not.toMatch(/Date\s*\.\s*now/)
    expect(body).not.toMatch(/new\s+Date\s*\(\s*\)/)
    expect(body).not.toMatch(/\.toLocale[A-Za-z]*\s*\(/)
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
      if (!/#[0-9a-f]{3,8}b/i.test(value)) continue
      expect(value, `${path} ${match[1]}`).toMatch(/var\(--skin-/)
    }
  })
})
