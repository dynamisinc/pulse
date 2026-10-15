/**
 * features/social/pinned/mockPins.ts
 * ---------------------------------------------------------------------------
 * The MOCK backend's memory of pins and likes (dev / UAT-no-backend / Vitest only;
 * demo-feedback story 07). It stands in for the server's `PostReaction` rows (kinds
 * `pin` and `like`) and `Post.PinnedForAllAt` so the mock `GET /api/feed/pinned`
 * (`pinnedFeedService`) can be built with the server's DF-5 rules. Never on the live path:
 * the services consult it only when `USE_MOCK_DATA` is on.
 *
 * ORDER. A real server orders by scenario instants; the mock has no reaction clock, so a
 * monotonically increasing sequence number stands in for "when it happened" (newest =
 * highest). A post the fixtures already mark as liked / pinned (`viewer.liked` /
 * `viewer.pinned` on a seeded post) and that nobody touched this session sorts after every
 * recorded change, newest scenario time first.
 *
 * SEED. One exercise pin on the utility's official advisory (`post-seed-fw-advisory`) so
 * the dev build shows the "Pinned" marker without a console. Tests reset it with
 * {@link resetMockPins}.
 *
 * Holds post ids and booleans only - no text, no persona, no time (XC-002, COR-053).
 */

import { registerSessionReset } from '@/core/auth/sessionReset'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { viewerEngagement } from './pinEvents'

/** The default exercise pin (see SEED). */
export const DEFAULT_MOCK_EXERCISE_PINS: readonly string[] = ['post-seed-fw-advisory']

/** A recorded state and when (in mock sequence order) it was recorded. */
interface Recorded {
  readonly active: boolean
  readonly seq: number
}

let seq = 0
let exercisePins = new Map<string, number>()
let personalPins = new Map<string, Recorded>()
let likes = new Map<string, Recorded>()
let failing = false

function seed(ids: readonly string[]): void {
  exercisePins = new Map()
  for (const id of ids) exercisePins.set(id, ++seq)
}

seed(DEFAULT_MOCK_EXERCISE_PINS)

/** Options for {@link resetMockPins}. */
export interface ResetMockPinsOptions {
  /** The exercise pins to start from (default {@link DEFAULT_MOCK_EXERCISE_PINS}). */
  readonly exercisePins?: readonly string[]
}

/** Test-only (and session reset): forgets every recorded pin / like and the failure switch. */
export function resetMockPins(options: ResetMockPinsOptions = {}): void {
  personalPins = new Map()
  likes = new Map()
  failing = false
  seed(options.exercisePins ?? DEFAULT_MOCK_EXERCISE_PINS)
}

/** Test-only: make every mock pin write (and the mock pinned read) reject until reset. */
export function setMockPinFailure(value: boolean): void {
  failing = value
}

/** Whether the mock pin endpoints are currently failing. */
export function isMockPinFailing(): boolean {
  return failing
}

/** Records the viewer's personal pin state on a post (the mock `PUT/DELETE .../reactions/pin`). */
export function recordMockPersonalPin(postId: string, active: boolean): void {
  personalPins.set(postId, { active, seq: ++seq })
}

/** Records a confirmed like / unlike (fed from the `viewerEngagement` channel in mock mode). */
export function recordMockLike(postId: string, active: boolean): void {
  likes.set(postId, { active, seq: ++seq })
}

/**
 * Mock-mode exercise pin (the stand-in for the console's `PUT/DELETE /api/staff/posts/{id}/pin`
 * plus its `PostPinChanged` push). Pinning again keeps the original pin's place, like the server
 * (the pin instant does not move).
 */
export function setMockExercisePin(postId: string, pinnedForAll: boolean): void {
  if (pinnedForAll) {
    if (!exercisePins.has(postId)) exercisePins.set(postId, ++seq)
  } else {
    exercisePins.delete(postId)
  }
  // No hub in mock mode: tell a mounted Pinned tab directly (the live path is `PostPinChanged`).
  viewerEngagement.notify({ postId, kind: 'exercise', active: pinnedForAll })
}

/** The mock's view of one post, for the mock pinned feed. */
export interface MockPinView {
  /** The exercise pin's sequence, or `undefined` when not pinned for everyone. */
  readonly exercisePinSeq: number | undefined
  /** The viewer's pin: a recorded state overrides the fixture's `viewer.pinned`. */
  readonly pinned: Recorded | undefined
  /** The viewer's like: a recorded state overrides the fixture's `viewer.liked`. */
  readonly liked: Recorded | undefined
}

/** What the mock remembers about `postId` (see {@link MockPinView}). */
export function mockPinView(postId: string): MockPinView {
  return {
    exercisePinSeq: exercisePins.get(postId),
    pinned: personalPins.get(postId),
    liked: likes.get(postId),
  }
}

// Mock mode: the like write path (`reactionService`) is not ours, so the mock learns about a
// confirmed like / unlike from the action row's settle notification instead. Exercise pins made
// through `setMockExercisePin` are recorded by that call itself.
if (USE_MOCK_DATA) {
  viewerEngagement.subscribe(event => {
    if (event.kind === 'like') recordMockLike(event.postId, event.active)
  })
}

// Personal pins and likes belong to the identity that made them (the exercise pins are the
// exercise's, but a sign-in can be a different exercise, so they go too).
registerSessionReset(() => resetMockPins(), import.meta.hot)
