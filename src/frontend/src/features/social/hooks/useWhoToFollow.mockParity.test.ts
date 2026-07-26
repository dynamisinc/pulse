/**
 * features/social/hooks/useWhoToFollow.mockParity.test.ts
 * ---------------------------------------------------------------------------
 * The MOCK/LIVE PARITY spec for the "Who to follow" cap (WR-001, story 04 /
 * backend story 08). Everything here runs against the SHIPPED seams — the real
 * `whoToFollowService` mock adapter, the real `followService` mock adapter, the
 * real shared `followEdgeStore`, the real `usePersonas()` cast and the real
 * `SessionProvider` — because the defect this file exists to prevent lived
 * precisely in the seam between them, and any spec that mocked
 * `resolveSuggestedFollowIds` (as the sibling `useWhoToFollow.test.ts`
 * deliberately does, to assert ordering/exclusion semantics) cannot see it.
 *
 * WHAT WENT WRONG, AND WHAT THIS PINS. The live server excludes the viewer's
 * own persona and everything they already follow and only THEN applies
 * `limit`, so `<WhoToFollow limit={3}>` always has three rows to render. The
 * mock adapter used to cap FIRST and leave both exclusions to this hook, which
 * re-applies them AFTER the fetch — so as soon as a participant followed one of
 * the first three suggestions and the module remounted, mock rendered two rows,
 * then one, then none, while live rendered three throughout. Mock and live
 * agreed only by accident of where the seeded follow edges happened to fall in
 * the fixture order.
 *
 * The remount is the point: `<WhoToFollow>` re-fetches on mount, so this is the
 * ordinary participant journey (follow someone, navigate away, come back), not
 * an exotic one.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { followPersona, resetMockFollowEdges } from '../services/followService'
import { useWhoToFollow } from './useWhoToFollow'

/** The cap `<WhoToFollow>` is actually mounted with in `SocialChannel`. */
const MOUNTED_LIMIT = 3

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SessionProvider, null, children)
}

beforeEach(() => {
  // A genuinely empty mock follow graph — the suggestion order under test is
  // then the seeded one, not "whatever the store pre-followed".
  resetMockFollowEdges()
})

describe('useWhoToFollow — a capped read keeps yielding `limit` rows as the viewer follows (WR-001)', () => {
  it('renders `limit` suggestions before any follow', async () => {
    const { result } = renderHook(() => useWhoToFollow(MOUNTED_LIMIT), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions).toHaveLength(MOUNTED_LIMIT)
  })

  it('STILL renders `limit` suggestions after following the top one and remounting', async () => {
    const first = renderHook(() => useWhoToFollow(MOUNTED_LIMIT), { wrapper })
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    const justFollowed = first.result.current.suggestions[0]?.id
    if (justFollowed === undefined) throw new Error('expected a first suggestion to follow')
    await followPersona(justFollowed)
    first.unmount()

    // The module remounts (navigate away and back) and re-reads.
    const second = renderHook(() => useWhoToFollow(MOUNTED_LIMIT), { wrapper })
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    expect(second.result.current.suggestions).toHaveLength(MOUNTED_LIMIT)
    expect(second.result.current.suggestions.map(p => p.id)).not.toContain(justFollowed)
  })

  it('does not drain the module as the viewer keeps following the top suggestion', async () => {
    for (let round = 0; round < MOUNTED_LIMIT; round += 1) {
      const view = renderHook(() => useWhoToFollow(MOUNTED_LIMIT), { wrapper })
      await waitFor(() => expect(view.result.current.loading).toBe(false))

      expect(view.result.current.suggestions).toHaveLength(MOUNTED_LIMIT)

      const top = view.result.current.suggestions[0]?.id
      if (top === undefined) throw new Error('expected a suggestion to follow')
      await followPersona(top)
      view.unmount()
    }

    const final = renderHook(() => useWhoToFollow(MOUNTED_LIMIT), { wrapper })
    await waitFor(() => expect(final.result.current.loading).toBe(false))
    expect(final.result.current.suggestions).toHaveLength(MOUNTED_LIMIT)
  })
})
