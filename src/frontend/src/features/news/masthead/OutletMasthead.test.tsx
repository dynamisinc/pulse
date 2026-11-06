/**
 * Story 03 (#720): the outlet masthead + section nav. One component, skin-selected
 * variants (NWS-002), category nav (NWS-003), mobile disclosure, no platform chrome,
 * two worlds, and accessibility (NFR-001) in each of the four masthead variants.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEUTRAL_SKIN_TOKENS,
  OutletSkinScope,
  SkinScope,
  registerSkinTokens,
  type OutletDto,
  type OutletSkinTokens,
} from '@/features/channels'
import { readSrcFile } from '@/test/readSource'
import { seriousAxeViolations } from '@/features/channels/primitives/primitivesTestUtils'
import { OutletMasthead, SectionNav, newsSectionPath, type SectionNavCurrent } from '.'
import type { NewsMastheadVariant } from '../skins/newsExtension'

const ctl = vi.hoisted(() => ({ coarse: false, reducedMotion: false }))
vi.mock('@/core/hooks/useCoarsePointer', () => ({ useCoarsePointer: () => ctl.coarse }))
vi.mock('@/core/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => ctl.reducedMotion,
}))

beforeEach(() => {
  ctl.coarse = false
  ctl.reducedMotion = false
})

const OUTLET: OutletDto = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a01',
  channelId: 'news',
  slug: 'metro-desk-9',
  name: 'Metro Desk 9',
  tagline: 'Your city, every hour.',
  parentOutletId: null,
  pairedPersonaId: null,
  logo: null,
  categories: ['Local', 'Weather', 'Public Safety'],
  skinKey: 'newsline7',
  skinOverrides: null,
  homeRoute: '/news/metro-desk-9',
}

/** A token file for one masthead variant (test stand-ins for skins 10–13). */
function variantTokens(
  masthead: NewsMastheadVariant,
  news: Record<string, string | boolean> = {},
): OutletSkinTokens {
  return {
    ...NEUTRAL_SKIN_TOKENS,
    palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent: '#0f2749', breaking: '#c8102e' },
    breaking: { style: 'bar', vocabulary: 'BREAKING NEWS' },
    ext: { news: { masthead, ...news } },
  }
}

const VARIANTS: readonly NewsMastheadVariant[] = [
  'tv-bar',
  'centered-nameplate',
  'wire-strip',
  'tabloid-flag',
]

interface RenderOptions {
  readonly tokens?: OutletSkinTokens
  readonly outlet?: OutletDto
  readonly nameAs?: 'h1' | 'p'
  readonly showLiveChip?: boolean
  readonly current?: SectionNavCurrent
}

function renderMasthead({
  tokens = variantTokens('centered-nameplate'),
  outlet = OUTLET,
  ...props
}: RenderOptions = {}) {
  return render(
    <MemoryRouter>
      <SkinScope scopeId={`outlet-${outlet.slug}`} tokens={tokens}>
        <OutletMasthead outlet={outlet} {...props} />
      </SkinScope>
    </MemoryRouter>,
  )
}

function masthead(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-masthead]')
  if (el === null) throw new Error('no masthead rendered')
  return el
}

