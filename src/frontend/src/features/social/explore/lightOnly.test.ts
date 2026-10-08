/**
 * features/social/explore/lightOnly.test.ts
 * ---------------------------------------------------------------------------
 * Explore's CSS is LIGHT ONLY (demo-polish F6 / F5): the social surface is forced
 * light, and a global guard (F5) fails on dark-mode CSS anywhere under
 * `features/social/**`. This is the local version of that guard for the files F6
 * owns — every `explore/*.css` module plus the hashtag page's — so a regression
 * is caught here, next to the code, before the global sweep runs.
 *
 * It also pins the participant-world rules for these styles: no COBRA, no MUI.
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest does not process CSS (an imported stylesheet is an empty string), so the
// guard reads the files from disk. This directory, and the hashtag page's sheet.
const exploreDir = import.meta.dirname
const pagesDir = join(exploreDir, '..', 'pages')
const sheetPaths = [
  ...readdirSync(exploreDir)
    .filter(name => name.endsWith('.css'))
    .map(name => join(exploreDir, name)),
  join(pagesDir, 'HashtagFeed.module.css'),
]
// Rules only: comments may legitimately *talk about* the things the guard bans.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const sheets: Array<[string, string]> = sheetPaths.map(path => [
  path.split('/').pop() ?? path,
  stripComments(readFileSync(path, 'utf8')),
])

describe('Explore + hashtag-page CSS is light only', () => {
  it('finds the stylesheets it is meant to guard', () => {
    const names = sheets.map(([name]) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        'ExplorePage.module.css',
        'SearchBox.module.css',
        'SearchResultRows.module.css',
        'TrendingPanel.module.css',
        'HashtagFeed.module.css',
      ]),
    )
  })

  it.each(sheets)('%s has real content (the guard is not vacuous)', (_name, css) => {
    expect(css.length).toBeGreaterThan(300)
    expect(css).toMatch(/\{[^}]*\}/)
  })

  it.each(sheets)('%s has no dark-mode or color-scheme rule', (_name, css) => {
    expect(css).not.toMatch(/prefers-color-scheme/i)
    expect(css).not.toMatch(/data-theme/i)
    expect(css).not.toMatch(/color-scheme/i)
    expect(css).not.toMatch(/\bdark\b/i)
  })

  it.each(sheets)('%s reads no staff (COBRA) or MUI styling', (_name, css) => {
    expect(css).not.toMatch(/cobra|--mui-|\.Mui/i)
  })
})
