/**
 * features/social/components/ReplyComposer.absent.test.tsx
 * ---------------------------------------------------------------------------
 * ABSENT, NOT DISABLED (COR-015 / D1-011; demo-polish F4, story 13): a read-only
 * session and a session with no persona to reply AS get NO reply box - not a
 * disabled form, and not even the post composer's "posting isn't available" note -
 * both from `<ReplyComposer>` itself and from `<ThreadView>`, so assistive tech
 * never announces controls that cannot be used.
 *
 * The shared mock session is a normal writable participant, so these scenarios force
 * a session by mocking `useSession()` (everything else in `@/core/auth` stays real).
 * Own file: `vi.mock` is hoisted to the whole module.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { useSession } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { ReplyComposer } from './ReplyComposer'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { ThreadView } from './ThreadView'

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, useSession: vi.fn() }
})

const BASE: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-observer',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

const READ_ONLY: Session = { ...BASE, isReadOnly: true }
const NO_PERSONA: Session = { ...BASE, personaId: undefined }

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue(BASE)
})

function expectNoReplyBox() {
  expect(screen.queryByTestId('reply-composer')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Reply text')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
  expect(screen.queryByText(/posting isn.t available/i)).not.toBeInTheDocument()
  expect(screen.queryByTestId('reply-composer-context')).not.toBeInTheDocument()
}

describe('ReplyComposer — absent for sessions that cannot reply', () => {
  it('renders nothing in a read-only session', async () => {
    vi.mocked(useSession).mockReturnValue(READ_ONLY)
    render(
      <ExerciseContextProvider>
        <div data-testid="sentinel" />
        <ReplyComposer parentPostId="post-1" parentHandle="mvega_fh" />
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('sentinel')

    expectNoReplyBox()
  })

  it('renders nothing for a session with no persona to reply as', async () => {
    vi.mocked(useSession).mockReturnValue(NO_PERSONA)
    render(
      <ExerciseContextProvider>
        <div data-testid="sentinel" />
        <ReplyComposer parentPostId="post-1" parentHandle="mvega_fh" />
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('sentinel')

    expectNoReplyBox()
  })
})

describe('ThreadView — no reply box for a read-only or persona-less session', () => {
  async function renderThread(session: Session) {
    vi.mocked(useSession).mockReturnValue(session)
    render(
      <ExerciseContextProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <SocialDirectoryProvider>
            <ThreadView focusedPostId="post-seed-mvega-question" />
          </SocialDirectoryProvider>
        </ShellContextProvider>
      </ExerciseContextProvider>,
    )
    await waitFor(() => expect(screen.queryByText('Loading thread…')).not.toBeInTheDocument())
    await screen.findByTestId('thread-focused')
  }

  it('read-only session: the thread reads, the reply box is absent', async () => {
    await renderThread(READ_ONLY)

    expect(screen.getAllByTestId('thread-reply').length).toBeGreaterThan(0)
    expectNoReplyBox()
    expect(screen.queryByTestId('thread-reply-composer')).not.toBeInTheDocument()
  })

  it('persona-less session: the thread reads, the reply box is absent', async () => {
    await renderThread(NO_PERSONA)

    expect(screen.getAllByTestId('thread-reply').length).toBeGreaterThan(0)
    expectNoReplyBox()
    expect(screen.queryByTestId('thread-reply-composer')).not.toBeInTheDocument()
  })

  it('a writable persona-bound session DOES get the reply box (control case)', async () => {
    await renderThread(BASE)

    expect(screen.getByTestId('reply-composer')).toBeInTheDocument()
  })
})