describe('OutletMasthead: one component, skin-selected variants (NWS-002)', () => {
  it.each(VARIANTS)('draws the %s variant from ext.news.masthead with the outlet\'s own name', variant => {
    const { container } = renderMasthead({ tokens: variantTokens(variant) })
    expect(masthead(container).dataset.masthead).toBe(variant)
    expect(screen.getByRole('link', { name: 'Metro Desk 9' })).toHaveAttribute('href', '/news/metro-desk-9')
    expect(screen.getByText('Your city, every hour.')).toBeInTheDocument()
  })

  it('takes name, tagline and logo from the outlet DTO (logo alt is the outlet name)', () => {
    renderMasthead({
      outlet: {
        ...OUTLET,
        name: 'Harbor Gazette',
        tagline: null,
        logo: {
          id: 'logo-1',
          kind: 'image',
          role: 'inline',
          url: '/media/harbor-logo.png',
          posterUrl: null,
          contentType: 'image/png',
          width: 400,
          height: 80,
          durationSec: null,
          alt: 'ignored logo alt',
          caption: null,
        },
      },
    })
    const logo = screen.getByRole('img', { name: 'Harbor Gazette' })
    expect(logo).toHaveAttribute('src', '/media/harbor-logo.png')
    expect(screen.queryByText('Your city, every hour.')).toBeNull()
    expect(screen.getByRole('region', { name: 'Harbor Gazette' })).toBeInTheDocument()
  })

  it('falls back to the plain nameplate when the skin declares no masthead', () => {
    const { container } = renderMasthead({ tokens: NEUTRAL_SKIN_TOKENS })
    expect(masthead(container).dataset.masthead).toBe('centered-nameplate')
  })

  it('a fifth outlet is a token file: a registered unknown skin draws a working masthead', () => {
    const fifth: OutletSkinTokens = {
      ...NEUTRAL_SKIN_TOKENS,
      type: { ...NEUTRAL_SKIN_TOKENS.type, mastheadFamily: 'Georgia, serif' },
      palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent: '#2d5016' },
      ext: { news: { masthead: 'wire-strip', liveChip: 'ON AIR' } },
    }
    registerSkinTokens('channel-five-test', fifth)
    const outlet: OutletDto = {
      ...OUTLET,
      slug: 'channel-five',
      name: 'Channel Five',
      skinKey: 'channel-five-test',
      categories: ['Valley'],
    }
    const { container } = render(
      <MemoryRouter>
        <OutletSkinScope outlet={outlet}>
          <OutletMasthead outlet={outlet} showLiveChip current={{ kind: 'home' }} nameAs="h1" />
        </OutletSkinScope>
      </MemoryRouter>,
    )
    expect(masthead(container).dataset.masthead).toBe('wire-strip')
    expect(screen.getByRole('heading', { level: 1, name: 'Channel Five' })).toBeInTheDocument()
    expect(screen.getByText('ON AIR')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Valley' }))
      .toHaveAttribute('href', '/news/channel-five/section/Valley')
    const scope = container.querySelector<HTMLElement>('[data-skin-scope="outlet-channel-five"]')
    expect(scope?.style.getPropertyValue('--pulse-skin-font-masthead')).toBe('Georgia, serif')
  })

  it('names no skin key anywhere in the masthead layout code', () => {
    const files = [
      'features/news/masthead/OutletMasthead.tsx',
      'features/news/masthead/OutletMasthead.module.css',
      'features/news/masthead/SectionNav.tsx',
      'features/news/masthead/SectionNav.module.css',
      'features/news/masthead/mastheadModel.ts',
    ]
    for (const file of files) {
      const text = readSrcFile(file)
      for (const key of ['newsline7', 'courier-ledger', 'national-wire', 'the-scoop']) {
        expect(text, `${file} names ${key}`).not.toContain(key)
      }
    }
  })
})

