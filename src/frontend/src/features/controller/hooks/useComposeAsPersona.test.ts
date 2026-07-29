/**
 * features/controller/hooks/useComposeAsPersona.test.ts
 * ---------------------------------------------------------------------------
 * The controller persona-compose LIVE PERSIST addition (persona-operation/01;
 * CTL-001, COR-001, COR-018, COR-053) — the UAT fix that makes a controller's
 * "post as persona" action actually reach participants instead of living only
 * in the console's own tab:
 *  - This file is LIVE-mode only — it forces `USE_MOCK_DATA` false file-wide
 *    (see the flat `vi.mock` below). MOCK mode is UNCHANGED and its coverage
 *    lives elsewhere (the real `<PersonaComposer>` in
 *    `../components/PersonaComposer.test.tsx`); nothing here asserts mock-mode
 *    behaviour;
 *  - LIVE mode additionally fires `livePostActions.publishPost` with
 *    `origin: 'controller-as-persona'` and no client `exerciseId` (COR-001),
 *    fire-and-forget, WHILE STILL returning the local `Post` via `onPublished`
 *    (the console's own-tab view depends on it — `composeAsPersona` stays
 *    pure, never touches the network itself);
 *  - a rejected `publishPost` never surfaces as an unhandled rejection.
 *
 * `@/core/exerciseContext` is mocked directly (mirrors `useEngineControl.
 * test.ts`) — no provider tree needed. `@/core/services/api` is mocked
 * (mirrors `composeService.test.ts`) so `composeAsPersona`'s real `createPost`
 * → `buildAndEmit` never touches the network for its own best-effort POST.
 *
 * Also covers the DRAFT-SURVIVES-UNMOUNT store (autonomy-safety story 06,
 * Gate-1 WR-103): a mount/unmount/remount for the SAME (exercise, persona)
 * restores the exact draft text, a different persona never observes it, and
 * `publish()` clears it. The EXPLICIT discard path (Esc/X on the persona
 * dock) is deliberately NOT tested here — this hook has no notion of "the
 * dock closed"; that discard lives in `ControllerConsole`'s `closeDock` and
 * is covered end-to-end, driving the REAL Esc/X, in `ControllerConsole.
 * personaDraftDiscard.test.tsx`.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { Post } from '@/features/social'
import { composeAsPersonaDraftStore, useComposeAsPersona } from './useComposeAsPersona'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

vi.mock('@/features/social/services/livePostActions', () => ({
  publishPost: vi.fn(),
}))

// This whole file exercises the LIVE branch only — mock mode is already
// covered end-to-end via `<PersonaComposer>` in `../components/
// PersonaComposer.test.tsx` (which relies on the REAL providers/resolvers,
// so it cannot share a file with this file-wide USE_MOCK_DATA override —
// same rationale as `useComposePost.live.test.ts`).
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { publishPost } from '@/features/social/services/livePostActions'

const mockedUseExerciseContext = vi.mocked(useExerciseContext)

function scope(): ExerciseScope {
  return {
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  }
}

// STAFF fixture (the console's active persona is a `StaffPersona`); the hook
// itself declares only the narrower `Persona` it actually reads.
const ACTIVE_PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scope())
  vi.mocked(publishPost).mockReset().mockResolvedValue(undefined)
  // Gate-1 WR-103's persisted-draft store is a module singleton keyed by
  // (exerciseId, personaId) — several tests below reuse the SAME
  // persona/exercise, so reset it between tests.
  composeAsPersonaDraftStore.resetForTests()
})

describe('useComposeAsPersona — LIVE persist (UAT fix)', () => {
  it('fires livePostActions.publishPost AND still returns the local Post via onPublished', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() =>
      useComposeAsPersona({
        activePersona: ACTIVE_PERSONA,
        actingHumanId: 'human-ctl-7',
        onPublished,
      }),
    )

    act(() => result.current.setText('Zones 2-4 are now clear.'))
    act(() => result.current.publish())

    // The console still gets its local Post (own-tab optimistic view + R-003
    // origin label depend on it — composeAsPersona stays pure/network-free).
    expect(onPublished).toHaveBeenCalledTimes(1)
    const post = onPublished.mock.calls[0]?.[0]
    expect(post?.text).toBe('Zones 2-4 are now clear.')
    expect(post?.origin).toBe('controller-as-persona')

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({
        authorPersonaId: 'persona-fairhavenwater',
        actingHumanId: 'human-ctl-7',
        text: 'Zones 2-4 are now clear.',
        timeZone: 'America/New_York',
        origin: 'controller-as-persona',
      }),
    )
  })

  it('a rejected publishPost never becomes an unhandled rejection', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )

    act(() => result.current.setText('Fire and forget.'))
    expect(() => act(() => result.current.publish())).not.toThrow()

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
  })
})

describe('useComposeAsPersona — the draft SURVIVES an unmount (Gate-1 WR-103)', () => {
  it('typing a draft, unmounting (e.g. the console closes the dock for an unrelated reason), and remounting for the SAME persona restores the exact text', () => {
    const first = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    act(() => first.result.current.setText('Boil-water notice lifted for Zone 3.'))
    expect(first.result.current.text).toBe('Boil-water notice lifted for Zone 3.')

    // Simulates ControllerConsole unmounting <PersonaComposer> for a reason
    // that is NOT the operator choosing to discard their text (e.g. the
    // ENGINE settings tool activating and closing the persona dock).
    first.unmount()

    const second = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    expect(second.result.current.text).toBe('Boil-water notice lifted for Zone 3.')
  })

  it('publish() clears the persisted draft too, so a later remount for the SAME persona starts empty', async () => {
    const first = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    act(() => first.result.current.setText('Sent already.'))
    act(() => first.result.current.publish())
    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
    first.unmount()

    const second = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    expect(second.result.current.text).toBe('')
  })

  it('a DIFFERENT persona never observes another persona\'s in-progress draft', () => {
    const other: StaffPersona = { ...ACTIVE_PERSONA, id: 'persona-other' }

    const first = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    act(() => first.result.current.setText('Only for Fairhaven Water.'))
    first.unmount()

    const second = renderHook(() =>
      useComposeAsPersona({ activePersona: other, actingHumanId: 'human-ctl-7' }),
    )
    expect(second.result.current.text).toBe('')
  })

  it('discardDraft() removes a persisted draft directly (the primitive ControllerConsole\'s explicit Esc/X close calls) — a no-op if there was none', () => {
    const first = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    act(() => first.result.current.setText('About to be explicitly dismissed.'))
    first.unmount()

    composeAsPersonaDraftStore.discardDraft('ex-live-0001', ACTIVE_PERSONA.id)

    const second = renderHook(() =>
      useComposeAsPersona({ activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7' }),
    )
    expect(second.result.current.text).toBe('')

    // No-op when there is nothing to discard.
    expect(() => composeAsPersonaDraftStore.discardDraft('ex-live-0001', 'no-such-persona')).not.toThrow()
  })
})
