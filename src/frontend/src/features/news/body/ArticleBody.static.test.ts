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

/** A rule's selector list split on TOP-LEVEL commas (not those inside `:where(…)`). */
function selectorList(selectorText: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of selectorText) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current.trim())
  return parts.filter(Boolean)
}

/** Collapses every `(…)` group, so a `:where(p, ul)` argument list reads as one token. */
function collapseGroups(selector: string): string {
  let out = selector
  for (let previous = ''; previous !== out;) {
    previous = out
    out = out.replace(/\([^()]*\)/g, '[]')
  }
  return out
}

describe('nothing in the body stylesheets cascades into an embedded post (SOC-002/004)', () => {
  // A floor per file, so a parser regression that scans almost nothing still fails.
  it.each([
    ['SanitizedBody', readSrcFile('features/channels/primitives/body/SanitizedBody.module.css'), 10],
    ['ArticleBody', readSrcFile('features/news/body/ArticleBody.module.css'), 6],
    ['PullQuote', readSrcFile('features/news/body/PullQuote.module.css'), 5],
  ] as const)('%s: every descendant selector excludes the pulse-post subtree or targets a direct child', (_name, css, minScanned) => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? []
    const selectors = rules
      .filter(rule => !rule.trim().startsWith('@'))
      .flatMap(selectorList)
      // Combinators spaced out, so `.body>*>p` is scanned like `.body > * > p`.
      .map(selector => selector.replace(/\s*([>+~])\s*/g, ' $1 '))
      // A single-compound rule (the container, a host, a scroll region) reaches nothing inside.
      .filter(selector => /\s/.test(collapseGroups(selector)))
    expect(selectors.length).toBeGreaterThanOrEqual(minScanned)
    for (const selector of selectors) {
      // The exclusion must sit on the LAST compound (only pseudo-classes / -elements after it),
      // or a descendant written after it would still reach inside an embed.
      const excluded = /:where\(:not\(pulse-post \*\)\)(::?[\w-]+)*$/.test(selector)
      // `.x <container> > child…`: a direct child of the body cannot be inside a <pulse-post>
      // (only ArticleBody mounts a SanitizedBody; an embed never renders one).
      const onBody = selector.includes(":global([data-testid='sanitized-body'])")
      const shape = collapseGroups(selector)
      const directChild = onBody && /^\.\w+\s+:global\[\]\s*>\s*[^\s>]+$/.test(shape)
      // The body container itself (a custom property only).
      const container = onBody && /^\.\w+\s+:global\[\]$/.test(shape)
      // The embed host itself, and the hidden new-tab note (only ever on the body's own links).
      const knownSafe = /^\.body (pulse-post|\[data-new-tab-note\])$/.test(selector)
      expect(excluded || directChild || container || knownSafe, selector).toBe(true)
    }
  })
})
