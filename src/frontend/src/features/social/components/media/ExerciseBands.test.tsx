/**
 * features/social/components/media/ExerciseBands.test.tsx
 * ---------------------------------------------------------------------------
 * The shared EXERCISE media bands (demo-feedback 06, issue #502; NFR-008, DF-3, DF-4):
 *
 *  - WHEN: drawn iff `isWatermarkRequired` (the real DF-3 rule, `watermark || !enabled`,
 *    driven through a mocked `useChromeConfig`), or when `force`d; NOTHING otherwise;
 *    and toward marking (drawn) when rendered outside the shell's providers.
 *  - WHAT: a top band and a bottom band, each `EXERCISE EXERCISE EXERCISE`,
 *    `aria-hidden` (adds nothing to the accessibility tree).
 *  - LOOK (read off disk: Vitest blanks CSS imports): absolutely positioned over the
 *    media box (takes no layout space), `pointer-events: none`, uppercase, centred,
 *    scaling with the box via container query units within a legible clamp, and a
 *    COMPUTED >= 4.5:1 contrast for the skin-token text on the skin-token strip
 *    composited over the worst-case (pure white) media.
 *  - TWO WORLDS: no COBRA / MUI import on any file that draws the bands.
 *
 * `ExerciseBands.default.test.tsx` covers the unmocked shipped path (real providers,
 * the mock chrome config marks media by default).
 */
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import { contrastRatio, hexToRgb } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { LIGHT_PALETTE } from '../../theme/tokens'
import { ExerciseBands } from './ExerciseBands'
import { EXERCISE_BAND_TEXT } from './mediaCopy'