describe('SectionNav: category nav (NWS-003, NFR-001)', () => {
  it('renders Home plus each category, in configured order, as outlet links', () => {
    renderMasthead()
    const nav = screen.getByRole('navigation', { name: 'Metro Desk 9 sections' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual(['Home', 'Local', 'Weather', 'Public Safety'])
    expect(links.map(l => l.getAttribute('href'))).toEqual([
      '/news/metro-desk-9',
      '/news/metro-desk-9/section/Local',
      '/news/metro-desk-9/section/Weather',
      '/news/metro-desk-9/section/Public%20Safety',
    ])
  })

  it('marks the current section with aria-current="page" and nothing else', () => {
    renderMasthead({ current: { kind: 'section', category: 'Weather' } })
    const nav = screen.getByRole('navigation')
    const current = within(nav).getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page')
    expect(current.map(l => l.textContent)).toEqual(['Weather'])
  })

  it('marks Home current on the outlet home, and nothing on an article page', () => {
    const { unmount } = renderMasthead({ current: { kind: 'home' } })
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    unmount()
    renderMasthead()
    expect(document.querySelector('[aria-current]')).toBeNull()
  })

  it('distinguishes the current entry by weight and underline, not colour alone', () => {
    const css = readSrcFile('features/news/masthead/SectionNav.module.css')
    const rule = /\.link\[aria-current='page'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/font-weight:\s*[6-9]00/)
    expect(rule).toMatch(/text-decoration:\s*underline/)
    expect(rule).not.toMatch(/(^|[^-])color:/)
    expect(css).toMatch(/\.link:focus-visible\s*\{[^}]*outline:\s*3px solid/)
  })

  it('skips blank and duplicate categories', () => {
    renderMasthead({ outlet: { ...OUTLET, categories: ['Local', ' ', 'Local', 'Sports'] } })
    const links = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual(['Home', 'Local', 'Sports'])
  })

  it('encodes a category as one path segment', () => {
    expect(newsSectionPath('metro-desk-9', 'Arts/Culture & Food'))
      .toBe('/news/metro-desk-9/section/Arts%2FCulture%20%26%20Food')
  })
})

describe('SectionNav: mobile-first disclosure', () => {
  it('collapses behind a keyboard-operable "Sections" button', async () => {
    const user = userEvent.setup()
    renderMasthead()
    const toggle = screen.getByRole('button', { name: 'Sections' })
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(list).not.toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(list?.dataset.open).toBe('false')

    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(list?.dataset.open).toBe('true')

    await user.tab()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when a section link is followed', async () => {
    const user = userEvent.setup()
    renderMasthead()
    const toggle = screen.getByRole('button', { name: 'Sections' })
    await user.click(toggle)
    await user.click(screen.getByRole('link', { name: 'Local' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('flags coarse pointers for 44px targets and honours reduced motion', () => {
    ctl.coarse = true
    ctl.reducedMotion = true
    renderMasthead()
    const nav = screen.getByRole('navigation')
    expect(nav.dataset.coarse).toBe('true')
    expect(nav.dataset.reducedMotion).toBe('true')
    const css = readSrcFile('features/news/masthead/SectionNav.module.css')
    const selector = ".nav[data-coarse='true'] .link {"
    const start = css.indexOf(selector)
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/min-height:\s*44px/)
  })

  it('shows the row and hides the disclosure from 768px; one row from 1024px in the 1140px well', () => {
    const css = readSrcFile('features/news/masthead/SectionNav.module.css')
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.toggle\s*\{\s*display:\s*none/)
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*flex-wrap:\s*nowrap/)
    expect(css).toMatch(/max-width:\s*1140px/)
    expect(readSrcFile('features/news/masthead/OutletMasthead.module.css'))
      .toMatch(/@media \(max-width: 767\.98px\)\s*\{\s*\.tagline\s*\{\s*display:\s*none/)
  })
})

describe('OutletMasthead: no platform chrome (D3-P4)', () => {
  const PLATFORM_WORDS = /exercise|preview|sponsored|\blive\b|breaking/i

  it.each(VARIANTS)('%s draws no platform-authored words', variant => {
    const { container } = renderMasthead({ tokens: variantTokens(variant), showLiveChip: true })
    expect(masthead(container).textContent).not.toMatch(PLATFORM_WORDS)
  })

  it('shows the live chip only when the skin declares it AND the page opts in', () => {
    const withChip = variantTokens('tv-bar', { liveChip: 'LIVE' })
    const { unmount } = renderMasthead({ tokens: withChip })
    expect(screen.queryByText('LIVE')).toBeNull()
    unmount()

    const second = renderMasthead({ tokens: variantTokens('tv-bar'), showLiveChip: true })
    expect(second.container.textContent).not.toMatch(/live/i)
    second.unmount()

    renderMasthead({ tokens: withChip, showLiveChip: true })
    const chip = screen.getByText('LIVE')
    expect(chip).not.toHaveAttribute('role')
    expect(chip.closest('[role="status"], [aria-live]')).toBeNull()
  })

  it('never borrows the breaking vocabulary for the masthead', () => {
    renderMasthead({ tokens: variantTokens('tabloid-flag'), showLiveChip: true })
    expect(screen.queryByText(/BREAKING NEWS/)).toBeNull()
  })
})

describe('OutletMasthead: heading order', () => {
  it('is the page h1 on the outlet home', () => {
    renderMasthead({ nameAs: 'h1', current: { kind: 'home' } })
    expect(screen.getByRole('heading', { level: 1, name: 'Metro Desk 9' })).toBeInTheDocument()
  })

  it('is not a heading on article pages (a labelled region instead)', () => {
    renderMasthead()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByRole('region', { name: 'Metro Desk 9' })).toBeInTheDocument()
  })
})

describe('OutletMasthead: two worlds', () => {
  const SOURCES = [
    'features/news/masthead/OutletMasthead.tsx',
    'features/news/masthead/SectionNav.tsx',
    'features/news/masthead/mastheadModel.ts',
  ]

  it('imports no COBRA, no MUI components and no MUI icons', () => {
    for (const file of SOURCES) {
      const imports = readSrcFile(file).split('\n').filter(line => /^\s*import\b|from '/.test(line))
      expect(imports.join('\n'), file).not.toMatch(/@\/theme|cobra/i)
      expect(imports.join('\n'), file).not.toMatch(/@mui\//)
    }
  })

  it('styles every colour and family through skin custom properties', () => {
    for (const file of [
      'features/news/masthead/OutletMasthead.module.css',
      'features/news/masthead/SectionNav.module.css',
    ]) {
      const css = readSrcFile(file).replace(/\/\*[\s\S]*?\*\//g, '')
      // Every hex colour is a var() fallback, never a bare value.
      const bareHex = css.split('\n').filter(line => /#[0-9a-f]{3,6}\b/i.test(line) && !/var\(--pulse-skin-/.test(line))
      expect(bareHex, file).toEqual([])
      const families = css.split('\n').filter(line => /font-family:/.test(line))
      for (const line of families) expect(line, file).toMatch(/var\(--pulse-skin-font-/)
    }
  })
})

describe('OutletMasthead: accessibility (NFR-001)', () => {
  it.each(VARIANTS)('%s has no serious or critical axe findings', async variant => {
    const { container } = renderMasthead({
      tokens: variantTokens(variant, { liveChip: 'LIVE' }),
      showLiveChip: true,
      current: { kind: 'section', category: 'Local' },
    })
    expect(await seriousAxeViolations(container)).toEqual([])
  })

  it('has no serious or critical axe findings with the disclosure open on the home', async () => {
    const user = userEvent.setup()
    const { container } = renderMasthead({ nameAs: 'h1', current: { kind: 'home' } })
    await user.click(screen.getByRole('button', { name: 'Sections' }))
    expect(await seriousAxeViolations(container)).toEqual([])
  })

  it('renders SectionNav on its own inside a scope', () => {
    render(
      <MemoryRouter>
        <SkinScope scopeId="outlet-x" tokens={NEUTRAL_SKIN_TOKENS}>
          <SectionNav outlet={OUTLET} />
        </SkinScope>
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
})
