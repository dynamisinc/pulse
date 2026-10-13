/**
 * features/participantAdmin/cards/PrintCardsButton.test.tsx
 * ---------------------------------------------------------------------------
 * The roster's entry point: the label for a selection vs "all", opening the preview,
 * the request it makes (ids in chunks of at most 500; none when empty), the selection
 * snapshot, and focus returning to the button.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrintCardsButton } from './PrintCardsButton'
import { PrintCardsButton as FromBarrel } from './index'
import { buildMockCards, resetMockCards } from './cardsMocks'
import { renderWithProviders, spyOnCardsEndpoint } from './cardsTestUtils'

function idList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p-${String(i).padStart(5, '0')}`)
}

/** A server that answers every card request with one card per id (three for "all"). */
function serverFor() {
  return spyOnCardsEndpoint(({ ids }) => ({
    exerciseName: 'Coastal Surge',
    cards: buildMockCards(ids.length === 0 ? 3 : ids.length, ids),
    skipped: [],
  }))
}

// These specs mount the MUI/Emotion stack and a sheet of data-URI-image cards in jsdom, and a
// full parallel run is often CPU-starved (see the note in `src/test/setup.ts`). A longer
// per-test budget stops a slow worker failing a correct test.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {})
})

afterEach(() => {
  resetMockCards()
  vi.restoreAllMocks()
})

describe('PrintCardsButton - label', () => {
  it('is exported from the folder barrel as the same component', () => {
    expect(FromBarrel).toBe(PrintCardsButton)
  })

  it('reads "Print all cards" when nothing is selected', async () => {
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    expect(screen.getByRole('button', { name: 'Print all cards' })).toBeInTheDocument()
  })

  it.each([[1], [3], [42]])('reads "Print cards (%i)" for %i selected', async count => {
    await renderWithProviders(<PrintCardsButton selection={idList(count)} />)
    expect(screen.getByRole('button', { name: `Print cards (${count})` })).toBeInTheDocument()
  })

  it('counts a repeated id once', async () => {
    await renderWithProviders(<PrintCardsButton selection={['a', 'b', 'a']} />)
    expect(screen.getByRole('button', { name: 'Print cards (2)' })).toBeInTheDocument()
  })

  it('announces that it opens a dialog and has an icon (text carries the meaning)', async () => {
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('opens nothing and requests nothing until it is pressed', async () => {
    const { calls } = serverFor()
    await renderWithProviders(<PrintCardsButton selection={['a']} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

describe('PrintCardsButton - opening and the request', () => {
  it('opens the preview and requests exactly the selected ids', async () => {
    const user = userEvent.setup()
    const { calls } = serverFor()
    await renderWithProviders(<PrintCardsButton selection={['a', 'b', 'c']} />)

    await user.click(screen.getByRole('button', { name: 'Print cards (3)' }))

    expect(await screen.findByRole('dialog', { name: 'Print cards' })).toBeInTheDocument()
    expect(await screen.findByTestId('card-sheet')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.ids).toEqual(['a', 'b', 'c'])
  })

  it('sends no id at all for an empty selection', async () => {
    const user = userEvent.setup()
    const { calls } = serverFor()
    await renderWithProviders(<PrintCardsButton selection={[]} />)

    await user.click(screen.getByRole('button', { name: 'Print all cards' }))
    await screen.findByTestId('card-sheet')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ ids: [], hasParams: false })
  })

  it('chunks a large selection at 500 and concatenates the cards', async () => {
    const user = userEvent.setup()
    // One card back per request keeps the render light; the point is the requests.
    const { calls } = spyOnCardsEndpoint(({ ids: chunk }) => ({
      exerciseName: 'Coastal Surge',
      cards: buildMockCards(1, chunk.slice(0, 1)),
      skipped: [],
    }))
    const ids = idList(1201)
    await renderWithProviders(<PrintCardsButton selection={ids} />)

    await user.click(screen.getByRole('button', { name: 'Print cards (1201)' }))
    await screen.findByTestId('card-sheet')

    expect(calls.map(call => call.ids.length)).toEqual([500, 500, 201])
    expect(calls.flatMap(call => call.ids)).toEqual(ids)
    // The three responses are concatenated into one sheet.
    expect(screen.getAllByTestId('roster-card')).toHaveLength(3)
  })

  it('prints the people selected when it was pressed, not a later selection', async () => {
    const user = userEvent.setup()
    const { calls } = serverFor()
    const { rerender } = await renderWithProviders(<PrintCardsButton selection={['a']} />)
    await user.click(screen.getByRole('button', { name: 'Print cards (1)' }))
    await screen.findByTestId('card-sheet')

    rerender(<PrintCardsButton selection={['a', 'b', 'c']} />)

    expect(calls).toHaveLength(1)
    expect(screen.getAllByTestId('roster-card')).toHaveLength(1)
  })

  it('fetches afresh each time it is opened (nothing is kept between openings)', async () => {
    const user = userEvent.setup()
    const { calls } = serverFor()
    await renderWithProviders(<PrintCardsButton selection={['a']} />)

    await user.click(screen.getByRole('button', { name: 'Print cards (1)' }))
    await screen.findByTestId('card-sheet')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Print cards (1)' }))
    await screen.findByTestId('card-sheet')
    expect(calls).toHaveLength(2)
  })
})

describe('PrintCardsButton - closing', () => {
  it('Close removes the preview and returns focus to the button', async () => {
    const user = userEvent.setup()
    serverFor()
    await renderWithProviders(<PrintCardsButton selection={['a']} />)
    const trigger = screen.getByRole('button', { name: 'Print cards (1)' })

    await user.click(trigger)
    await screen.findByTestId('card-sheet')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Escape removes the preview and returns focus to the button', async () => {
    const user = userEvent.setup()
    serverFor()
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    const trigger = screen.getByRole('button', { name: 'Print all cards' })

    await user.click(trigger)
    await screen.findByTestId('card-sheet')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens from the keyboard (Enter) as well as the mouse', async () => {
    const user = userEvent.setup()
    serverFor()
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    screen.getByRole('button', { name: 'Print all cards' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
