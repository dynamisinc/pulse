/**
 * ProductText (weather-source 07, #758; D4-009, D4-010): monospace NWS product text with the
 * furniture assembled from data, the headline exactly as stored, authored line breaks kept.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { WEATHER_UPGRADE_FIXTURE, WEATHER_WARNING_FIXTURE } from '@/features/weather/contract'
import { ProductText } from './ProductText'

describe('ProductText: NWS furniture', () => {
  it('assembles headline, narrative, actions, && and $$ in order, separated by blank lines', () => {
    render(<ProductText product={WEATHER_WARNING_FIXTURE} />)
    expect(screen.getByTestId('weather-product-text').textContent).toBe([
      '...Flash Flood Warning for Harbor Point until 6 PM...',
      'Heavy rain is falling over Harbor Point. Two to three inches have fallen in the last hour.',
      'PRECAUTIONARY/PREPAREDNESS ACTIONS...',
      'Turn around, do not drown.',
      'Move to higher ground now.',
      '&&',
      '$$',
    ].join('\n\n'))
  })

  it('omits the actions section when there are none, but still closes with && and $$', () => {
    const payload = { ...WEATHER_UPGRADE_FIXTURE.payload, actions: [] }
    const product = { ...WEATHER_UPGRADE_FIXTURE, payload }
    render(<ProductText product={product} />)
    const text = screen.getByTestId('weather-product-text').textContent ?? ''
    expect(text).not.toContain('PRECAUTIONARY')
    expect(text.endsWith('\n\n&&\n\n$$')).toBe(true)
  })
})

describe('ProductText: the headline is the stored string (D4-010)', () => {
  it.each([
    ['mixed case', 'Tornado Warning for northern Kestrel County until 3:15 PM'],
    ['punctuation and symbols', 'Flood Warning: "Canal St." & Lower Quay — until 6 PM'],
    ['200 characters', `${'Very long headline '.repeat(10)}`.slice(0, 200)],
  ])('%s renders verbatim', (_label, headline) => {
    render(<ProductText product={{ ...WEATHER_WARNING_FIXTURE, headline }} />)
    expect(screen.getByTestId('weather-product-headline').textContent).toBe(headline)
    expect(screen.getByTestId('weather-product-headline-line').textContent).toBe(`...${headline}...`)
  })

  it('the stylesheet never transforms or truncates', () => {
    const css = readSrcFile('features/weather/components/product/ProductText.module.css')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // Pinned to none (text-transform is inherited), never anything else.
    expect([...css.matchAll(/text-transform:\s*([^;]+);/g)].map(m => m[1])).toEqual(['none'])
    expect(css).toMatch(/font-variant-caps:\s*normal/)
    expect(css).not.toMatch(/text-overflow|line-clamp|-webkit-box/)
    expect(css).not.toMatch(/overflow:\s*hidden/)
    expect(css).not.toMatch(/max-height/)
  })
})

describe('ProductText: wrapping', () => {
  it('keeps authored line breaks in the narrative', () => {
    const bodyHtml = 'First paragraph.\n\nSecond paragraph,\nwith a manual break.'
    render(<ProductText product={{ ...WEATHER_WARNING_FIXTURE, bodyHtml }} />)
    expect(screen.getByTestId('weather-product-narrative').textContent).toBe(bodyHtml)
  })

  it('renders a long narrative in full (no length cap in this component)', () => {
    const bodyHtml = `${'Rain continues across the county. '.repeat(200)}END`
    render(<ProductText product={{ ...WEATHER_WARNING_FIXTURE, bodyHtml }} />)
    expect(screen.getByTestId('weather-product-narrative').textContent).toBe(bodyHtml.trim())
  })

  it('renders the narrative as text, never as HTML', () => {
    const bodyHtml = 'Water <b>rising</b> & roads closed'
    render(<ProductText product={{ ...WEATHER_WARNING_FIXTURE, bodyHtml }} />)
    const narrative = screen.getByTestId('weather-product-narrative')
    expect(narrative.querySelector('b')).toBeNull()
    expect(narrative.textContent).toBe(bodyHtml)
  })

  it('is monospace, pre-wrap, and wraps long unbroken runs', () => {
    const css = readSrcFile('features/weather/components/product/ProductText.module.css')
    expect(css).toMatch(/white-space:\s*pre-wrap/)
    expect(css).toMatch(/overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/font-family:[^;]*monospace;/)
  })
})
