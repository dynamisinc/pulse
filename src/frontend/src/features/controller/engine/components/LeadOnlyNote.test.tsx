import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LeadOnlyNote } from './LeadOnlyNote'

const REASON = 'Only the lead controller can enable swamped mode.'

describe('LeadOnlyNote (#787: compact, so the 1180px command band stays one row)', () => {
  it('shows the short label, and gives the full reason as the tooltip', () => {
    render(<LeadOnlyNote testId="note" label="Swamped: lead only" reason={REASON} />)
    const note = screen.getByTestId('note')
    expect(note).toHaveTextContent('Swamped: lead only')
    expect(note).toHaveAttribute('title', REASON)
  })

  it('describes a control by the full reason only (the short label and the icon are not read)', () => {
    render(
      <>
        <button type="button" aria-describedby="why">Raise</button>
        <LeadOnlyNote id="why" testId="note" label="Raise: lead only" reason={REASON} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Raise' })).toHaveAccessibleDescription(REASON)
  })

  it('can take focus when asked, so a caller can move focus to it', () => {
    const ref = createRef<HTMLDivElement>()
    render(<LeadOnlyNote ref={ref} focusable testId="note" label="Swamped: lead only" reason={REASON} />)
    ref.current?.focus()
    expect(screen.getByTestId('note')).toHaveFocus()
  })
})
