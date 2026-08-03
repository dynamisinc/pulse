/**
 * features/exerciseLifecycleAdmin/services/orgExercisesService.default.test.ts
 * ---------------------------------------------------------------------------
 * The SHIPPED default path: the real shared axios client plus the canned mock
 * adapters. Nothing is mocked here — every call goes through the real axios
 * request pipeline and is short-circuited by the adapter, so no network is
 * touched (mirrors `staffAssignmentsService.default.test.ts` /
 * `exerciseContextResolver.default.test.ts`, WAVE0-REVIEW precedent 19).
 *
 * ## What these cases are actually for
 * The mock is the thing every other test in this feature runs against, and a
 * mock that quietly does nothing is this repo's most productive bug class. So
 * the first case below is the one that matters: CREATE, THEN LIST — a read-only
 * mock would still return 201 and still pass a test that only inspected the
 * response body. The 409 and 400 cases pin the two failures the surface has to
 * recover from; if the mock never produced them, the form's recovery paths
 * would be untestable and unreachable in dev.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  OrgExerciseError,
  createOrgExercise,
  getOrgExercises,
  isHostnameTakenError,
  resetOrgExerciseMocks,
} from './orgExercisesService'

beforeEach(() => {
  resetOrgExerciseMocks()
})

describe('getOrgExercises (default mock adapter)', () => {
  it('resolves the canned organization portfolio through the real axios client', async () => {
    const exercises = await getOrgExercises()

    expect(exercises.map(exercise => exercise.exerciseId)).toEqual([
      'ex-mock-0001',
      'ex-mock-0002',
      'ex-mock-0003',
    ])
  })

  it('carries all four row fields story 02 AC2 requires', async () => {
    const [first] = await getOrgExercises()

    expect(first).toBeDefined()
    expect(first?.name).toBe('Coastal Surge (Mock Exercise)')
    expect(first?.status).toBe('live')
    expect(first?.hostname).toBe('coastal-surge')
    expect(first?.createdAt).toBeDefined()
  })

  it('seeds the same exerciseId the mock session is bound to, not an orphan', async () => {
    // `ex-mock-0001` is `exerciseContextResolver.ts`'s MOCK_EXERCISE_CONTEXT and
    // `staffAssignmentsService`'s first canned assignment. A mock portfolio that
    // did not contain the exercise the mock session is IN would make dev/UAT
    // look like a cross-organization leak.
    const exercises = await getOrgExercises()

    expect(exercises.some(exercise => exercise.exerciseId === 'ex-mock-0001')).toBe(true)
  })
})

describe('createOrgExercise (default mock adapter)', () => {
  it('CREATE THEN LIST: the new exercise is really in the next read, in Build', async () => {
    // THE case. A read-only mock returns 201 and appends nothing — the response
    // body alone cannot tell the two apart, which is exactly how a silent no-op
    // ships. This asserts the second, independent read.
    const before = await getOrgExercises()

    const result = await createOrgExercise({ name: 'Riverbend Flood TTX' })

    expect(result.exercise.status).toBe('build')
    expect(result.assignedRole).toBe('planner')

    const after = await getOrgExercises()
    expect(after).toHaveLength(before.length + 1)

    const created = after.find(e => e.exerciseId === result.exercise.exerciseId)
    expect(created).toBeDefined()
    expect(created?.name).toBe('Riverbend Flood TTX')
    expect(created?.status).toBe('build')
  })

  it('allocates a hostname when the caller proposes none', async () => {
    const result = await createOrgExercise({ name: 'Riverbend Flood TTX' })

    expect(result.exercise.hostname).toBeDefined()
    expect(result.exercise.hostname).toMatch(/^riverbend-flood-ttx-[0-9a-f]{8}$/)
  })

  it('normalizes and keeps a proposed hostname', async () => {
    const result = await createOrgExercise({ name: 'Cliffside', hostname: '  CliffSide-Drill ' })

    expect(result.exercise.hostname).toBe('cliffside-drill')
  })

  it('409s on a hostname another exercise already holds, and creates nothing', async () => {
    const before = await getOrgExercises()

    const caught = await createOrgExercise({ name: 'Clashing', hostname: 'coastal-surge' })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(OrgExerciseError)
    expect((caught as OrgExerciseError).status).toBe(409)
    expect(isHostnameTakenError(caught)).toBe(true)

    // A refused create leaves NO row behind — the same all-or-nothing unit of
    // work the real endpoint guarantees.
    expect(await getOrgExercises()).toHaveLength(before.length)
  })

  it('400s on a blank name, and creates nothing', async () => {
    const before = await getOrgExercises()

    const caught = await createOrgExercise({ name: '   ' }).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(OrgExerciseError)
    expect((caught as OrgExerciseError).status).toBe(400)
    expect(isHostnameTakenError(caught)).toBe(false)
    expect(await getOrgExercises()).toHaveLength(before.length)
  })

  it('strips markup from the name, so the surface renders a server-shaped value', async () => {
    // NFR-004: the live server strips markup on ingest. The mock does the same,
    // so a component test never sees a value the real backend could not return.
    const result = await createOrgExercise({ name: '<b>Bold</b> Drill' })

    expect(result.exercise.name).toBe('Bold Drill')
  })
})
