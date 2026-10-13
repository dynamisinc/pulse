/**
 * features/controller/lifecycle/lifecycleMock.test.ts
 * ---------------------------------------------------------------------------
 * The mock-data stand-in for the lifecycle endpoints (demo-polish C6): it must be the BACKEND's
 * state machine (`ExerciseLifecycleStates.Allowed`), because a demo that allows a transition the
 * real server refuses teaches the wrong thing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXERCISE_STATUSES,
  resetMockExerciseStatus,
  resolveExerciseContext,
} from '@/core/exerciseContext'
import { LifecycleError, LIFECYCLE_STATES } from './lifecycleService'
import { canonicalLifecycleState, mockLifecycleFor, simulateTransition } from './lifecycleMock'

afterEach(() => {
  resetMockExerciseStatus()
})

describe('the mock state machine mirrors the backend table', () => {
  // Pinned from `ExerciseLifecycleStates.Allowed`
  // (Pulse.WebApi/Features/ExerciseConfiguration/Lifecycle).
  const BACKEND: Record<string, string[]> = {
    build: ['staged'],
    staged: ['live'],
    live: ['paused', 'completed'],
    paused: ['live', 'completed'],
    completed: ['archived'],
    archived: [],
  }

  it.each(LIFECYCLE_STATES.map(state => [state] as const))('%s allows exactly what the server allows', state => {
    expect(mockLifecycleFor(state).allowedTransitions).toEqual(BACKEND[state])
  })

  it('maps EVERY status the exercise scope can carry (the shared vocabulary) to a COR-032 literal', () => {
    for (const status of EXERCISE_STATUSES) {
      expect(LIFECYCLE_STATES).toContain(canonicalLifecycleState(status))
    }
  })

  it('folds the legacy literals onto their COR-032 equivalents', () => {
    expect(canonicalLifecycleState('scheduled')).toBe('build')
    expect(canonicalLifecycleState('active')).toBe('live')
    expect(canonicalLifecycleState('complete')).toBe('completed')
    expect(canonicalLifecycleState('archived')).toBe('archived')
    expect(mockLifecycleFor('active').allowedTransitions).toEqual(BACKEND.live)
  })
})

describe('simulateTransition', () => {
  it('applies an allowed edge: the mock scope now reports the new status, and the result is its lifecycle', async () => {
    const next = simulateTransition('staged', 'live')

    expect(next).toEqual({ state: 'live', allowedTransitions: ['paused', 'completed'] })
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'live' })
  })

  it('refuses a missing edge with the server\'s own 409 sentence, and changes nothing', async () => {
    let error: unknown
    try {
      simulateTransition('live', 'live')
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(LifecycleError)
    expect((error as LifecycleError).status).toBe(409)
    expect((error as LifecycleError).message).toBe(
      "'live' -> 'live' is not an allowed lifecycle transition (allowed from 'live': paused, completed).",
    )
    await expect(resolveExerciseContext()).resolves.toMatchObject({ status: 'live' })
  })

  it('says a terminal state is terminal', () => {
    expect(() => simulateTransition('archived', 'live')).toThrow(
      "'archived' -> 'live' is not an allowed lifecycle transition ('archived' is a terminal state).",
    )
  })

  it('canonicalizes a legacy current status before checking the edge (active behaves as live)', () => {
    expect(simulateTransition('active', 'completed').state).toBe('completed')
  })
})
