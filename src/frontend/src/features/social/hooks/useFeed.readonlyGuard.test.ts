/**
 * features/social/hooks/useFeed.readonlyGuard.test.ts
 * ---------------------------------------------------------------------------
 * Pins the WR-005 fold (Gate-1 warnings, #88/#121): `useFeed` enforces the
 * COR-015 "read-only/no-persona sessions never get the Following scope" rule
 * ITSELF, not only through `<Feed>`'s own guard. Before this fix, calling
 * `useFeed('following')` DIRECTLY — bypassing `<Feed>` entirely, something
 * nothing in this hook's own signature prevented, since it is exported from
 * the feature barrel — would have served such a session the (possibly empty)
 * filtered Following feed; `<Feed>`'s own comment claimed a "future
 * integration mistake cannot violate" the rule, which wasn't true for this
 * exact bypass. This spec calls the hook directly, with no `<Feed>` in the
 * tree at all, and asserts the degrade-to-'all' behavior holds anyway.
 *
 * Lives in its own file (mirrors `useFollow.readonly.test.ts`/`useFollow.
 * noPersona.test.ts`): `vi.mock('@/core/auth')` is hoisted to the WHOLE
 * module, so it cannot share a file with the sibling specs that need a
 * writable session (`useFeed.following.test.ts`).
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { personaIdForHandle } from '@/features/personas'
import { setMockFollowingForTests } from '../services/feedService'
import { postStore } from '../services/postStore'
import { useFeed } from './useFeed'

let currentSession: Session

vi.mock('@/core/auth', () => ({
  useSession: () => currentSession,
}))

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

// A seeded author NOT in the mock store's default followed set
// (`FairhavenWater`/`kwardFH`) — present in the response only if the request
// actually served the FULL All Posts set, never the Following-filtered one.
const UNFOLLOWED_SEEDED_AUTHOR = personaIdForHandle('Newsline7')

afterEach(() => {
  postStore.resetForTests()
  setMockFollowingForTests(undefined)
})

describe('useFeed(\'following\') — the COR-015 guard lives IN THE HOOK (WR-005 fold, #88/#121)', () => {
  it('degrades a read-only session\'s "following" request to All Posts, called directly with no <Feed> in the tree', async () => {
    currentSession = READONLY_SESSION

    const { result } = renderHook(() => useFeed('following'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeUndefined()
    // Proof it's the FULL All Posts set: an author outside the default
    // followed set is present, which a genuinely-honored 'following' request
    // would have filtered out.
    expect(
      result.current.posts.some(p => p.author.id === UNFOLLOWED_SEEDED_AUTHOR),
    ).toBe(true)
  })

  it('degrades a no-persona session\'s "following" request to All Posts the same way', async () => {
    currentSession = NO_PERSONA_SESSION

    const { result } = renderHook(() => useFeed('following'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeUndefined()
    expect(
      result.current.posts.some(p => p.author.id === UNFOLLOWED_SEEDED_AUTHOR),
    ).toBe(true)
  })
})
