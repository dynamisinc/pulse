/**
 * Static rules over `features/news/**` (news-network 06; NFR-004, NFR-001, two worlds):
 *  - the body reaches the DOM only through F14's `SanitizedBody`: no
 *    `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or
 *    `document.write` anywhere under `features/news/**`;
 *  - no COBRA / MUI component / staff import (participant world), FontAwesome only;
 *  - the body stylesheets keep the measure, the link underline and skin-only colours.
 * Read off disk, so it covers every file other news stories add later.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { extractImportSpecifiers, FORBIDDEN_SPECIFIER_PATTERNS } from '@/test/twoWorlds'

const NEWS_SOURCES = import.meta.glob([
  '../**/*.{ts,tsx}',
  '!../**/*.test.{ts,tsx}',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Strips comments so prose that names a banned API is ignored. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const HTML_SINKS: readonly RegExp[] = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /insertAdjacentHTML/,
  /document\s*\.\s*write/,
  /createContextualFragment/,
]

describe('features/news static rules', () => {
  it('reads the folder (non-vacuous)', () => {
    expect(Object.keys(NEWS_SOURCES).some(path => path.endsWith('ArticleBody.tsx'))).toBe(true)
  })

  it.each(Object.entries(NEWS_SOURCES))('%s: no HTML sink outside SanitizedBody', (_path, source) => {
    const body = code(source)
    for (const sink of HTML_SINKS) expect(body).not.toMatch(sink)
  })

  it.each(Object.entries(NEWS_SOURCES))('%s: participant world (no COBRA, MUI component or MUI icon)', (_path, source) => {
    for (const specifier of extractImportSpecifiers(source)) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) expect(specifier).not.toMatch(pattern)
      expect(specifier).not.toMatch(/^@mui\/(material|icons-material)(\/|$)/)
    }
  })
})

describe('body stylesheets', () => {
  const articleCss = readSrcFile('features/news/body/ArticleBody.module.css')
  const pullQuoteCss = readSrcFile('features/news/body/PullQuote.module.css')
  const captionCss = readSrcFile('features/news/body/InlineFigure.module.css')
  const sanitizedCss = readSrcFile('features/channels/primitives/body/SanitizedBody.module.css')

  it('keeps a ~66ch measure and the skin\'s fixed >= 16px body size', () => {
    expect(articleCss).toMatch(/max-width:\s*66ch/)
    expect(articleCss).toMatch(/font-size:\s*var\(--pulse-skin-body-size/)
  })

  it('links stay underlined in the body (never colour alone)', () => {
    const linkRule =
      /\.body a(:where\(:not\(pulse-post \*\)\))?\s*\{[^}]*text-decoration:\s*underline/
    expect(sanitizedCss).toMatch(linkRule)
  })

  it('the pull quote never overflows the column', () => {
    expect(pullQuoteCss).toMatch(/max-width:\s*100%/)
    expect(pullQuoteCss).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it.each([
    ['ArticleBody', articleCss],
    ['PullQuote', pullQuoteCss],
    ['InlineFigure', captionCss],
  ])('%s: colours only through skin variables (a hex only as a var() fallback)', (_name, css) => {
    const withoutVars = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, 'VAR')
    expect(withoutVars).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutVars).not.toMatch(/\brgba?\(/)
  })
})

describe('nothing in the body stylesheets cascades into an embedded post (SOC-002/004)', () => {
  it.each([
    ['SanitizedBody', readSrcFile('features/channels/primitives/body/SanitizedBody.module.css')],
    ['ArticleBody', readSrcFile('features/news/body/ArticleBody.module.css')],
  ])('%s: every descendant element rule excludes the pulse-post subtree or is child-scoped', (_name, css) => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? []
    const descendant = rules
      .map(selector => selector.trim())
      .filter(selector => /^\.(body|articleBody|dropCap)\s/.test(selector))
    expect(descendant.length).toBeGreaterThan(0)
    for (const selector of descendant) {
      const excluded = selector.includes(':not(pulse-post *)')
      const childScoped = />\s*(:where|p|h2|h3)/.test(selector)
      // Rules on the body container itself (a custom property), the placeholder host, or
      // the visually-hidden new-tab note: none reaches inside an embed.
      const containerOnly = /sanitized-body'\]\)$/.test(selector)
      const tagOnlyHost = /pulse-post\s*$/.test(selector) || selector.includes('[data-new-tab-note]')
      expect(excluded || childScoped || containerOnly || tagOnlyHost, selector).toBe(true)
    }
  })
})
