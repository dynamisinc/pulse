/**
 * features/controller/liveWorld/liveWorldTestKit.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY builders shared by the Live world column's tests (demo-polish C2):
 * post / view builders over the seeded Fairhaven cast, and a controllable fake
 * arrival source standing in for the shared realtime transport. Plain `.ts`
 * (no JSX) so the components-only export rule never applies. Never import this
 * from non-test code.
 */

import { vi } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import type { ParticipantPostView, Post } from '@/features/social'
import type {
  FeedStreamHandler,
  FeedStreamSource,
  FeedTransportMode,
} from '@/features/social/services/feedStreamSource'

/** Seeded personas (display name in the comment). */
export const WATER = personaIdForHandle('FairhavenWater') // Fairhaven Water Utility, verified
export const LOOKALIKE = personaIdForHandle('FairhavenWaterUpd') // Fairhaven Water Update, unverified
export const MVEGA = personaIdForHandle('mvega_fh') // Marisol Vega, unverified

/** A scenario instant on the Fairhaven day; `minute` 0..59 within 10:00Z. */
export function at(minute: number, second = 0): string {
  const mm = String(minute).padStart(2, '0')
  const ss = String(second).padStart(2, '0')
  return `2033-09-04T10:${mm}:${ss}.000Z`
}

/** A participant-safe view (what the realtime transport delivers). */
export function view(
  id: string,
  overrides: Partial<ParticipantPostView> = {},
): ParticipantPostView {
  return {
    id,
    authorPersonaId: WATER,
    text: `text of ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: at(0),
    ...overrides,
  }
}

/** A full `Post` (what `resolveFeed` resolves), provenance included on purpose. */
export function post(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: WATER,
    actingHumanId: 'human-controller-01',
    text: `text of ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-01-01T00:00:00.000Z',
    scenarioTime: at(0),
    origin: 'controller-as-persona',
    ...overrides,
  }
}

/** A fake arrival source whose mode the test controls. */
export interface FakeSource extends FeedStreamSource {
  mode: FeedTransportMode
  readonly subscribe: ReturnType<typeof vi.fn<FeedStreamSource['subscribe']>>
  readonly start: ReturnType<typeof vi.fn<FeedStreamSource['start']>>
  readonly stop: ReturnType<typeof vi.fn<FeedStreamSource['stop']>>
  /** Delivers `post` to every subscriber, as the transport would. */
  emit(post: ParticipantPostView): void
  /** How many handlers are currently subscribed. */
  subscriberCount(): number
}

export function createFakeSource(mode: FeedTransportMode = 'realtime'): FakeSource {
  const handlers = new Set<FeedStreamHandler>()
  const source: FakeSource = {
    mode,
    subscribe: vi.fn<FeedStreamSource['subscribe']>(handler => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    }),
    start: vi.fn<FeedStreamSource['start']>(() => Promise.resolve()),
    stop: vi.fn<FeedStreamSource['stop']>(),
    emit(next) {
      for (const handler of [...handlers]) handler(next)
    },
    subscriberCount: () => handlers.size,
  }
  return source
}
