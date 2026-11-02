/**
 * PortalSkinScope (exercise-portal story 06, AC1 + AC2): the portal tokens mount inside
 * the subtree only, with a portal MUI theme; overrides merge through F13's validator and
 * anything invalid, out of the allowlist or on the CANNOT list falls back to the defaults.
 */
import { render, screen } from '@testing-library/react'
import { useTheme } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSkinTokens, useSkin, type OutletSkinTokens } from '@/features/channels'
import { PORTAL_SKIN_KEY, PORTAL_TODAY_GOLD, PortalSkinScope, portalTokens } from '.'

afterEach(() => {
  vi.restoreAllMocks()
})

function Probe() {
  const { tokens } = useSkin()
  const bg = useTheme().palette.background.default
  return <span data-testid="probe" data-tokens={JSON.stringify(tokens)} data-bg={bg}>in scope</span>
}

/** The tokens the probe saw inside the scope. */
function seenTokens(): OutletSkinTokens {
  return JSON.parse(screen.getByTestId('probe').dataset.tokens ?? 'null') as OutletSkinTokens
}

function mount(skinOverrides?: Record<string, unknown> | null) {
  // Invalid overrides are reported in dev; keep the test output quiet.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return render(
    <div data-testid="outside">
      <PortalSkinScope skinOverrides={skinOverrides as never}>
        <Probe />
      </PortalSkinScope>
    </div>,
  )
}

function scopeEl(): HTMLElement {
  const el = screen.getByTestId('probe').closest('[data-skin-scope]')
  if (!(el instanceof HTMLElement)) throw new Error('no skin scope')
  return el
}

describe('PortalSkinScope: token set and scope (AC1)', () => {
  it('registers the portal tokens with F13 under the "portal" key', () => {
    expect(getSkinTokens(PORTAL_SKIN_KEY)).toEqual(portalTokens)
    expect(portalTokens.schemaVersion).toBe(1)
  })

  it('applies the CSS custom properties on its own wrapper, never above it', () => {
    mount()
    const scope = scopeEl()
    expect(scope.dataset.skinScope).toBe('portal')
    expect(scope.dataset.skinKey).toBe('portal')
    expect(scope.style.getPropertyValue('--pulse-skin-accent')).toBe(portalTokens.palette.accent)
    expect(scope.style.getPropertyValue('--pulse-skin-font-masthead')).toContain('Libre Franklin')
    for (const el of [document.documentElement, document.body, screen.getByTestId('outside')]) {
      expect(el.style.getPropertyValue('--pulse-skin-accent')).toBe('')
    }
  })

  it('mounts a portal MUI theme built from the tokens inside the subtree', () => {
    mount()
    expect(screen.getByTestId('probe').dataset.bg).toBe(portalTokens.palette.bg)
    expect(seenTokens().type.bodyFamily).toBe(portalTokens.type.bodyFamily)
  })
})

describe('PortalSkinScope: per-exercise brand (AC2)', () => {
  it('merges valid overrides over the portal tokens', () => {
    mount({ palette: { accent: '#7a1f1f' }, ext: { portal: { todayColor: '#ffd75e' } } })
    expect(seenTokens().palette.accent).toBe('#7a1f1f')
    expect(seenTokens().palette.bg).toBe(portalTokens.palette.bg)
    expect(seenTokens().ext?.portal?.todayColor).toBe('#ffd75e')
    expect(scopeEl().style.getPropertyValue('--pulse-skin-accent')).toBe('#7a1f1f')
  })

  it('null overrides render the default tokens', () => {
    mount(null)
    expect(seenTokens().palette).toEqual(portalTokens.palette)
    expect(seenTokens().ext?.portal?.todayColor).toBe(PORTAL_TODAY_GOLD)
  })

  it.each([
    ['an unknown palette key', { palette: { accent: '#7a1f1f', glow: '#ff0000' } }],
    ['a non-hex colour', { palette: { accent: 'red' } }],
    ['an unknown top-level group', { accent: '#7a1f1f' }],
    ['a wrong schema version', { schemaVersion: 2, palette: { accent: '#7a1f1f' } }],
  ])('falls back to the default tokens for %s', (_label, overrides) => {
    mount(overrides)
    expect(seenTokens().palette).toEqual(portalTokens.palette)
  })

  // The CANNOT list (FC-3b): none of these is a token key, so the strict schema rejects
  // the whole object and nothing reaches slot order, the clock, the watermark or the floor.
  it.each([
    ['slot order', { layout: { slotOrder: ['hero', 'dateline'] } }],
    ['the scenario-time source', { dateline: { format: 'standard', source: 'wall-clock' } }],
    ['the scenario-time source (top level)', { scenarioTime: 'wall' }],
    ['the watermark slot', { watermark: { hidden: true } }],
    ['the watermark slot (media)', { media: { watermark: false } }],
    ['the a11y floor (body size)', { type: { bodySize: '12px' } }],
    ['the a11y floor (contrast)', { a11y: { minContrast: 1 } }],
  ])('cannot address %s', (_label, overrides) => {
    mount({ palette: { accent: '#7a1f1f' }, ...overrides })
    expect(seenTokens().palette.accent).toBe(portalTokens.palette.accent)
    expect(Object.keys(seenTokens())).not.toEqual(expect.arrayContaining(['watermark', 'scenarioTime', 'a11y']))
  })

  it('an override that breaks AA is clamped by the F13 floor, not rendered', () => {
    mount({ palette: { text: '#eeeeee' } })
    expect(seenTokens().palette.text).not.toBe('#eeeeee')
  })

  it('an ext namespace other than portal is dropped', () => {
    mount({ ext: { social: { accent: '#7a1f1f' } } })
    expect(seenTokens().ext).toEqual({ portal: { todayColor: PORTAL_TODAY_GOLD } })
  })

  it('an undeclared ext.portal key is dropped', () => {
    mount({ ext: { portal: { slotOrder: 'x', todayColor: '#ffd75e' } } })
    expect(seenTokens().ext?.portal).toEqual({ todayColor: '#ffd75e' })
  })
})
