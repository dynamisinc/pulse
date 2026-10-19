/**
 * features/participantAdmin/cards/CardSheet.test.tsx
 * ---------------------------------------------------------------------------
 * The sheet: eight cards a page, and a structural guarantee that the printed subtree is
 * only cards (nothing interactive, no toolbar, no warning).
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardSheet } from './CardSheet'
import { buildMockCards } from './cardsMocks'

describe('CardSheet - null exercise name', () => {
  it('renders the cards brand-only (no name line) when exerciseName is null', () => {
    render(<CardSheet cards={buildMockCards(3)} exerciseName={null} />)
    expect(screen.getAllByTestId('roster-card')).toHaveLength(3)
    expect(document.querySelector('p[class*="exercise"]')).toBeNull()
  })
})

describe('CardSheet - pagination', () => {
  it('puts eight cards on a page and the rest on the next', () => {
    render(<CardSheet cards={buildMockCards(20)} exerciseName="Coastal Surge" />)
    const pages = screen.getAllByTestId('card-sheet-page')
    expect(pages.map(page => within(page).getAllByTestId('roster-card').length)).toEqual([8, 8, 4])
  })

  it('keeps the cards in the order given', () => {
    const cards = buildMockCards(10)
    render(<CardSheet cards={cards} exerciseName="X" />)
    const names = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(names).toEqual(cards.map(card => card.name))
  })

  it('renders exactly one page for eight cards and none for zero', () => {
    const { unmount } = render(<CardSheet cards={buildMockCards(8)} exerciseName="X" />)
    expect(screen.getAllByTestId('card-sheet-page')).toHaveLength(1)
    unmount()
    render(<CardSheet cards={[]} exerciseName="X" />)
    expect(screen.queryAllByTestId('card-sheet-page')).toHaveLength(0)
  })

  it('prints the exercise name on every card', () => {
    render(<CardSheet cards={buildMockCards(9)} exerciseName="Coastal Surge" />)
    const cards = screen.getAllByTestId('roster-card')
    expect(cards.every(card => within(card).queryByText('Coastal Surge') !== null)).toBe(true)
  })

  it('renders 104 cards (100+ data-URI images) in one pass with an img per card', () => {
    const { container } = render(<CardSheet cards={buildMockCards(104)} exerciseName="X" />)
    expect(container.querySelectorAll('article')).toHaveLength(104)
    expect(container.querySelectorAll('img')).toHaveLength(104)
    expect(container.querySelectorAll('[data-testid="card-sheet-page"]')).toHaveLength(13)
  })

  it('labels the group with the card count', () => {
    render(<CardSheet cards={buildMockCards(1)} exerciseName="X" />)
    expect(screen.getByRole('group', { name: '1 printable card' })).toBeInTheDocument()
    expect(screen.getByTestId('card-sheet')).toBeInTheDocument()
  })
})

describe('CardSheet - the printed subtree contains only cards', () => {
  it('is pages of <article> cards and nothing else', () => {
    render(<CardSheet cards={buildMockCards(11)} exerciseName="X" />)
    const sheet = screen.getByTestId('card-sheet')
    const pages = Array.from(sheet.children)
    expect(pages.length).toBe(2)
    for (const page of pages) {
      expect(page.getAttribute('data-testid')).toBe('card-sheet-page')
      for (const child of Array.from(page.children)) {
        expect(child.tagName).toBe('ARTICLE')
        expect(child.getAttribute('data-testid')).toBe('roster-card')
      }
    }
    expect(sheet.querySelectorAll('article')).toHaveLength(11)
  })

  it('has no control, link, form field, alert or status region inside it', () => {
    render(<CardSheet cards={buildMockCards(11)} exerciseName="X" />)
    const sheet = screen.getByTestId('card-sheet')
    expect(sheet.querySelectorAll('button, a, input, select, textarea, form, dialog')).toHaveLength(0)
    expect(sheet.querySelectorAll('[role="alert"], [role="status"], [role="dialog"]')).toHaveLength(0)
    expect(sheet.querySelectorAll('[tabindex]')).toHaveLength(0)
  })

  it('shows no warning banner text (that is on-screen chrome, not paper)', () => {
    render(<CardSheet cards={buildMockCards(3)} exerciseName="X" />)
    expect(screen.queryByText(/shred any left over/i)).not.toBeInTheDocument()
  })
})
