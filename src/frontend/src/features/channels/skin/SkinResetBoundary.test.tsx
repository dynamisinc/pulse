/**
 * Story 13 AC "Token-object scope and reset boundary" (news FU-6b): an
 * embedded Social post nested in a loud skin is immune to the outlet tokens.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createTheme, useTheme } from '@mui/material/styles'
import {
  BRAND_ACCENT_VAR,
  BRAND_ON_SURFACE_VAR,
  BrandTokensContext,
  type BrandTokens,
} from '@/features/participant-shell/brandTokens'
import { SkinResetBoundary } from './SkinResetBoundary'
import { SkinScope } from './SkinScope'
import { registerSkinExtension, resetSkinRegistryForTests } from './registry'
import { useSkin } from './skinContext'
import { PARTICIPANT_BASE_FONT, SKIN_CSS_VARS, skinExtColorVar } from './theme'
import type { OutletSkinTokens } from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'

const BRAND: BrandTokens = {
  name: 'Test Exercise',
  colors: { primary: '#2b5f75', accent: '#d97706', surface: '#ffffff', onSurface: '#1c1c1c' },
}

/** A deliberately loud tabloid skin. */
const LOUD: OutletSkinTokens = {
  ...NEUTRAL_SKIN_TOKENS,
  type: {
    mastheadFamily: 'Impact, sans-serif',
    hedFamily: 'Impact, sans-serif',
    dekFamily: 'Impact, sans-serif',
    bodyFamily: "'Comic Sans MS', cursive",
    kickerFamily: 'Impact, sans-serif',
    hedCase: 'uppercase',
  },
  palette: {
    accent: '#e6007e', link: '#000000', bg: '#ffd400', surface: '#ffffff',
    text: '#000000', rule: '#000000', breaking: '#e6007e',
  },
  ext: { news: { chipColor: '#e6007e' } },
}

/** A stand-in for the Social `PostCard`: reports the theme and context it sees. */
function PostCardProbe() {
  const theme = useTheme()
  let hasSkin = true
  try {
    useSkin()
  } catch {
    hasSkin = false
  }
  return <article data-testid="post" data-mui-primary={theme.palette.primary.main} data-has-skin={String(hasSkin)} />
}

afterEach(() => {
  resetSkinRegistryForTests()
})

function renderNested() {
  registerSkinExtension('news', { keys: { chipColor: { type: 'color', large: true } } })
  return render(
    <BrandTokensContext.Provider value={BRAND}>
      <SkinScope scopeId="outlet-the-scoop" tokens={LOUD} skinKey="the-scoop">
        <SkinResetBoundary>
          <PostCardProbe />
        </SkinResetBoundary>
      </SkinScope>
    </BrandTokensContext.Provider>,
  )
}

describe('SkinResetBoundary', () => {
  it('restores the MUI theme from outside every skin scope', () => {
    renderNested()
    const post = screen.getByTestId('post')
    expect(post.dataset.muiPrimary).toBe(createTheme().palette.primary.main)
    expect(post.dataset.muiPrimary).not.toBe(LOUD.palette.accent)
  })

  it('unsets every skin custom property (including ext colours) and re-applies the exercise brand', () => {
    renderNested()
    const reset = screen.getByTestId('post').closest<HTMLElement>('[data-skin-reset]')
    if (!reset) throw new Error('no reset boundary')
    for (const name of Object.values(SKIN_CSS_VARS)) {
      expect(reset.style.getPropertyValue(name)).toBe('initial')
    }
    expect(reset.style.getPropertyValue(skinExtColorVar('news', 'chipColor'))).toBe('initial')
    expect(reset.style.getPropertyValue(BRAND_ACCENT_VAR)).toBe(BRAND.colors.accent)
    expect(reset.style.getPropertyValue(BRAND_ON_SURFACE_VAR)).toBe(BRAND.colors.onSurface)
    expect(reset.style.color).toBe('rgb(28, 28, 28)')
    // jsdom re-serialises the quotes; compare the family names.
    expect(reset.style.fontFamily.replace(/["']/g, '')).toBe(PARTICIPANT_BASE_FONT.replace(/["']/g, ''))
    expect(reset.style.textTransform).toBe('none')

    // The loud scope is still there above the boundary.
    const scope = reset.closest<HTMLElement>('[data-skin-scope]')
    expect(scope?.style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('#e6007e')
  })

  it('hides the skin context from the embed', () => {
    renderNested()
    expect(screen.getByTestId('post').dataset.hasSkin).toBe('false')
  })

  it('fails closed outside a BrandThemeProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const orphan = <SkinResetBoundary><span /></SkinResetBoundary>
    expect(() => render(orphan)).toThrow(/BrandThemeProvider/)
  })
})
