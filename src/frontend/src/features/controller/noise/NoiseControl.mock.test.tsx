/**
 * features/controller/noise/NoiseControl.mock.test.tsx
 * ---------------------------------------------------------------------------
 * Story 09 AC5: the knob works end to end behind the console's existing mock switch
 * (`USE_MOCK_DATA`, on under Vitest) with the real exercise scope and pause state - the mock
 * adapter answers GET/PUT and the mock store pushes the new state - and the mock refuses an
 * unknown level like the server does.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { resetPauseStateForTest } from '../hooks/usePauseState'
import { NoiseControl } from './NoiseControl'
import { mockNoiseAdapter, resetNoiseMockForTest, subscribeMockNoiseState } from './noiseMock'

afterEach(() => {
  resetNoiseMockForTest()
  resetPauseStateForTest()
})

function radio(name: string) {
  const group = screen.getByRole('radiogroup', { name: 'White noise' })
  return within(group).getByRole('radio', { name })
}

describe('NoiseControl (mock data)', () => {
  it('reads Off from the mock and round-trips a level change', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <NoiseControl />
        </ExerciseContextProvider>
      </ThemeProvider>,
    )

    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Off')
    expect(screen.getByTestId('noise-counts')).toHaveTextContent('24 in pool · 0 posted')

    await user.click(radio('Medium'))

    await waitFor(() => expect(screen.getByTestId('noise-rate')).toHaveTextContent('6 posts/min'))
    expect(radio('Medium')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Running')
  })

  it('pushes the new state to mock subscribers and refuses an unknown level with a 400', async () => {
    const pushed: string[] = []
    const unsubscribe = subscribeMockNoiseState(state => pushed.push(state.level))

    await api.put('/staff/noise', { level: 'low' }, { adapter: mockNoiseAdapter })
    expect(pushed).toEqual(['low'])

    await expect(
      api.put('/staff/noise', { level: 'loud' }, { adapter: mockNoiseAdapter }),
    ).rejects.toMatchObject({ response: { status: 400 } })
    expect(pushed).toEqual(['low'])
    unsubscribe()
  })
})
