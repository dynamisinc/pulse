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
 *  - Retry is offered ONLY when the failure proves nothing was created (network /
 *    5xx / rate limit). After a server REFUSAL (400/403/409) or an unreadable 2xx
 *    ("could not confirm" - the post may already exist, and there is no idempotency
 *    key) there is NO Retry, the draft and the message stay, and the author can still
 *    press Post deliberately (H-1, M-5);
 *  - while the request is in flight the form is locked (`aria-busy`, read-only text,
 *    Post `aria-disabled`) so a second press or an edit cannot race the success;
 *  - keyboard focus is never lost (M-3, NFR-001): Post keeps focus while in flight
 *    (it is aria-disabled, not disabled), Retry hands focus to Post, and a successful
 *    publish moves focus to the text area.
 *
 * Own file: `vi.mock('@/core/config/mockData')` is module-wide (see
 * `useComposePost.live.test.ts`), and the exercise/session hooks are mocked directly.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
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

/** An axios failure as the shared client raises it: with a response when the server answered. */
function axiosFailure(status?: number): AxiosError {
  if (status === undefined) return new AxiosError('Network Error', 'ERR_NETWORK')
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status } as AxiosResponse,
  )
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

  it('locks the form while the request is in flight, WITHOUT dropping keyboard focus (M-3)', async () => {
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
    const post = screen.getByRole('button', { name: 'Post' })
    // aria-disabled, NOT disabled: a disabled button would drop focus to the page.
    expect(post).toHaveAttribute('aria-disabled', 'true')
    expect(post).not.toBeDisabled()
    expect(post).toHaveFocus()
    expect(screen.getByLabelText('Post text')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Add photos or video' })).toBeDisabled()

    // A second press while in flight is ignored.
    await user.click(post)
    await user.keyboard('{Enter}')
    expect(publishPost).toHaveBeenCalledTimes(1)

    finish(CREATED)
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByLabelText('Post text')).not.toHaveAttribute('readonly')
  })

  it('moves focus to the text area after a successful publish (M-3)', async () => {
    const user = userEvent.setup()
    render(<Composer />)

    await user.type(screen.getByLabelText('Post text'), 'Water is back on.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    await screen.findByText('Post published.')
    // Post is disabled again with the cleared draft; focus must not fall to <body>.
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByLabelText('Post text')).toHaveFocus()
  })

  it('does not steal focus a successful publish if the author moved it elsewhere', async () => {
    let finish: (view: CreatedPostView) => void = () => {}
    vi.mocked(publishPost).mockReturnValue(new Promise<CreatedPostView>(resolve => {
      finish = resolve
    }))
    const user = userEvent.setup()
    render(
      <>
        <Composer />
        <button type="button">Elsewhere</button>
      </>,
    )
    await user.type(screen.getByLabelText('Post text'), 'Slow one.')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

    finish(CREATED)

    await screen.findByText('Post published.')
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })
})

describe('Composer — what Retry may offer (H-1, M-5)', () => {
  async function failOnce(failure: unknown) {
    vi.mocked(publishPost).mockRejectedValueOnce(failure)
    const user = userEvent.setup()
    render(<Composer />)
    await user.type(screen.getByLabelText('Post text'), 'Roads are closed.')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    const alert = await screen.findByTestId('composer-publish-error')
    return { user, alert }
  }

  it('a NETWORK failure offers Retry', async () => {
    const { alert } = await failOnce(axiosFailure())

    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(alert).toHaveTextContent(/couldn.t be sent/i)
  })

  it('a 5xx offers Retry', async () => {
    const { alert } = await failOnce(axiosFailure(503))

    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('a 2xx the client could not read says "could not confirm" and offers NO Retry (no double-post)', async () => {
    const { user, alert } = await failOnce(new Error('publishPost: the server returned a malformed post'))

    expect(alert).toHaveTextContent(/couldn.t confirm your post went out/i)
    expect(alert).toHaveTextContent(/check the feed/i)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    // The draft is kept, and the author may still press Post deliberately.
    expect(screen.getByLabelText('Post text')).toHaveValue('Roads are closed.')
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(2))
  })

  it.each([400, 403, 409])('a %i refusal says it was not accepted, with NO Retry', async status => {
    const { alert } = await failOnce(axiosFailure(status))

    expect(alert).toHaveTextContent(/wasn.t accepted/i)
    expect(alert).not.toHaveTextContent(/connection/i)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Post text')).toHaveValue('Roads are closed.')
  })

  it('editing the draft after a refusal clears the message', async () => {
    const { user } = await failOnce(axiosFailure(409))

    await user.type(screen.getByLabelText('Post text'), '!')

    expect(screen.queryByTestId('composer-publish-error')).not.toBeInTheDocument()
  })

  it('Retry hands focus to Post (its own alert goes away when the attempt starts)', async () => {
    const { user, alert } = await failOnce(axiosFailure())
    let finish: (view: CreatedPostView) => void = () => {}
    vi.mocked(publishPost).mockReturnValue(new Promise<CreatedPostView>(resolve => {
      finish = resolve
    }))

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByTestId('composer-publish-error')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Post' })).toHaveFocus()

    finish(CREATED)
    await screen.findByText('Post published.')
    expect(screen.getByLabelText('Post text')).toHaveFocus()
  })
})
