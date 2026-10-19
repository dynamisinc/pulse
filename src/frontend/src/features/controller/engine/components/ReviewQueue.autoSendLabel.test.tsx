/**
 * features/controller/engine/components/ReviewQueue.autoSendLabel.test.tsx
 * ---------------------------------------------------------------------------
 * The visible review card's countdown reads "sends in M:SS" when the card will auto-send
 * (`useCardAutoSend` true) and "holds in M:SS" otherwise (text, never colour-only).
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../services/reviewStore'
import { ReviewQueue } from './ReviewQueue'

const auto = vi.hoisted(() => ({ value: false }))
vi.mock('../hooks/useCardAutoSend', () => ({ useCardAutoSend: () => auto.value }))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
})

afterEach(() => resetExerciseClock())

async function counting(): Promise<string[]> {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ReviewQueue />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  await screen.findByTestId('review-queue')
  return screen
    .getAllByTestId('countdown-state')
    .filter(el => el.getAttribute('data-countdown-kind') === 'holds')
    .map(el => el.textContent ?? '')
}

describe('ReviewQueue — countdown verb', () => {
  it('says "sends in" when the card will auto-send', async () => {
    auto.value = true
    const labels = await counting()
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label).toMatch(/^sends in \d+:\d\d$/)
  })

  it('says "holds in" otherwise', async () => {
    auto.value = false
    const labels = await counting()
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label).toMatch(/^holds in \d+:\d\d$/)
  })
})
