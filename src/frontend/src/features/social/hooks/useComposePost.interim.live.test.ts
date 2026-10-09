/**
 * features/social/hooks/useComposePost.interim.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE half of the interim composer behaviour (see
 * `useComposePost.interim.test.ts`): with `USE_MOCK_DATA` off, publishing with
 * draft chips attached fires `livePostActions.publishPost` with a body that has
 * NO `media` key (the legacy `{ kind, alt }` placeholder is never sent — DP-6),
 * a text-less post never reaches the network, and the in-fiction notice is
 * raised. Same mocking pattern as `useComposePost.live.test.ts`.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import { DRAFT_MEDIA_NOT_SENT_MESSAGE, useComposePost } from './useComposePost'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/core/auth', () => ({ useSession: vi.fn() }))
vi.mock('../services/postService', () => ({
  createPost: vi.fn(),
  listPosts: () => [],
  toParticipantView: vi.fn(),
  originConsoleLabel: vi.fn(),
}))
vi.mock('../services/livePostActions', () => ({ publishPost: vi.fn() }))

import { publishPost } from '../services/livePostActions'

const PUBLISHED_VIEW = {
  id: 'post-published-1',
  authorPersonaId: 'persona-dreyes_fh',
  text: 'published',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
}

const scope: ExerciseScope = {
  exerciseId: 'ex-live-0001',
  exerciseName: 'Coastal Surge (Live)',
  timeZone: 'America/New_York',
  status: 'active',
}

const session: Session = {
  exerciseId: 'ex-live-0001',
  accountId: 'acct-live-participant',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

function imageFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' })
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(scope)
  vi.mocked(useSession).mockReturnValue(session)
  vi.mocked(publishPost).mockReset().mockResolvedValue(PUBLISHED_VIEW)
})

describe('useComposePost — interim draft chips (LIVE mode)', () => {
  it('sends the text with NO media key, and raises the notice, when chips are attached', async () => {
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.attachImages([imageFile('flood.png')]))
    act(() => result.current.setText('Water is back on in Zone 3.'))
    act(() => result.current.publish())

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(publishPost).mock.calls[0]?.[0]
    expect(sent?.text).toBe('Water is back on in Zone 3.')
    expect(sent).not.toHaveProperty('media')
    expect(result.current.mediaError).toBe(DRAFT_MEDIA_NOT_SENT_MESSAGE)
    expect(result.current.media).toEqual([])
  })

  it('never reaches the network for a text-less post, even with chips', () => {
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.attachImages([imageFile('flood.png')]))
    expect(result.current.canPublish).toBe(false)
    act(() => result.current.publish())

    expect(publishPost).not.toHaveBeenCalled()
    expect(result.current.mediaError).toBeUndefined()
  })
})
