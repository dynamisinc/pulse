/**
 * core/exerciseContextResolver.default.test.ts
 * ---------------------------------------------------------------------------
 * Coverage for the SHIPPED default path: the real shared axios client plus the
 * canned `mockAdapter` (`MOCK_EXERCISE_CONTEXT`). The sibling
 * `exerciseContextResolver.test.ts` mocks `api.get` to exercise the
 * validation/error branches, so this is the only test that runs what the app
 * actually executes until the real `/exercise-context` endpoint lands.
 *
 * Deliberately does NOT mock `@/core/services/api` — the request goes through
 * the real axios request pipeline and is short-circuited by the adapter, so no
 * network is touched.
 */
import { describe, it, expect } from 'vitest'
import { resolveExerciseContext } from './exerciseContextResolver'

describe('resolveExerciseContext (default mock adapter)', () => {
  it('resolves the canned single exercise scope through the real axios client', async () => {
    const scope = await resolveExerciseContext()

    expect(scope).toEqual({
      exerciseId: 'ex-mock-0001',
      exerciseName: 'Coastal Surge (Mock Exercise)',
      timeZone: 'America/New_York',
      // Story 01a: the canned mock carries a COR-032 literal, so this — the one
      // test that runs what the app actually executes on the mock path — proves
      // the widened guard accepts the new vocabulary end to end.
      status: 'live',
    })
  })
})
