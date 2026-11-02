/**
 * SeverityChip (weather-source 07, #758): icon + WORD + hue, never colour-only (NFR-001),
 * white text on every default hue at >= 4.5:1, hue overridable by the skin's `ext.weather` key.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { contrastRatio, hexToRgb } from '@/test/contrast'
import { SkinScope, registerSkinExtension } from '@/features/channels/skin'
import { resetSkinRegistryForTests } from '@/features/channels/skin/registry'
import { NEUTRAL_SKIN_TOKENS } from '@/features/channels/skin/tokens/neutral'
import { WEATHER_PRODUCT_TYPES } from '@/features/weather/contract'
import { SeverityChip } from './SeverityChip'
import {
  WEATHER_SEVERITY,
  WEATHER_SEVERITY_ON_COLOR,
  resolveSeverityHue,
  severityFillStyle,
} from './severity'

const EXPECTED = {
  watch: { word: 'WATCH', hue: '#2e6b4f', icon: 'eye' },
  warning: { word: 'WARNING', hue: '#8b0000', icon: 'triangle-exclamation' },
  advisory: { word: 'ADVISORY', hue: '#8a4b00', icon: 'circle-info' },
} as const

/** jsdom normalizes a hex inline colour to `rgb(r, g, b)`. */
function rgb(hex: string): string {
  return `rgb(${hexToRgb(hex).join(', ')})`
}

afterEach(() => {
  resetSkinRegistryForTests()
})

describe('SeverityChip', () => {
  it.each(WEATHER_PRODUCT_TYPES)('%s renders its icon, its word and its hue', productType => {
    render(<SeverityChip productType={productType} />)
    const chip = screen.getByTestId('weather-severity-chip')
    expect(chip).toHaveTextContent(EXPECTED[productType].word)
    const icon = chip.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('data-icon', EXPECTED[productType].icon)
    expect(chip.style.backgroundColor).toBe(rgb(EXPECTED[productType].hue))
    expect(chip.style.color).toBe(rgb('#ffffff'))
  })

  it.each(WEATHER_PRODUCT_TYPES)('%s: white text on the default hue is >= 4.5:1', productType => {
    const ratio = contrastRatio(WEATHER_SEVERITY_ON_COLOR, WEATHER_SEVERITY[productType].defaultHue)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('a light override hue gets black text, so an override cannot break AA', () => {
    const hue = resolveSeverityHue('advisory', { advisory: '#ffd966' })
    expect(hue).toBe('#ffd966')
    expect(severityFillStyle(hue)).toEqual({ backgroundColor: '#ffd966', color: '#000000' })
    expect(contrastRatio('#000000', hue)).toBeGreaterThanOrEqual(4.5)
  })

  it('ignores a missing or non-hex override (default hue, white text)', () => {
    expect(resolveSeverityHue('watch', undefined)).toBe('#2e6b4f')
    expect(resolveSeverityHue('watch', { watch: 'red' })).toBe('#2e6b4f')
    expect(severityFillStyle('#2e6b4f').color).toBe('#ffffff')
  })

  it('inside a skin scope with an ext.weather override, fill and text both follow it', () => {
    registerSkinExtension('weather', { keys: { advisory: { type: 'color', large: true } } })
    // A dark skin, so the light advisory hue passes the scope's AA check against bg.
    const tokens = {
      ...NEUTRAL_SKIN_TOKENS,
      palette: {
        ...NEUTRAL_SKIN_TOKENS.palette,
        bg: '#111418',
        surface: '#1f2329',
        text: '#ffffff',
        link: '#9cc7ff',
        accent: '#ffd966',
        breaking: '#ff8a80',
      },
      ext: { weather: { advisory: '#ffd966' } },
    }
    render(
      <SkinScope scopeId="wx" tokens={tokens}>
        <SeverityChip productType="advisory" />
        <SeverityChip productType="warning" />
      </SkinScope>,
    )
    const [advisory, warning] = screen.getAllByTestId('weather-severity-chip')
    expect(advisory?.style.backgroundColor).toBe(rgb('#ffd966'))
    expect(advisory?.style.color).toBe(rgb('#000000'))
    // A key the skin does not set stays on its default.
    expect(warning?.style.backgroundColor).toBe(rgb('#8b0000'))
    expect(warning?.style.color).toBe(rgb('#ffffff'))
  })

  it('every type has a distinct word and a distinct icon (they carry the meaning, not the hue)', () => {
    const words = WEATHER_PRODUCT_TYPES.map(t => WEATHER_SEVERITY[t].label)
    const icons = WEATHER_PRODUCT_TYPES.map(t => WEATHER_SEVERITY[t].icon.iconName)
    expect(new Set(words).size).toBe(WEATHER_PRODUCT_TYPES.length)
    expect(new Set(icons).size).toBe(WEATHER_PRODUCT_TYPES.length)
  })
})

describe('SeverityChip: never colour-only (forced colours / greyscale)', () => {
  // jsdom paints nothing, so "with the colour removed" is checked structurally: the meaning
  // must survive in the DOM text and the icon, and the stylesheet must keep a shape under
  // forced colours (below). A real-browser forced-colors pass is story 14's conformance kit.
  it.each(WEATHER_PRODUCT_TYPES)('%s carries its meaning in a text node, independent of colour', productType => {
    render(<SeverityChip productType={productType} />)
    const chip = screen.getByTestId('weather-severity-chip')
    const word = within(chip).getByText(EXPECTED[productType].word)
    expect(word.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(word.textContent).toBe(EXPECTED[productType].word)
    // Strip every colour: the accessible text alone still names the type.
    chip.style.backgroundColor = ''
    chip.style.color = ''
    expect(chip.textContent).toBe(EXPECTED[productType].word)
  })

  it('the stylesheet keeps an outline under forced colours and never transforms the word', () => {
    const css = readSrcFile('features/weather/components/product/SeverityChip.module.css')
    expect(css)
      .toMatch(/@media \(forced-colors: active\)\s*\{[^}]*\.chip\s*\{[^}]*border:[^}]*CanvasText/)
    expect(css).not.toMatch(/text-transform:\s*(uppercase|capitalize|lowercase)/)
  })
})
