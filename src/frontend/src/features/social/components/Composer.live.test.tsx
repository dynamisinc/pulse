/**
 * features/social/components/Composer.live.test.tsx
 * ---------------------------------------------------------------------------
 * The composer in LIVE mode, through the rendered DOM (demo-polish F4, story 13
 * "Own post appears instantly"; SOC-001, NFR-001):
 *
 *  - `onPosted(view)` fires in live mode too (F1's compose modal closes on it), with
 *    the participant-safe view of the created post;
 *  - a FAILED publish keeps the draft and shows an inline alert with a Retry button
 *    — the text is never silently dropped; Retry re-sends the same draft;
 *  - while the request is in flight the form is locked (`aria-busy`, read-only text,
 *    Post disabled) so a second press or an edit cannot race the success.
 *
 * Own file: `vi.mock('@/core/config/mockData')` is module-wide (see
 * `useComposePost.live.test.ts`), and the exercise/session hooks are mocked directly.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import type { CreatedPostView, ParticipantPostView } from '@/features/social'
import { Composer } from './Composer'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/core/auth', () => ({ useSession: vi.fn() }))
vi.mock('../services/livePostActions', () => ({ publishPost: vi.fn() }))

import { publishPost } from '../services/livePostActions'
import { ownPostStore } from '../services/ownPostStore'

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-live-0001',
  exerciseName: 'Coastal Surge (Live)',
  timeZone: 'America/New_York',
  status: 'active',
}

const SESSION: Session = {
  exerciseId: 'ex-live-0001',
  accountId: 'acct-live-participant',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

const CREATED: CreatedPostView = {
  id: 'post-created-1',
  authorPersonaId: 'persona-dreyes_fh',
  text: 'Water is back on.',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(SCOPE)
  vi.mocked(useSession).mockReturnValue(SESSION)
  vi.mocked(publishPost).mockReset().mockResolvedValue(CREATED)
})

afterEach(() => {
  ownPostStore.resetForTests()
})

describe('Composer — LIVE mode', () => {
  it('fires onPosted(view) after the server accepts the post, and clears the draft', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    render(<Composer onPosted={onPosted} />)

    await user.type(screen.getByLabelText('Post text'), 'Water is back on.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(onPosted.mock.calls[0]?.[0].id).toBe('post-created-1')
    expect(screen.getByLabelText('Post text')).toHaveValue('')
    expect(await screen.findByText('Post published.')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-publish-error')).not.toBeInTheDocument()
  })

  it('keeps the draft and offers Retry when the publish fails; Retry re-sends it', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error'))
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    render(<Composer onPosted={onPosted} />)

    await user.type(screen.getByLabelText('Post text'), 'Roads are closed.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    // An alert, in words, with a Retry - and the text is exactly where it was.
    const alert = await screen.findByTestId('composer-publish-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/couldn.t be sent/i)
    expect(screen.getByLabelText('Post text')).toHaveValue('Roads are closed.')
    expect(onPosted).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].text).toBe('Roads are closed.')
    expect(screen.queryByTestId('composer-publish-error')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Post text')).toHaveValue('')
  })

  it('locks the form while the request is in flight', async () => {
    let finish: (view: CreatedPostView) => void = () => {}
    vi.mocked(publishPost).mockReturnValue(new Promise<CreatedPostView>(resolve => {
      finish = resolve
    }))
    const user = userEvent.setup()
    render(<Composer />)

    await user.type(screen.getByLabelText('Post text'), 'Slow one.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const form = screen.getByTestId('composer')
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByLabelText('Post text')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Add photos or video' })).toBeDisabled()

    finish(CREATED)
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByLabelText('Post text')).not.toHaveAttribute('readonly')
  })
})
