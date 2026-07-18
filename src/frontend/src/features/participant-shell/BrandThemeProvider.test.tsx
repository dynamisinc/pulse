/**
 * features/participant-shell/BrandThemeProvider.test.tsx
 * ---------------------------------------------------------------------------
 * Story 07 (brand-theming hooks) — RTL coverage for `BrandThemeProvider.tsx`:
 * channels receive brand tokens (AC1), swapping brand config reskins a
 * channel with zero shell code change (AC2), the CSS-var publication is
 * scoped to the provider's own wrapper and never `:root` (structural
 * XC-002/003 boundary), the shell's own chrome stays independent of the
 * brand (XC-002/003), and the participant world never reads as an
 * enterprise/COBRA/default-MUI surface (D0 §2).
 *
 * `./brandTokens`'s `useBrandConfig` is mocked at the module boundary (via a
 * partial mock that keeps the REAL `BrandTokensContext` / `useBrandTokens` /
 * `BRAND_*_VAR` constants) so every test controls exactly the resolved
 * `BrandTokens` under test, independent of that seam's own network/query
 * behavior (covered separately in `./brandTokens.test.tsx` /
 * `./brandTokens.default.test.tsx`) - mirrors `ComplianceChrome.test.tsx`
 * mocking `useChromeConfig`.
 *
 * `./chromeConfig`'s `useChromeConfig` is mocked the same way for the
 * shell-chrome-independence suite, so `<ComplianceChrome>` can be mounted
 * alongside `<BrandThemeProvider>` with a config under direct test control.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandThemeProvider } from './BrandThemeProvider'
import {
  BRAND_ACCENT_VAR,
  BRAND_ON_SURFACE_VAR,
  BRAND_PRIMARY_VAR,
  BRAND_SURFACE_VAR,
  useBrandConfig,
  useBrandTokens,
  type BrandTokens,
} from './brandTokens'
import { ComplianceChrome } from './components/ComplianceChrome'
import { useChromeConfig } from './chromeConfig'
import { SHELL_CHROME_BOTTOM_VAR, SHELL_CHROME_TOP_VAR } from './mountContract'
import type { ChromeConfig } from './mountContract'

vi.mock('./brandTokens', async importOriginal => {
  const actual = await importOriginal<typeof import('./brandTokens')>()
  return { ...actual, useBrandConfig: vi.fn() }
})

vi.mock('./chromeConfig', () => ({
  useChromeConfig: vi.fn(),
}))

const mockUseBrandConfig = vi.mocked(useBrandConfig)
const mockUseChromeConfig = vi.mocked(useChromeConfig)

const BRAND_A: BrandTokens = {
  name: 'Millbrook Community Feed',
  colors: { primary: '#7a1f3d', accent: '#f2b632', surface: '#101418', onSurface: '#f5f5f5' },
}

const BRAND_B: BrandTokens = {
  name: 'Sector Seven Wire',
  colors: { primary: '#0b6e4f', accent: '#c9184a', surface: '#ffffff', onSurface: '#111111' },
}

/** Stand-in for a channel consuming the brand-token seam. */
function BrandConsumer() {
  const tokens = useBrandTokens()
  return (
    <div data-testid="channel-consumer" style={{ color: tokens.colors.primary }}>
      {tokens.name}
    </div>
  )
}

describe('BrandThemeProvider — channels receive brand tokens (AC1, COR-066/030)', () => {
  it('provides the resolved brand tokens to a mounted channel via useBrandTokens()', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)

    render(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )

    const consumer = screen.getByTestId('channel-consumer')
    expect(consumer).toHaveTextContent(BRAND_A.name)
    expect(consumer).toHaveStyle({ color: BRAND_A.colors.primary })
  })
})

describe('BrandThemeProvider — swapping brand config reskins a channel with zero shell code change (AC2)', () => {
  it('reflects a second, differently-configured exercise brand on rerender - same provider/consumer code, only the resolved config changes', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)
    const { rerender } = render(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )
    expect(screen.getByTestId('channel-consumer')).toHaveTextContent(BRAND_A.name)

    mockUseBrandConfig.mockReturnValue(BRAND_B)
    rerender(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )

    const consumer = screen.getByTestId('channel-consumer')
    expect(consumer).toHaveTextContent(BRAND_B.name)
    expect(consumer).toHaveStyle({ color: BRAND_B.colors.primary })
    expect(screen.queryByText(BRAND_A.name)).not.toBeInTheDocument()
  })
})

