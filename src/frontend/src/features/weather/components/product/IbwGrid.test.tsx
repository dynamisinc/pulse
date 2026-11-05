/**
 * IbwGrid (weather-source 07, #758): WHAT / WHERE / WHEN / IMPACTS as a semantic `<dl>`, in
 * NWS order; stacks label-over-value on narrow screens; renders nothing without `ibw`.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { WEATHER_UPGRADE_FIXTURE, WEATHER_WATCH_FIXTURE } from '@/features/weather/contract'
import type { WeatherIbw } from '@/features/weather/contract'
import { IbwGrid } from './IbwGrid'

const IBW = WEATHER_UPGRADE_FIXTURE.payload.ibw as WeatherIbw

describe('IbwGrid', () => {
  it('renders a definition list with the four rows in NWS order', () => {
    render(<IbwGrid ibw={IBW} />)
    const list = screen.getByTestId('weather-ibw-grid')
    expect(list.tagName).toBe('DL')
    expect([...list.querySelectorAll('dt')].map(dt => dt.textContent))
      .toEqual(['WHAT', 'WHERE', 'WHEN', 'IMPACTS'])
    expect([...list.querySelectorAll('dd')].map(dd => dd.textContent))
      .toEqual([IBW.what, IBW.where, IBW.when, IBW.impacts])
  })

  it('pairs each term with its value (dt then dd inside one group)', () => {
    render(<IbwGrid ibw={IBW} />)
    const term = screen.getByText('WHERE')
    expect(term.tagName).toBe('DT')
    expect(term.nextElementSibling?.tagName).toBe('DD')
    expect(term.nextElementSibling).toHaveTextContent(IBW.where)
  })

  it.each([
    ['null (a watch without IBW)', WEATHER_WATCH_FIXTURE.payload.ibw],
    ['undefined', undefined],
  ])('renders nothing for %s, never empty rows', (_label, ibw) => {
    const { container } = render(<IbwGrid ibw={ibw} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the row of a blank field, and renders nothing when every field is blank', () => {
    const { rerender, container } = render(<IbwGrid ibw={{ ...IBW, when: '  ' }} />)
    expect([...container.querySelectorAll('dt')].map(dt => dt.textContent))
      .toEqual(['WHAT', 'WHERE', 'IMPACTS'])
    rerender(<IbwGrid ibw={{ what: '', where: '', when: '', impacts: '' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps authored line breaks in a value', () => {
    render(<IbwGrid ibw={{ ...IBW, impacts: 'Line one.\nLine two.' }} />)
    expect(screen.getByText(/Line one\./).textContent).toBe('Line one.\nLine two.')
  })
})

describe('IbwGrid: narrow viewports', () => {
  const css = readSrcFile('features/weather/components/product/IbwGrid.module.css')

  it('stacks label over value by default (mobile-first) and only goes two-column from 600px', () => {
    const base = css.split('@media')[0] ?? ''
    expect(base).not.toMatch(/grid-template-columns/)
    expect(css).toMatch(
      /@media \(min-width: 600px\)\s*\{[^@]*grid-template-columns:\s*max-content minmax\(0, 1fr\)/,
    )
  })

  it('never forces horizontal scroll: no fixed widths, values wrap', () => {
    expect(css).not.toMatch(/(^|[^-])width:\s*\d+px/m)
    expect(css).not.toMatch(/white-space:\s*nowrap/)
    expect(css).toMatch(/\.value\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
