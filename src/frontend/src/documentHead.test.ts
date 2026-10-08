/**
 * src/documentHead.test.ts
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Font and document" AC + the document half of "Forced light":
 * the page a participant's browser tab shows must not break the fiction, must load
 * the real font, and must stay light under a dark OS.
 *
 * Reads the REAL `index.html`, `public/favicon.svg`, `main.tsx` and `index.css`
 * (Vite `?raw`; `index.css` is read off disk via `readSrcFile` because Vitest blanks
 * `*.css` imports, `?raw` included) and parses the HTML with the DOM, so these assertions
 * are about what the browser will actually see, not about a string snapshot.
 *
 * DEFECTS PROVEN GONE:
 *   - tab title "Pulse - Media Environment Simulator"  -> "Pulse"
 *   - description "simulated ... emergency management exercises" -> in-fiction copy
 *   - no favicon / theme-color                         -> SVG heartbeat + theme-color
 *   - Figtree referenced everywhere, loaded nowhere    -> imported once from main.tsx
 */
import { describe, expect, it } from 'vitest'
import { readFrontendFile, readSrcFile } from './test/readSource'
import indexHtml from '../index.html?raw'
import faviconSvg from '../public/favicon.svg?raw'
import mainSource from './main.tsx?raw'

const indexCss = readSrcFile('index.css')

const doc = new DOMParser().parseFromString(indexHtml, 'text/html')

function meta(name: string): string | null {
  return doc.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null
}

describe('index.html — an in-fiction document head', () => {
  it('titles the tab "Pulse" (not "... Media Environment Simulator")', () => {
    expect(doc.title).toBe('Pulse')
  })

  it('has a description with no "simulator" / "exercise" wording', () => {
    const description = meta('description')
    expect(description).toBeTruthy()
    expect(description ?? '').not.toMatch(/simulat|exercise/i)
  })

  it('carries no simulator/exercise wording anywhere in the shipped head', () => {
    // The head (comments included) ships to the browser: view-source must not break the fiction.
    expect(doc.head.innerHTML).not.toMatch(/simulat|exercise/i)
    expect(doc.title).not.toMatch(/simulat|exercise/i)
  })

  it('declares an SVG favicon that exists in public/', () => {
    const icon = doc.head.querySelector('link[rel="icon"]')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('type')).toBe('image/svg+xml')
    expect(icon?.getAttribute('href')).toBe('/favicon.svg')
  })

  it('sets a theme-color and pins the page to the light colour scheme', () => {
    expect(meta('theme-color')).toMatch(/^#[0-9a-f]{3,8}$/i)
    expect(meta('color-scheme')).toBe('light')
  })

  it('still mounts the app into #root', () => {
    expect(doc.getElementById('root')).not.toBeNull()
    expect(doc.querySelector('script[type="module"]')?.getAttribute('src')).toBe('/src/main.tsx')
  })
})

describe('public/favicon.svg — the heartbeat mark', () => {
  const svg = new DOMParser().parseFromString(faviconSvg, 'image/svg+xml')

  it('is well-formed SVG', () => {
    expect(svg.querySelector('parsererror')).toBeNull()
    expect(svg.documentElement.tagName).toBe('svg')
    expect(svg.documentElement.getAttribute('viewBox')).toBeTruthy()
  })

  it('draws a heartbeat line (a stroked, unfilled path) on the crimson tile', () => {
    const line = svg.querySelector('path')
    expect(line).not.toBeNull()
    expect(line?.getAttribute('fill')).toBe('none')
    expect(line?.getAttribute('stroke')).toBeTruthy()
    // The D1-003 crimson `#DB3A54` tile behind it.
    expect(svg.querySelector('rect')?.getAttribute('fill')?.toLowerCase()).toBe('#db3a54')
  })
})

describe('Figtree is actually loaded', () => {
  it('main.tsx imports @fontsource-variable/figtree exactly once, before index.css', () => {
    const imports = mainSource.match(/import\s+'@fontsource-variable\/figtree'/g) ?? []
    expect(imports).toHaveLength(1)
    expect(mainSource.indexOf("'@fontsource-variable/figtree'")).toBeLessThan(
      mainSource.indexOf("'./index.css'"),
    )
  })

  it("registers the plain 'Figtree' alias over the package's own woff2 files", () => {
    // The package registers 'Figtree Variable'; the stylesheets spell 'Figtree'.
    expect(indexCss).toMatch(/@font-face\s*\{[^}]*font-family:\s*'Figtree'/)
    expect(indexCss).toContain('@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')
    expect(indexCss).toContain('@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2')
  })

  it('the font files the alias points at exist in the installed package', () => {
    const files = 'node_modules/@fontsource-variable/figtree/files'
    for (const name of ['figtree-latin-wght-normal.woff2', 'figtree-latin-ext-wght-normal.woff2']) {
      expect(() => readFrontendFile(`${files}/${name}`)).not.toThrow()
    }
  })
})

describe('dark OS — the document stays light', () => {
  // The render-level dark-OS emulation (no social component reacts to the OS scheme) is
  // `features/social/theme/forcedLight.darkOs.test.tsx`; the stylesheet side is
  // `forcedLight.guard.test.ts`. This block covers the document-level half.
  it('the global stylesheet pins color-scheme: light and has no dark-mode rule', () => {
    const live = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(live).toMatch(/:root\s*\{[^}]*color-scheme:\s*light\s*;/)
    expect(live).not.toMatch(/prefers-color-scheme/i)
    expect(live).not.toMatch(/data-theme/i)
  })

  it('the document never opts in to a dark scheme, so native controls stay light', () => {
    expect(meta('color-scheme')).toBe('light')
    expect(doc.documentElement.getAttribute('data-theme')).toBeNull()
    expect(doc.body.getAttribute('data-theme')).toBeNull()
  })
})
