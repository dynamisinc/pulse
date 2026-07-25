/**
 * features/social/pages/Feed.followingReadOnlyDefault.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the COR-015 guard `<Feed>` enforces itself (feeds-discovery/02): a
 * read-only session, or a session with no bound persona, gets the EFFECTIVE
 * 'all' scope even when mounted with `scope="following"` — "read-only
 * sessions default to All Posts... never the empty Following feed." This
 * lives in its own file because `vi.mock('@/core/auth', ...)` is hoisted to
 * the WHOLE module — it cannot share a file with `Feed.following.test.tsx` /
 * `Feed.test.tsx`, which need the REAL `SessionProvider` (mirrors
 * `useReaction.readonly.test.ts` / `useReaction.noPersona.test.ts`'s own
 * rationale for the same split).
 *
 * Two scenarios, one per the story's own framing of "read-only sessions"
 * (COR-015): `isReadOnly: true` with a persona still bound (a shared-credential
 * observer session), and a session that isn't marked read-only but has no
 * `personaId` at all (nothing to follow AS). Both must resolve to All Posts.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { setMockFollowingForTests } from '../services/feedService'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

const READONLY_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
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

function renderFollowingRequest() {
  return render(
    <ExerciseContextProvider>
      <ShellContextProvider
        value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
      >
        <Feed scope="following" />
      </ShellContextProvider>
    </ExerciseContextProvider>,
  )
}

/** The seeded Fairhaven arc's All Posts author set (a superset of any single
 * mock-followed account) — proof the guard served the FULL feed, not a
 * follow-filtered subset. */
const ALL_POSTS_IDS = [
  'post-seed-kward-correction',
  'post-seed-mvega-question',
  'post-seed-newsline7-breaking',
  'post-seed-fulco-coordination',
  'post-seed-fwupd-rumor',
  'post-seed-fw-advisory',
]

afterEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests()
  setMockFollowingForTests(undefined)
  vi.restoreAllMocks()
})

describe.each([
  ['a read-only session (persona still bound)', READONLY_SESSION],
  ['a session with no bound persona', NO_PERSONA_SESSION],
] as const)('Feed scope="following" — COR-015 default: %s', (_label, session) => {
  it('renders the FULL All Posts set, never the empty/filtered Following feed', async () => {
    currentSession = session
    // A mock following set that would render almost nothing under a genuine
    // Following scope — proves the guard, not a coincidentally-permissive set.
    setMockFollowingForTests([])

    renderFollowingRequest()

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.map(c => c.getAttribute('data-post-id')).sort()).toEqual(
      [...ALL_POSTS_IDS].sort(),
    )
    // The Following-specific empty copy must never appear either — the guard
    // means this was never really the Following feed.
    expect(screen.queryByText(/no posts from accounts you follow yet/i)).toBeNull()
  })

  it('stamps the mount-view telemetry target as "all-posts", not "following-feed"', async () => {
    currentSession = session
    setMockFollowingForTests([])

    renderFollowingRequest()
    await screen.findAllByTestId('post-card')

    const views = getEmittedTelemetryEvents().filter(e => e.eventType === 'view')
    expect(views).toHaveLength(1)
    expect(views[0]?.target).toEqual({ entityType: 'feed', entityId: 'all-posts' })
  })
})
