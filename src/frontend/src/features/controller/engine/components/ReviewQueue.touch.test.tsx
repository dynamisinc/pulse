/**
 * features/controller/engine/components/ReviewQueue.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the review queue on a tablet. Every key has a visible, labelled button, and
 * each action control is >= 44x44 inside `@media (pointer: coarse)` (min-width / min-height on the
 * control, real layout space, no ::before / ::after hit-slop), >= 8px from its neighbour.
 * No action needs hover, right-click or a key: tapping a card focuses it and reveals Approve /
 * Veto / Edit / Re-roll; "Batch approve" is the B key's button; the select toggle is Space's.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../services/reviewStore'
import { ReviewQueue } from './ReviewQueue'
import { hasPseudoHitSlop, mediaRuleDeclarations } from '@/features/staffShell/tabletTestUtils'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  resetTelemetryBuffer()
})
afterEach(() => resetExerciseClock())

async function renderQueue() {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ReviewQueue editSlot={() => <div>edit</div>} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  await screen.findByText('Fulton County EM', undefined, { timeout: 5000 })
}

function expect44(el: HTMLElement) {
  const coarse = mediaRuleDeclarations(el, 'pointer: coarse')
  expect(coarse['min-width']).toBe('44px')
  expect(coarse['min-height']).toBe('44px')
  expect(hasPseudoHitSlop(el)).toBe(false)
}

describe('ReviewQueue — touch parity (story 14)', () => {
  it('Batch approve (the B key) is a labelled 44px button', async () => {
    await renderQueue()
    const batch = screen.getByTestId('batch-approve')
    expect(batch).toHaveTextContent(/batch approve/i)
    expect44(batch)
  })

  it('a tap on a card reveals labelled Approve / Veto / Edit / Re-roll, each 44px and 8px apart', async () => {
    await renderQueue()
    const card = document.querySelector('[data-draft-id="draft-fulco-reassure"]') as HTMLElement
    fireEvent.click(card) // a tap: no key, no hover

    const actions = within(card).getByTestId('card-actions')
    const buttons = within(actions).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label')?.split(' (')[0])).toEqual([
      'Approve', 'Veto', 'Edit', 'Re-roll',
    ])
    buttons.forEach(b => expect44(b))
    expect(mediaRuleDeclarations(actions, 'pointer: coarse').gap).toBe('8px')
  })

  it('the Space key has a 44px select toggle on each card', async () => {
    await renderQueue()
    const toggles = screen.getAllByTestId('select-toggle')
    expect(toggles.length).toBeGreaterThan(0)
    toggles.forEach(t => expect44(t))
  })
})
