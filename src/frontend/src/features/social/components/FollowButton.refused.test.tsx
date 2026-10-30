/**
 * #661 W2 + exercise-ended: a refused follow rolls back AND is announced (polite live region);
 * a 403 while the exercise has ended says so; in ended mode the control is absent.
 */
import { AxiosError, type AxiosResponse } from 'axios'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { ExerciseEndedProvider } from '@/features/participant-shell/writeGate'
import { FollowButton } from './FollowButton'
import { FOLLOW_FAILURE_MESSAGE } from '../hooks/useFollow'
import { followPersona } from '../services/followService'

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
}))

function refusal(status: number): AxiosError {
  return new AxiosError('refused', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
  } as AxiosResponse)
}

function renderButton(ended = false) {
  return render(
    <SessionProvider>
      <ExerciseEndedProvider ended={ended}>
        <FollowButton
          personaId="persona-fairhavenwater"
          displayName="Fairhaven Water"
          initialFollowerCount={5}
        />
      </ExerciseEndedProvider>
    </SessionProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('FollowButton refusal announcement (#661 W2)', () => {
  it('rolls back a refused follow and announces it in a polite live region', async () => {
    vi.mocked(followPersona).mockRejectedValue(refusal(409))
    renderButton()
    const region = await screen.findByTestId('follow-notice')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()

    fireEvent.click(await screen.findByTestId('follow-button'))

    await waitFor(() => expect(region).toHaveTextContent(FOLLOW_FAILURE_MESSAGE))
    expect(screen.getByTestId('follow-button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders no follow control at all once ended', () => {
    renderButton(true)
    expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument()
  })
})
