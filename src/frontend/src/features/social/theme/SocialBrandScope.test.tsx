/**
 * features/social/theme/SocialBrandScope.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Brand accent wired" AC: the social root sets `--pulse-ac` from
 * the RESOLVED brand accent, so the Follow button / hashtags / active tab
 * underline / focus rings (all of which read `var(--pulse-ac)`) follow a
 * rebrand — and the verified seal stays the fixed `#2D9CDB`.
 *
 * The brand seam under test is the real `BrandThemeProvider` + `useBrand()`; only
 * `useBrandConfig` (the network-backed resolver) is stubbed so each test controls
 * exactly which brand resolves — the same technique `BrandThemeProvider.test.tsx`
 * uses. jsdom does not apply stylesheets, so propagation is asserted where it is
 * actually set: the inline custom property on the scope wrapper that every
 * descendant inherits from.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandThemeProvider } from '@/features/participant-shell/BrandThemeProvider'
import { useBrandConfig, type BrandTokens } from '@/features/participant-shell/brandTokens'
import { VerifiedMark } from '../components/VerifiedMark'
import { MIN_ACCENT_CONTRAST, contrastOnWhite } from './accent'
import { SocialBrandScope } from './SocialBrandScope'
import { ACCENT_CSS_VAR, DEFAULT_ACCENT, FONT_FAMILY, SEAL_BLUE } from './tokens'

vi.mock('@/features/participant-shell/brandTokens', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/brandTokens')>()
  return { ...actual, useBrandConfig: vi.fn() }
})

const mockUseBrandConfig = vi.mocked(useBrandConfig)

/** A non-default brand whose accent already clears AA, so it must pass through as-is. */
const SECTOR_SEVEN: BrandTokens = {
  name: 'Sector Seven Wire',
  colors: { primary: '#0b6e4f', accent: '#c9184a', surface: '#ffffff', onSurface: '#111111' },
}

const MILLBROOK: BrandTokens = {
  name: 'Millbrook Community Feed',
  colors: { primary: '#7a1f3d', accent: '#6d28d9', surface: '#ffffff', onSurface: '#111111' },
}

/** The unconfigured default brand (amber `#d97706`, 3.2:1 on white: below AA). */
const AMBER_DEFAULT: BrandTokens = {
  name: 'Sample Exercise Network',
  colors: { primary: '#2b5f75', accent: '#d97706', surface: '#ffffff', onSurface: '#1c1c1c' },
}

function renderScope(brand: BrandTokens) {
  mockUseBrandConfig.mockReturnValue(brand)
  return render(
    <BrandThemeProvider>
      <SocialBrandScope>
        <button type="button">Follow</button>
        <VerifiedMark />
      </SocialBrandScope>
    </BrandThemeProvider>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('SocialBrandScope — --pulse-ac is set from the resolved brand accent', () => {
  it('sets --pulse-ac to the brand accent for a non-default brand (and the descendants sit inside it)', () => {
    renderScope(SECTOR_SEVEN)

    const scope = screen.getByTestId('social-brand-scope')
    expect(scope.style.getPropertyValue(ACCENT_CSS_VAR)).toBe(SECTOR_SEVEN.colors.accent)
    expect(ACCENT_CSS_VAR).toBe('--pulse-ac')
    // The Follow button (and everything else in the channel) inherits from the scope.
    expect(scope).toContainElement(screen.getByRole('button', { name: 'Follow' }))
  })

  it('follows a rebrand: a different brand yields a different --pulse-ac, no other code changes', () => {
    const { rerender } = renderScope(SECTOR_SEVEN)
    expect(
      screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR),
    ).toBe('#c9184a')

    mockUseBrandConfig.mockReturnValue(MILLBROOK)
    rerender(
      <BrandThemeProvider>
        <SocialBrandScope>
          <button type="button">Follow</button>
        </SocialBrandScope>
      </BrandThemeProvider>,
    )

    expect(
      screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR),
    ).toBe('#6d28d9')
  })

  it('reads the same accent the shell publishes as --pulse-brand-accent', () => {
    renderScope(SECTOR_SEVEN)

    const shellScope = screen.getByTestId('pulse-brand-theme-scope')
    expect(shellScope.style.getPropertyValue('--pulse-brand-accent')).toBe('#c9184a')
    expect(
      screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR),
    ).toBe(shellScope.style.getPropertyValue('--pulse-brand-accent'))
  })

  it('keeps the raw brand colour untouched on the shell wrapper even when --pulse-ac is adjusted', () => {
    renderScope(AMBER_DEFAULT)

    expect(
      screen.getByTestId('pulse-brand-theme-scope').style.getPropertyValue('--pulse-brand-accent'),
    ).toBe('#d97706')
  })

  it('never sets --pulse-ac on :root / document.documentElement (it is scoped to the channel)', () => {
    renderScope(SECTOR_SEVEN)

    expect(document.documentElement.style.getPropertyValue(ACCENT_CSS_VAR)).toBe('')
    expect(document.body.style.getPropertyValue(ACCENT_CSS_VAR)).toBe('')
  })

  it('adds no box of its own (display: contents) and sets the Figtree type stack', () => {
    renderScope(SECTOR_SEVEN)

    const scope = screen.getByTestId('social-brand-scope')
    expect(scope.style.display).toBe('contents')
    expect(scope.style.fontFamily).toContain('Figtree')
    expect(FONT_FAMILY).toContain("'Figtree Variable'")
    expect(FONT_FAMILY).toContain("'Figtree'")
  })
})

describe('SocialBrandScope — the accent stays legible (NFR-001, WCAG 1.4.3)', () => {
  it('darkens the default amber so hashtag text and the Follow label clear 4.5:1 on white', () => {
    renderScope(AMBER_DEFAULT)

    const set = screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR)
    expect(set).not.toBe('#d97706')
    expect(contrastOnWhite(set)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('does not alter an accent that already passes', () => {
    renderScope(SECTOR_SEVEN)

    const set = screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR)
    expect(set).toBe(SECTOR_SEVEN.colors.accent)
  })

  it('the social default (no scope at all) is the Cadence navy, which already passes', () => {
    expect(DEFAULT_ACCENT).toBe('#1e3a5f')
    expect(contrastOnWhite(DEFAULT_ACCENT)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })
})

describe('SocialBrandScope — the verified seal stays the fixed #2D9CDB (SOC-052, D1-003/R-001)', () => {
  it('paints the seal in SEAL_BLUE under every brand, however the accent is set', () => {
    for (const brand of [SECTOR_SEVEN, MILLBROOK, AMBER_DEFAULT]) {
      const { unmount } = renderScope(brand)

      const seal = screen.getByTestId('verified-mark').querySelector('path[fill]')
      expect(seal).toHaveAttribute('fill', SEAL_BLUE)
      expect(SEAL_BLUE).toBe('#2D9CDB')
      expect(seal).not.toHaveAttribute(
        'fill',
        screen.getByTestId('social-brand-scope').style.getPropertyValue(ACCENT_CSS_VAR),
      )
      unmount()
    }
  })
})

describe('SocialBrandScope — fails closed like useBrand()', () => {
  it('throws outside a BrandThemeProvider rather than inventing a brand', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<SocialBrandScope>x</SocialBrandScope>)).toThrow(/BrandThemeProvider/)
    } finally {
      consoleError.mockRestore()
    }
  })
})
