/**
 * Story 13 ACs "Scope provider", "Token-object scope", "Merge" (fifth
 * outlet) and "Fonts" (lazy load on mount).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme, useTheme, type Theme } from '@mui/material/styles'
import { OutletSkinScope } from './OutletSkinScope'
import { SkinScope } from './SkinScope'
import { registerSkinExtension, registerSkinTokens, resetSkinRegistryForTests } from './registry'
import { resetSkinReportsForTests } from './report'
import { resetSkinFontsForTests } from './fonts'
import { useSkin } from './skinContext'
import { SKIN_CSS_VARS, skinExtColorVar } from './theme'
import type { OutletSkinTokens } from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'

function tokensWith(accent: string, bodyFamily = 'Georgia, serif'): OutletSkinTokens {
  return {
    ...NEUTRAL_SKIN_TOKENS,
    type: { ...NEUTRAL_SKIN_TOKENS.type, bodyFamily },
    palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent },
  }
}

/** A stand-in for channel layout code: it reads only the skin, never a key. */
function Probe({ id }: { id: string }) {
  const theme = useTheme()
  const { tokens, skinKey } = useSkin()
  return (
    <span
      data-testid={id}
      data-mui-primary={theme.palette.primary.main}
      data-token-accent={tokens.palette.accent}
      data-skin-key={skinKey}
    />
  )
}

/** Reads only the MUI theme, so it can sit outside every scope. */
function ThemeProbe({ id }: { id: string }) {
  return <span data-testid={id} data-mui-primary={useTheme().palette.primary.main} />
}

function scopeOf(testId: string): HTMLElement {
  const el = screen.getByTestId(testId).closest<HTMLElement>('[data-skin-scope]')
  if (!el) throw new Error('no scope')
  return el
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
  resetSkinRegistryForTests()
  resetSkinReportsForTests()
  resetSkinFontsForTests()
  vi.unstubAllGlobals()
  // The font tests stub `document.fonts`; remove the stub so it cannot leak.
  delete (document as { fonts?: unknown }).fonts
})

