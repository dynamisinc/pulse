/**
 * The write-check seam: canWrite = !ended && !session.isReadOnly. Ended never touches the
 * session itself (personal views keep their persona), and a 403 while ended maps to the
 * "exercise has ended" wording.
 */
import { AxiosError, type AxiosResponse } from 'axios'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReadOnlySessionScope, SessionProvider, useSession } from '@/core/auth'
import { classifyPublishFailure } from '@/features/social/hooks/useComposePost'
import {
  EXERCISE_ENDED_WRITE_MESSAGE,
  ExerciseEndedProvider,
  isEndedRefusal,
  useCanWrite,
} from './writeGate'

function Probe() {
  const session = useSession()
  return (
    <output data-testid="probe">
      {String(useCanWrite())}|{String(session.personaId !== undefined)}
    </output>
  )
}

const forbidden = new AxiosError('x', 'E', undefined, undefined, { status: 403 } as AxiosResponse)

describe('useCanWrite', () => {
  it('is true for a live writable session, and with no provider', async () => {
    render(<SessionProvider><Probe /></SessionProvider>)
    expect(await screen.findByTestId('probe')).toHaveTextContent('true|true')
  })

  it('is false when ended, while the session keeps its persona (personal views survive)', async () => {
    render(
      <SessionProvider>
        <ExerciseEndedProvider ended><Probe /></ExerciseEndedProvider>
      </SessionProvider>,
    )
    expect(await screen.findByTestId('probe')).toHaveTextContent('false|true')
  })

  it('is false for a read-only session', async () => {
    render(
      <SessionProvider>
        <ReadOnlySessionScope><Probe /></ReadOnlySessionScope>
      </SessionProvider>,
    )
    expect(await screen.findByTestId('probe')).toHaveTextContent('false|false')
  })
})

describe('ended refusals', () => {
  it('only a 403 while ended is an ended refusal', () => {
    expect(isEndedRefusal(forbidden, true)).toBe(true)
    expect(isEndedRefusal(forbidden, false)).toBe(false)
    expect(isEndedRefusal(new Error('x'), true)).toBe(false)
  })

  it('the composer classifies a 403 in ended mode as a refusal with the ended wording', () => {
    expect(classifyPublishFailure(forbidden, false, true)).toEqual({
      kind: 'refused',
      message: EXERCISE_ENDED_WRITE_MESSAGE,
    })
    expect(classifyPublishFailure(forbidden, false, false).message).not.toBe(
      EXERCISE_ENDED_WRITE_MESSAGE,
    )
  })
})
