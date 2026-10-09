/**
 * features/social/pages/Profile.likesPrivate.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5): the Likes tab is OWN-profile only. A session with no bound persona,
 * or a read-only (observer) session, has no likes of its own to show, so even on the
 * persona's page it gets the honest "Likes are private." state — never fake entries,
 * and no needless includeReplies read. (The interactive-own-profile and
 * someone-else's-profile cases are in `Profile.brandProfile.test.tsx`.)
 *
 * Its own file because `vi.mock('@/core/auth', ...)` is hoisted over the whole module
 * and cannot share a file with tests that need the real `SessionProvider` (the same
 * split as `Feed.followingReadOnlyDefault.test.tsx`).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { Profile } from './Profile'

const OWN_ID = 'persona-dreyes_fh'

const READONLY_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: OWN_ID, // bound, but read-only: an observer is not the persona
  actingHumanId: 'human-observer',
  isReadOnly: true,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

const NO_PERSONA_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-shared',
  role: 'participant',
  personaId: undefined,
  actingHumanId: 'human-shared',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

let currentSession: Session = READONLY_SESSION

vi.mock('@/core/auth', () => ({
  useSession: () => currentSession,
}))

function renderOwnProfile() {
  return render(
    <ExerciseContextProvider>
      <ShellContextProvider
        value={{ variant: 'readOnly', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
      >
        <SocialDirectoryProvider>
          <Profile personaId={OWN_ID} />
        </SocialDirectoryProvider>
      </ShellContextProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  // The demo fixtures include posts seeded as liked, so a leak would be visible.
  postStore.resetForTests({ withDemoFixtures: true })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  postStore.resetForTests()
  vi.restoreAllMocks()
})

describe.each([
  ['a read-only (observer) session bound to the persona', READONLY_SESSION],
  ['a session with no bound persona', NO_PERSONA_SESSION],
])('Profile Likes — %s', (_name, session) => {
  it('says "Likes are private." on the persona’s own page and lists nothing', async () => {
    currentSession = session
    const getSpy = vi.spyOn(api, 'get')
    const user = userEvent.setup()
    renderOwnProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    // The seeded-liked posts exist, yet none is shown: likes are private to the interactive owner.
    expect(await screen.findByTestId('profile-likes-private')).toHaveTextContent(
      'Likes are private.',
    )
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
    const repliesReads = getSpy.mock.calls.filter(([url, config]) => {
      const params = (config as AxiosRequestConfig | undefined)?.params as
        | Record<string, unknown>
        | undefined
      return url === '/feed' && params?.includeReplies === true
    })
    expect(repliesReads).toHaveLength(0)
  })
})