describe('BrandThemeProvider — CSS-var publication is scoped to its own wrapper, never :root', () => {
  it('publishes --pulse-brand-* on its own wrapper element, never on document.documentElement', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)

    render(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )

    const wrapper = screen.getByTestId('pulse-brand-theme-scope')
    expect(wrapper.style.getPropertyValue(BRAND_PRIMARY_VAR)).toBe(BRAND_A.colors.primary)
    expect(wrapper.style.getPropertyValue(BRAND_ACCENT_VAR)).toBe(BRAND_A.colors.accent)
    expect(wrapper.style.getPropertyValue(BRAND_SURFACE_VAR)).toBe(BRAND_A.colors.surface)
    expect(wrapper.style.getPropertyValue(BRAND_ON_SURFACE_VAR)).toBe(BRAND_A.colors.onSurface)

    // The shell's own :root is untouched by brand tokens - they never
    // globalize beyond the provider's own wrapper element.
    expect(document.documentElement.style.getPropertyValue(BRAND_PRIMARY_VAR)).toBe('')
  })

  it('adds no layout box of its own (display: contents) - mounting the provider changes no channel layout', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)

    render(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )

    expect(screen.getByTestId('pulse-brand-theme-scope').style.display).toBe('contents')
  })
})

describe('BrandThemeProvider — the shell\'s own chrome is independent of the brand (XC-002/003)', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(SHELL_CHROME_TOP_VAR)
    document.documentElement.style.removeProperty(SHELL_CHROME_BOTTOM_VAR)
  })

  const chromeConfig: ChromeConfig = {
    enabled: true,
    top: { text: 'EXERCISE BANNER TOP', fg: '#eaf5e6', bg: '#2e6b2e' },
    bottom: { text: 'EXERCISE BANNER BOTTOM', fg: '#eaf5e6', bg: '#2e6b2e' },
  }

  it('leaves ComplianceChrome\'s banner colors exactly as its own chrome config, unaffected by a wildly different brand palette', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)
    mockUseChromeConfig.mockReturnValue(chromeConfig)

    render(
      <BrandThemeProvider>
        <ComplianceChrome />
      </BrandThemeProvider>,
    )

    const top = screen.getByTestId('pulse-compliance-chrome-top')
    expect(top).toHaveStyle({ color: chromeConfig.top.fg, backgroundColor: chromeConfig.top.bg })
    // Neither of the brand's colors ever reaches the chrome banner - the
    // exercise signal never re-skins to match the fiction.
    expect(top).not.toHaveStyle({ color: BRAND_A.colors.primary })
    expect(top).not.toHaveStyle({ backgroundColor: BRAND_A.colors.primary })
  })

  it('never publishes brand CSS vars onto :root alongside the shell\'s own chrome inset vars', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)
    mockUseChromeConfig.mockReturnValue(chromeConfig)

    render(
      <BrandThemeProvider>
        <ComplianceChrome />
      </BrandThemeProvider>,
    )

    // ComplianceChrome's own :root inset contract is present...
    expect(document.documentElement.style.getPropertyValue(SHELL_CHROME_TOP_VAR)).toBe('22px')
    // ...but the brand tokens never join it on :root - they stay scoped to
    // BrandThemeProvider's own wrapper (asserted separately above).
    expect(document.documentElement.style.getPropertyValue(BRAND_PRIMARY_VAR)).toBe('')
  })
})

describe('BrandThemeProvider — never reads as an enterprise/COBRA/default-MUI surface (D0 §2)', () => {
  it('renders a plain wrapper element with no MUI/COBRA class names', () => {
    mockUseBrandConfig.mockReturnValue(BRAND_A)

    render(
      <BrandThemeProvider>
        <BrandConsumer />
      </BrandThemeProvider>,
    )

    const wrapper = screen.getByTestId('pulse-brand-theme-scope')
    expect(wrapper.tagName).toBe('DIV')
    // A plain React div carries no className at all; an MUI Box/ThemeProvider
    // descendant would stamp a `Mui*-root` class here.
    expect(wrapper.className).toBe('')
  })
})