describe('SkinScope', () => {
  it('mounts CSS custom properties and an MUI theme inside its subtree only', () => {
    render(
      <>
        <ThemeProbe id="outside-probe" />
        <SkinScope scopeId="portal" tokens={tokensWith('#0f2749')}>
          <Probe id="inside" />
        </SkinScope>
      </>,
    )
    const scope = scopeOf('inside')
    expect(scope.dataset.skinScope).toBe('portal')
    expect(scope.style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('#0f2749')
    expect(scope.style.getPropertyValue(SKIN_CSS_VARS.onAccent)).toBe('#ffffff')
    expect(scope.style.display).toBe('contents')
    expect(scope.style.fontFamily).toBe('Georgia, serif')
    expect(screen.getByTestId('inside').dataset.muiPrimary).toBe('#0f2749')

    // Nothing leaks to the document or to a sibling outside the scope.
    expect(document.documentElement.style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('')
    expect(document.body.style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('')
    expect(screen.getByTestId('outside-probe').dataset.muiPrimary).not.toBe('#0f2749')
  })

  it('throws useSkin() outside a scope (fails closed)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe id="x" />)).toThrow(/within a <SkinScope>/)
  })

  it('keeps two sibling scopes from bleeding into each other', () => {
    render(
      <>
        <SkinScope scopeId="a" tokens={tokensWith('#0f2749')}><Probe id="a" /></SkinScope>
        <SkinScope scopeId="b" tokens={tokensWith('#9a3412')}><Probe id="b" /></SkinScope>
      </>,
    )
    expect(scopeOf('a').style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('#0f2749')
    expect(scopeOf('b').style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('#9a3412')
    expect(screen.getByTestId('a').dataset.muiPrimary).toBe('#0f2749')
    expect(screen.getByTestId('b').dataset.muiPrimary).toBe('#9a3412')
  })

  it('lets a nested scope replace (not merge with) the outer one, and only below it', () => {
    render(
      <SkinScope scopeId="outer" tokens={tokensWith('#0f2749')}>
        <Probe id="outer-probe" />
        <SkinScope scopeId="inner" tokens={tokensWith('#9a3412', 'Arial, sans-serif')}>
          <Probe id="inner-probe" />
        </SkinScope>
      </SkinScope>,
    )
    expect(screen.getByTestId('inner-probe').dataset.muiPrimary).toBe('#9a3412')
    expect(screen.getByTestId('outer-probe').dataset.muiPrimary).toBe('#0f2749')
    expect(scopeOf('inner-probe').style.getPropertyValue(SKIN_CSS_VARS.fontBody)).toBe('Arial, sans-serif')
  })

  it('does not inherit custom keys from an outer (e.g. COBRA-style) theme', () => {
    function CustomKeyProbe() {
      const theme = useTheme() as Theme & { cssStyling?: unknown }
      return <span data-testid="custom" data-has-custom={String(theme.cssStyling !== undefined)} />
    }
    const outer = { ...createTheme(), cssStyling: { staff: true } }
    render(
      <ThemeProvider theme={outer}>
        <SkinScope scopeId="portal" tokens={tokensWith('#0f2749')}><CustomKeyProbe /></SkinScope>
      </ThemeProvider>,
    )
    expect(screen.getByTestId('custom').dataset.hasCustom).toBe('false')
  })

  it('publishes only schema-declared colour ext keys as CSS variables', () => {
    registerSkinExtension('news', {
      keys: { chipColor: { type: 'color', large: true }, label: { type: 'string' } },
    })
    const tokens = { ...tokensWith('#0f2749'), ext: { news: { chipColor: '#c8102e', label: '#ffff00' } } }
    render(<SkinScope scopeId="n" tokens={tokens}><Probe id="ext" /></SkinScope>)
    expect(scopeOf('ext').style.getPropertyValue(skinExtColorVar('news', 'chipColor'))).toBe('#c8102e')
    expect(scopeOf('ext').style.getPropertyValue(skinExtColorVar('news', 'label'))).toBe('')
  })

  it('applies the a11y floor to a token object handed straight in', () => {
    const unreadable = { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, text: '#eeeeee' } }
    render(<SkinScope scopeId="portal" tokens={unreadable}><Probe id="p" /></SkinScope>)
    expect(scopeOf('p').style.getPropertyValue(SKIN_CSS_VARS.text)).toBe(NEUTRAL_SKIN_TOKENS.palette.text)
    expect(scopeOf('p').style.getPropertyValue(SKIN_CSS_VARS.bodySize)).toBe('max(1rem, 16px)')
  })

  it('produces no text of its own (nothing breaks fiction)', () => {
    const { container } = render(
      <SkinScope scopeId="portal" tokens={{ ...NEUTRAL_SKIN_TOKENS, breaking: { style: 'bar', vocabulary: 'BREAKING NEWS' } }}>
        {null}
      </SkinScope>,
    )
    expect(container.textContent).toBe('')
  })
})

describe('OutletSkinScope', () => {
  it('resolves a fifth outlet from a token file + one registration line, with no layout change', () => {
    // A "channel folder" registering a brand-new outlet; Probe (the layout) is unchanged.
    registerSkinTokens('fifth-outlet', tokensWith('#2e6b4f'))
    render(
      <OutletSkinScope outlet={{ slug: 'the-fifth', skinKey: 'fifth-outlet', skinOverrides: { palette: { link: '#1a4f8b' } } }}>
        <Probe id="fifth" />
      </OutletSkinScope>,
    )
    const probe = screen.getByTestId('fifth')
    expect(probe.dataset.tokenAccent).toBe('#2e6b4f')
    expect(probe.dataset.skinKey).toBe('fifth-outlet')
    expect(scopeOf('fifth').dataset.skinScope).toBe('outlet-the-fifth')
  })

  it('falls back to neutral for an unknown key', () => {
    render(
      <OutletSkinScope outlet={{ slug: 'x', skinKey: 'nope', skinOverrides: null }}>
        <Probe id="unknown" />
      </OutletSkinScope>,
    )
    expect(screen.getByTestId('unknown').dataset.skinKey).toBe('neutral')
    expect(screen.getByTestId('unknown').dataset.tokenAccent).toBe(NEUTRAL_SKIN_TOKENS.palette.accent)
  })

  it('re-skins when the channel registers after the scope mounted', () => {
    render(
      <OutletSkinScope outlet={{ slug: 'wire-room', skinKey: 'wire-room', skinOverrides: null }}>
        <Probe id="late" />
      </OutletSkinScope>,
    )
    expect(screen.getByTestId('late').dataset.tokenAccent).not.toBe('#123456')
    act(() => registerSkinTokens('wire-room', tokensWith('#123456')))
    expect(screen.getByTestId('late').dataset.tokenAccent).toBe('#123456')
  })
})

describe('fonts load lazily', () => {
  it('adds a skin\'s faces to document.fonts only when a scope for it mounts, once', () => {
    const constructed: { family: string; source: string; descriptors: FontFaceDescriptors }[] = []
    class FakeFontFace {
      constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
        constructed.push({ family, source, descriptors })
      }
      load() {
        return Promise.resolve(this)
      }
    }
    const add = vi.fn()
    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', { value: { add }, configurable: true })

    registerSkinTokens('newsline7', tokensWith('#0f2749', "'Oswald', sans-serif"), {
      fonts: [{ family: 'Oswald', src: '/assets/oswald-abc.woff2', weight: '200 700' }],
    })
    expect(constructed).toHaveLength(0)

    const outlet = { slug: 'newsline-7', skinKey: 'newsline7', skinOverrides: null }
    const { unmount } = render(<OutletSkinScope outlet={outlet}><span /></OutletSkinScope>)
    expect(constructed).toEqual([{
      family: 'Oswald',
      source: 'url("/assets/oswald-abc.woff2") format("woff2")',
      descriptors: { display: 'swap', weight: '200 700' },
    }])
    expect(add).toHaveBeenCalledTimes(1)

    unmount()
    render(<OutletSkinScope outlet={outlet}><span /></OutletSkinScope>)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('reports a face that fails to load and keeps rendering', async () => {
    class FailingFontFace {
      load() {
        return Promise.reject(new Error('blocked by CSP'))
      }
    }
    vi.stubGlobal('FontFace', FailingFontFace)
    Object.defineProperty(document, 'fonts', {
      value: { add: vi.fn(), delete: vi.fn() },
      configurable: true,
    })
    registerSkinTokens('newsline7', tokensWith('#0f2749'), {
      fonts: [{ family: 'Oswald', src: '/assets/oswald-abc.woff2' }],
    })
    render(
      <OutletSkinScope outlet={{ slug: 'n', skinKey: 'newsline7', skinOverrides: null }}>
        <span data-testid="still-here" />
      </OutletSkinScope>,
    )
    expect(screen.getByTestId('still-here')).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/font "Oswald" .* failed to load/))
    }, { timeout: 5000 })
    // The failed face is released, so the next scope mount retries it.
    expect(document.fonts.delete).toHaveBeenCalledTimes(1)
    render(
      <OutletSkinScope outlet={{ slug: 'n', skinKey: 'newsline7', skinOverrides: null }}>
        <span />
      </OutletSkinScope>,
    )
    expect(document.fonts.add).toHaveBeenCalledTimes(2)
  })
})