const ctl = vi.hoisted(() => ({ available: true, enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => ctl.available,
    useChromeConfig: (): ChromeConfig => ({
      enabled: ctl.enabled,
      watermark: ctl.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

beforeEach(() => {
  ctl.available = true
  ctl.enabled = true
  ctl.watermark = true
})

describe('ExerciseBands — when they render (DF-3)', () => {
  it.each([
    // watermark, chrome enabled, drawn
    [true, true, true],
    [true, false, true],
    [false, false, true],
    [false, true, false],
  ])('watermark=%s, chrome enabled=%s => bands drawn=%s', (watermark, enabled, drawn) => {
    ctl.watermark = watermark
    ctl.enabled = enabled
    render(<ExerciseBands />)

    expect(screen.queryByTestId('exercise-bands') !== null).toBe(drawn)
  })

  it('renders NOTHING at all when not required (no empty wrapper left behind)', () => {
    ctl.watermark = false
    const { container } = render(<ExerciseBands />)

    expect(container).toBeEmptyDOMElement()
  })

  it('force draws them even when not required (the fullscreen player)', () => {
    ctl.watermark = false
    render(<ExerciseBands force />)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('fails toward marking outside the shell providers (no config to read)', () => {
    ctl.available = false
    ctl.watermark = false
    render(<ExerciseBands />)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })
})

describe('ExerciseBands — what they draw (DF-4)', () => {
  it('draws a TOP band and a BOTTOM band, each reading EXERCISE EXERCISE EXERCISE', () => {
    render(<ExerciseBands />)

    const overlay = screen.getByTestId('exercise-bands')
    const top = within(overlay).getByTestId('exercise-band-top')
    const bottom = within(overlay).getByTestId('exercise-band-bottom')
    expect(EXERCISE_BAND_TEXT).toBe('EXERCISE EXERCISE EXERCISE')
    expect(top).toHaveTextContent(/^EXERCISE EXERCISE EXERCISE$/)
    expect(bottom).toHaveTextContent(/^EXERCISE EXERCISE EXERCISE$/)
    // Order: top first, bottom last (the CSS spreads them to the two edges).
    expect(overlay.firstElementChild).toBe(top)
    expect(overlay.lastElementChild).toBe(bottom)
  })

  it('is aria-hidden: it adds nothing to the accessibility tree', () => {
    render(
      <div role="img" aria-label="Floodwater on Main Street">
        <ExerciseBands />
      </div>,
    )

    expect(screen.getByTestId('exercise-bands')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText(EXERCISE_BAND_TEXT, { ignore: '[aria-hidden] *' })).toBeNull()
    expect(screen.getByRole('img')).toHaveAccessibleName('Floodwater on Main Street')
  })

  it('is built of <span>s only, so it is valid inside a <button> tile (Gate-1 L-4)', () => {
    render(
      <button type="button" aria-label="Photo">
        <ExerciseBands />
      </button>,
    )

    const overlay = screen.getByTestId('exercise-bands')
    expect(overlay.tagName).toBe('SPAN')
    expect(overlay.querySelectorAll('*')).toHaveLength(4)
    expect(overlay.querySelectorAll(':not(span)')).toHaveLength(0)
    expect(screen.getByRole('button')).toHaveAccessibleName('Photo')
  })

  it('marks the video variant so the bottom band clears the native control bar', () => {
    render(<ExerciseBands clearNativeControls />)

    expect(screen.getByTestId('exercise-bands')).toHaveAttribute('data-clear-native-controls', 'true')
  })
})

// -----------------------------------------------------------------------------
// The stylesheet (read off disk)
// -----------------------------------------------------------------------------

const css = readSrcFile('features/social/components/media/ExerciseBands.module.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1]
  if (body === undefined) throw new Error(`rule ${selector} not found`)
  return body
}

/** `#rgb` or `#rrggbb` -> `#rrggbb`. */
function longHex(hex: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  return short === null ? hex : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
}

/** `fg` at `alpha` composited over `bg` (sRGB), as `#rrggbb`. */
function composite(fg: string, alpha: number, bg: string): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  return '#' + f.map((c, i) => Math.round(c * alpha + (b[i] ?? 0) * (1 - alpha)))
    .map(c => c.toString(16).padStart(2, '0')).join('')
}

describe('ExerciseBands — stylesheet', () => {
  it('overlays the media box without taking layout space, and is click-through', () => {
    const bands = rule('.bands')
    expect(bands).toMatch(/display:\s*flex/)
    expect(bands).toMatch(/position:\s*absolute/)
    expect(bands).toMatch(/inset:\s*0/)
    expect(bands).toMatch(/pointer-events:\s*none/)
    // Top band at the top edge, bottom band at the bottom edge.
    expect(bands).toMatch(/flex-direction:\s*column/)
    expect(bands).toMatch(/justify-content:\s*space-between/)
  })

  it('draws uppercase, centred text on a strip spanning the box', () => {
    const band = rule('.band')
    expect(band).toMatch(/text-transform:\s*uppercase/)
    expect(band).toMatch(/text-align:\s*center/)
    expect(band).toMatch(/justify-content:\s*center/)
    expect(band).toMatch(/width:\s*100%/)
    expect(band).toMatch(/white-space:\s*nowrap/)
  })

  it('scales with the MEDIA BOX (container units), clamped legible-but-not-dominant', () => {
    expect(rule('.bands')).toMatch(/container-type:\s*inline-size/)
    const clamp = /font-size:\s*clamp\(\s*(\d+)px\s*,\s*([\d.]+)cqi\s*,\s*(\d+)px\s*\)/.exec(rule('.band'))
    expect(clamp).not.toBeNull()
    const [, min, , max] = clamp ?? []
    // Readable on a small tile; not dominant on a full-screen video.
    expect(Number(min)).toBeGreaterThanOrEqual(8)
    expect(Number(max)).toBeLessThanOrEqual(20)
  })

  it('uses the participant skin tokens: --pc-bg text on a --pc-ink strip', () => {
    const band = rule('.band')
    expect(band).toMatch(/color:\s*var\(--pc-bg\b/)
    expect(band).toMatch(/color-mix\(in srgb,\s*var\(--pc-ink\b/)
  })

  it('is >= 4.5:1 over ANY media (computed: worst case is pure white underneath)', () => {
    const band = rule('.band')
    const mix = /color-mix\(in srgb,\s*var\(--pc-ink,\s*(#[0-9a-f]{3,6})\)\s*(\d+)%/i.exec(band)
    expect(mix).not.toBeNull()
    const [, fallbackInk = '', percent = '0'] = mix ?? []
    // The fallback mirrors the token's real value.
    expect(longHex(fallbackInk).toLowerCase()).toBe(longHex(LIGHT_PALETTE.ink).toLowerCase())
    const alpha = Number(percent) / 100
    const text = longHex(LIGHT_PALETTE.bg)

    for (const underneath of ['#ffffff', '#808080', '#000000', '#ffdd00']) {
      const strip = composite(longHex(LIGHT_PALETTE.ink), alpha, underneath)
      expect(contrastRatio(text, strip)).toBeGreaterThanOrEqual(4.5)
    }

    // The pre-color-mix fallback strip is at least as opaque, so it passes too.
    const rgbFallback = /background:\s*rgb\(\s*14 21 24\s*\/\s*(\d+)%\s*\)/.exec(band)
    expect(Number(rgbFallback?.[1])).toBeGreaterThanOrEqual(Number(percent))
  })
})

// -----------------------------------------------------------------------------
// Stacking in every host (Gate-1 L-3 / M-2), read off disk
// -----------------------------------------------------------------------------

function sheet(path: string): string {
  return readSrcFile(path).replace(/\/\*[\s\S]*?\*\//g, '')
}

function ruleIn(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  const body = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1]
  if (body === undefined) throw new Error(`rule ${selector} not found`)
  return body
}

function zIndex(body: string): number {
  const match = /z-index:\s*(\d+)/.exec(body)
  if (match?.[1] === undefined) throw new Error('no z-index')
  return Number(match[1])
}

describe('ExerciseBands — stacking in every host', () => {
  const bandsZ = zIndex(rule('.bands'))

  it.each([
    ['features/social/components/media/VideoPlayer.module.css', '.topBar'],
    ['features/social/components/media/VideoPlayer.module.css', '.playToggle'],
    ['features/social/components/media/MediaTabGrid.module.css', '.playBadge'],
    ['features/social/components/media/MediaTabGrid.module.css', '.tileButton:focus-visible::after'],
    ['features/social/components/media/MediaGrid.module.css', '.tile:focus-visible::after'],
    ['features/social/components/ComposerMedia.module.css', '.videoBadge'],
  ])('%s %s paints ABOVE the bands', (path, selector) => {
    expect(zIndex(ruleIn(sheet(path), selector))).toBeGreaterThan(bandsZ)
  })

  it.each([
    ['features/social/components/media/MediaGrid.module.css', '.cell'],
    ['features/social/components/media/MediaTabGrid.module.css', '.tile'],
    ['features/social/components/ComposerMedia.module.css', '.thumb'],
    ['features/social/components/post/PostLinkCard.module.css', '.linkCardPhotoFrame'],
    ['features/social/pages/Profile.module.css', '.banner'],
  ])('%s %s isolates its stacking (z-indexes never escape over the sticky header)', (path, selector) => {
    expect(ruleIn(sheet(path), selector)).toMatch(/isolation:\s*isolate/)
  })

  it('centres the composer "Video" badge between the bands (never over the bottom band; L-2)', () => {
    const badge = ruleIn(sheet('features/social/components/ComposerMedia.module.css'), '.videoBadge')
    expect(badge).toMatch(/top:\s*50%/)
    expect(badge).not.toMatch(/bottom:/)
  })
})

describe('Two worlds: no COBRA / MUI on any file that draws the bands', () => {
  it.each([
    'features/social/components/media/ExerciseBands.tsx',
    'features/social/components/media/MediaGrid.tsx',
    'features/social/components/media/MediaTabGrid.tsx',
    'features/social/components/media/MediaViewer.tsx',
    'features/social/components/media/VideoPlayer.tsx',
    'features/social/components/ComposerMedia.tsx',
    'features/social/components/post/PostLinkCard.tsx',
    'features/social/pages/Profile.tsx',
  ])('%s imports neither @/theme (COBRA) nor @mui', path => {
    const source = readSrcFile(path)
    expect(source).not.toMatch(/from\s+['"]@\/theme/)
    expect(source).not.toMatch(/styledComponents/)
    expect(source).not.toMatch(/from\s+['"]@mui\//)
  })
})
