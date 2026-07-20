/**
 * features/controller/engine/components/ReviewQueue.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the review-queue surface's ACs (engine-review-cockpit/01; ADP-040,
 * D5 §6, NFR-001):
 *  - a card shows its persona + storyline context (tag + brief) + action label +
 *    preview + a text countdown state; the focused card exposes approve/edit/
 *    veto/re-roll;
 *  - keyboard approve (A) publishes the focused burst (disposition → published,
 *    post pushed to the live feed);
 *  - batch approve reports a per-item outcome;
 *  - the E action opens the caller-supplied edit composer slot, whose submit
 *    routes the new text back through the queue.
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the shared
 * axios dev mock adapter, which also serves `usePersonas`) under the root COBRA
 * theme, with a fixed exercise clock for deterministic countdowns.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { listPosts } from '@/features/social'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../services/reviewStore'
import { ReviewQueue, type ReviewQueueEditSlotProps } from './ReviewQueue'

beforeEach(() => {
  // 30s into the minute so the 1-minute burst reads a genuine sub-60s timer.
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

async function renderQueue(node: ReactNode) {
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>{node}</ExerciseContextProvider>
    </ThemeProvider>,
  )
  // Wait for the seeded personas to resolve so identity renders.
  await screen.findByText('Fulton County EM')
  return utils
}

function cardById(draftId: string): HTMLElement {
  const card = document.querySelector(`[data-draft-id="${draftId}"]`)
  if (!card) throw new Error(`card ${draftId} not found`)
  return card as HTMLElement
}

describe('ReviewQueue — card context + actions', () => {
  it('shows persona, storyline context, preview, and a text countdown; focus reveals A/V/E/R', async () => {
    await renderQueue(<ReviewQueue editSlot={renderTestEditSlot} />)

    const card = cardById('draft-fulco-reassure')
    expect(within(card).getByTestId('action-label')).toHaveTextContent('reply → @mvega_fh')
    expect(within(card).getByTestId('storyline-tag')).toHaveTextContent('#WaterIssues')
    expect(within(card).getByTestId('preview-text')).toHaveTextContent('boil-water advisory')
    expect(within(card).getByTestId('countdown-state')).toHaveTextContent('holds in 2:30')

    // Focus the card → the four actions appear.
    fireEvent.click(card)
    expect(within(card).getByLabelText('Approve (A)')).toBeInTheDocument()
    expect(within(card).getByLabelText('Veto (V)')).toBeInTheDocument()
    expect(within(card).getByLabelText('Edit (E)')).toBeInTheDocument()
    expect(within(card).getByLabelText('Re-roll (R)')).toBeInTheDocument()
  })

  it('surfaces the single-source counts, including a sub-60s timer and a held item', async () => {
    await renderQueue(<ReviewQueue />)
    expect(screen.getByTestId('pending-count')).toHaveTextContent('2 need review')
    expect(screen.getByTestId('timers-under-60s')).toHaveTextContent('1 timer under 60s')
    expect(screen.getByTestId('held-count')).toHaveTextContent('1 held')
  })

  it('marks the held item with a text label + priority border (never colour-only)', async () => {
    await renderQueue(<ReviewQueue />)
    const held = cardById('draft-mvega-anxious')
    expect(held).toHaveAttribute('data-priority', 'true')
    expect(within(held).getByTestId('countdown-state')).toHaveTextContent('timer expired — held for you')
  })

  it('the header pendingCount/heldCount equal the number of rendered queued/held cards (D5-014/2.1)', async () => {
    await renderQueue(<ReviewQueue />)
    const cards = screen.getAllByTestId('review-card')
    const pendingCards = cards.filter(card =>
      ['queued', 'held'].includes(card.getAttribute('data-disposition') ?? ''),
    )
    const heldCards = cards.filter(card => card.getAttribute('data-disposition') === 'held')

    expect(pendingCards.length).toBeGreaterThan(0)
    expect(screen.getByTestId('pending-count')).toHaveTextContent(`${pendingCards.length} need review`)
    expect(screen.getByTestId('held-count')).toHaveTextContent(`${heldCards.length} held`)
  })
})

describe('ReviewQueue — keyboard actions', () => {
  it('approves the focused burst with A, publishing it to the live feed', async () => {
    await renderQueue(<ReviewQueue />)
    const queue = screen.getByTestId('review-queue')
    const baseline = listPosts().length

    // focusIndex defaults to the first card (draft-fulco-reassure).
    fireEvent.keyDown(queue, { key: 'a' })

    await waitFor(() => {
      expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'published')
    })
    expect(postStore.getPosts().length).toBe(baseline + 1)
    expect(screen.getByTestId('review-queue-status')).toHaveTextContent('Approved')
  })

  it('vetoes the focused burst with V without publishing', async () => {
    await renderQueue(<ReviewQueue />)
    const queue = screen.getByTestId('review-queue')
    const baseline = listPosts().length

    fireEvent.keyDown(queue, { key: 'v' })

    await waitFor(() => {
      expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'vetoed')
    })
    expect(postStore.getPosts().length).toBe(baseline)
  })

  it('re-rolls the focused burst with R: a fresh draft, still unpublished', async () => {
    await renderQueue(<ReviewQueue />)
    const queue = screen.getByTestId('review-queue')
    const baseline = listPosts().length
    const before = within(cardById('draft-fulco-reassure')).getByTestId('preview-text').textContent

    fireEvent.keyDown(queue, { key: 'r' })

    await waitFor(() => {
      const after = within(cardById('draft-fulco-reassure')).getByTestId('preview-text').textContent
      expect(after).not.toBe(before)
    })
    expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'counting-down')
    expect(postStore.getPosts().length).toBe(baseline)
    expect(screen.getByTestId('review-queue-status')).toHaveTextContent('Re-rolled')
  })

  it('↑ / ↓ move focus between cards (roving tabindex, NFR-001)', async () => {
    await renderQueue(<ReviewQueue />)
    const queue = screen.getByTestId('review-queue')

    // ArrowDown from the default (first-card) focus moves DOM focus onto the
    // next card — the roving-tabindex grid, not just a visual highlight.
    fireEvent.keyDown(queue, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(document.activeElement).toBe(cardById('draft-newsline7-followup'))
    })
    expect(cardById('draft-newsline7-followup')).toHaveAttribute('tabindex', '0')
    expect(cardById('draft-fulco-reassure')).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(queue, { key: 'ArrowUp' })
    await waitFor(() => {
      expect(document.activeElement).toBe(cardById('draft-fulco-reassure'))
    })
    expect(cardById('draft-fulco-reassure')).toHaveAttribute('tabindex', '0')
  })
})

describe('ReviewQueue — batch approve', () => {
  it('reports the per-item outcome via the status region', async () => {
    await renderQueue(<ReviewQueue />)
    fireEvent.click(screen.getByTestId('batch-approve'))

    await waitFor(() => {
      expect(screen.getByTestId('review-queue-status')).toHaveTextContent('Batch approved 4 drafts')
    })
  })
})

describe('ReviewQueue — edit slot', () => {
  it('opens the composer slot on E and routes the edited text back through the queue', async () => {
    await renderQueue(<ReviewQueue editSlot={renderTestEditSlot} />)
    const card = cardById('draft-fulco-reassure')
    fireEvent.click(card)
    fireEvent.click(within(card).getByLabelText('Edit (E)'))

    const slot = await screen.findByTestId('review-queue-edit-slot')
    const textarea = within(slot).getByTestId('edit-textarea')
    fireEvent.change(textarea, { target: { value: 'Edited advisory text.' } })
    fireEvent.click(within(slot).getByText('Publish edit'))

    await waitFor(() => {
      expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'published')
    })
    expect(postStore.getPosts().some(p => p.text === 'Edited advisory text.')).toBe(true)
    expect(screen.getByTestId('review-queue-status')).toHaveTextContent('Edited')
  })
})

/** A minimal stand-in for the real persona composer wired at integration. */
function renderTestEditSlot({ initialText, onSubmit }: ReviewQueueEditSlotProps): ReactNode {
  let value = initialText
  return (
    <div>
      <textarea
        data-testid="edit-textarea"
        defaultValue={initialText}
        onChange={e => { value = e.target.value }}
      />
      <button type="button" onClick={() => onSubmit(value)}>Publish edit</button>
    </div>
  )
}
