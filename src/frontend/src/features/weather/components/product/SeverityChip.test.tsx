/**
 * SeverityChip (weather-source 07, #758): icon + WORD + hue, never colour-only (NFR-001),
 * white text on every default hue at >= 4.5:1, hue overridable by the skin's `ext.weather` key.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { contrastRatio } from '@/test/contrast'
import { WEATHER_PRODUCT_TYPES } from '@/features/weather/contract'
import { SeverityChip } from './SeverityChip'
import { WEATHER_SEVERITY, WEATHER_SEVERITY_ON_COLOR, severityHue } from './severity'

const EXPECTED = {
  watch: { word: 'WATCH', hue: '#2e6b4f', icon: 'eye' },
  warning: { word: 'WARNING', hue: '#8b0000', icon: 'triangle-exclamation' },
  advisory: { word: 'ADVISORY', hue: '#8a4b00', icon: 'circle-info' },
} as const

afterEach(() => {
  vi.unstubAllGlobals()
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
    expect(chip.style.backgroundColor).toBe(
      `var(--pulse-skin-ext-weather-${productType}, ${EXPECTED[productType].hue})`,
    )
    expect(chip.style.color).toMatch(/^(#ffffff|rgb\(255, 255, 255\))$/)
  })

  it.each(WEATHER_PRODUCT_TYPES)('%s: white text on the default hue is >= 4.5:1', productType => {
    const ratio = contrastRatio(WEATHER_SEVERITY_ON_COLOR, WEATHER_SEVERITY[productType].defaultHue)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('the hue is read from the skin ext.weather key first, the default second', () => {
    expect(severityHue('warning')).toBe('var(--pulse-skin-ext-weather-warning, #8b0000)')
  })

  it('every type has a distinct word and a distinct icon (they carry the meaning, not the hue)', () => {
    const words = WEATHER_PRODUCT_TYPES.map(t => WEATHER_SEVERITY[t].label)
    const icons = WEATHER_PRODUCT_TYPES.map(t => WEATHER_SEVERITY[t].icon.iconName)
    expect(new Set(words).size).toBe(WEATHER_PRODUCT_TYPES.length)
    expect(new Set(icons).size).toBe(WEATHER_PRODUCT_TYPES.length)
  })
})

describe('SeverityChip: never colour-only (forced colours / greyscale)', () => {
  it.each(WEATHER_PRODUCT_TYPES)('%s keeps its text node under forced colours and greyscale', productType => {
    // Forced colours: the platform drops author colours, so only text + shape remain.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('forced-colors: active') || query.includes('prefers-contrast'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }))
    const { container } = render(
      <div style={{ filter: 'grayscale(1)', forcedColorAdjust: 'auto' }}>
        <SeverityChip productType={productType} />
      </div>,
    )
    const chip = within(container).getByTestId('weather-severity-chip')
    // A real text node with the word, independent of any colour.
    const word = within(chip).getByText(EXPECTED[productType].word)
    expect(word.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(word.textContent).toBe(EXPECTED[productType].word)
    expect(getComputedStyle(word).textTransform).not.toBe('uppercase')
  })

  it('the stylesheet keeps an outline under forced colours and never transforms the word', () => {
    const css = readSrcFile('features/weather/components/product/SeverityChip.module.css')
    expect(css)
      .toMatch(/@media \(forced-colors: active\)\s*\{[^}]*\.chip\s*\{[^}]*border:[^}]*CanvasText/)
    expect(css).not.toMatch(/text-transform:\s*(uppercase|capitalize|lowercase)/)
  })
})
