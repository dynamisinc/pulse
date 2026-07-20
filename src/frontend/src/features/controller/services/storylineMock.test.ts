/**
 * features/controller/services/storylineMock.test.ts
 * ---------------------------------------------------------------------------
 * Covers the mock storyline store (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2):
 *
 *  - `phaseLabel()` upper-cases every `StorylinePhase` value exactly as
 *    `StorylineBriefProjection.PhaseLabel` does (`phase.ToString().ToUpperInvariant()`).
 *  - `setTargetIntensity()` clamps 0-100 (including out-of-range and
 *    fractional input), swaps the snapshot (never mutates in place), and
 *    returns the `"{from} → {to}"` / `"none → {to}"` detail string exactly as
 *    `Storyline.FormatTarget`/`SetTargetIntensity` do.
 *  - `subscribe()` notifies listeners on every mutation and its unsubscribe
 *    function stops further notification.
 *  - `resetForTests()` restores the seeded baseline and clears listeners —
 *    no cross-test pollution.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { phaseLabel, storylineMock, type StorylinePhase } from './storylineMock'

afterEach(() => {
  storylineMock.resetForTests()
})

describe('phaseLabel', () => {
  const cases: ReadonlyArray<[StorylinePhase, string]> = [
    ['Dormant', 'DORMANT'],
    ['Seeded', 'SEEDED'],
    ['Escalating', 'ESCALATING'],
    ['Peak', 'PEAK'],
    ['Addressed', 'ADDRESSED'],
    ['Decaying', 'DECAYING'],
    ['Resolved', 'RESOLVED'],
  ]

  it.each(cases)('renders %s as uppercase %s (matches StorylineBriefProjection.PhaseLabel)', (phase, label) => {
    expect(phaseLabel(phase)).toBe(label)
  })
})

describe('storylineMock — seeded baseline', () => {
  it('seeds an escalating storyline with an unset target', () => {
    const storyline = storylineMock.getStoryline()
    expect(storyline.intensity).toBe(62)
    expect(storyline.targetIntensity).toBeNull()
    expect(storyline.phase).toBe('Escalating')
  })
})

describe('storylineMock.setTargetIntensity', () => {
  it('sets a target from unset, returning the "none → {to}" detail (Storyline.FormatTarget)', () => {
    const change = storylineMock.setTargetIntensity(60)
    expect(change).toEqual({ from: null, to: 60, detail: 'none → 60' })
    expect(storylineMock.getStoryline().targetIntensity).toBe(60)
  })

  it('changes an already-set target, returning the "{from} → {to}" detail', () => {
    storylineMock.setTargetIntensity(78)
    const change = storylineMock.setTargetIntensity(60)
    expect(change).toEqual({ from: 78, to: 60, detail: '78 → 60' })
  })

  it('clamps above 100 down to 100', () => {
    const change = storylineMock.setTargetIntensity(140)
    expect(change.to).toBe(100)
  })

  it('clamps below 0 up to 0', () => {
    const change = storylineMock.setTargetIntensity(-30)
    expect(change.to).toBe(0)
  })

  it('rounds a fractional value', () => {
    const change = storylineMock.setTargetIntensity(60.6)
    expect(change.to).toBe(61)
  })

  it('clears the target with null, returning "{from} → none"', () => {
    storylineMock.setTargetIntensity(60)
    const change = storylineMock.setTargetIntensity(null)
    expect(change).toEqual({ from: 60, to: null, detail: '60 → none' })
    expect(storylineMock.getStoryline().targetIntensity).toBeNull()
  })

  it('swaps the snapshot identity rather than mutating the previous one in place', () => {
    const before = storylineMock.getStoryline()
    storylineMock.setTargetIntensity(60)
    const after = storylineMock.getStoryline()

    expect(after).not.toBe(before)
    expect(before.targetIntensity).toBeNull() // the old snapshot is untouched
    expect(after.targetIntensity).toBe(60)
  })

  it('does not move actual intensity — only the deferred engine-follow tick does that', () => {
    const before = storylineMock.getStoryline().intensity
    storylineMock.setTargetIntensity(10)
    expect(storylineMock.getStoryline().intensity).toBe(before)
  })
})

describe('storylineMock.subscribe', () => {
  it('notifies every listener on a mutation', () => {
    let calls = 0
    const unsubscribe = storylineMock.subscribe(() => {
      calls += 1
    })

    storylineMock.setTargetIntensity(50)
    storylineMock.setTargetIntensity(51)

    expect(calls).toBe(2)
    unsubscribe()
  })

  it('stops notifying after unsubscribe', () => {
    let calls = 0
    const unsubscribe = storylineMock.subscribe(() => {
      calls += 1
    })
    unsubscribe()

    storylineMock.setTargetIntensity(50)

    expect(calls).toBe(0)
  })
})

describe('storylineMock.resetForTests', () => {
  it('restores the seeded baseline and clears listeners', () => {
    let calls = 0
    storylineMock.subscribe(() => {
      calls += 1
    })
    storylineMock.setTargetIntensity(90)

    storylineMock.resetForTests()

    expect(storylineMock.getStoryline().targetIntensity).toBeNull()
    expect(storylineMock.getStoryline().intensity).toBe(62)

    // Listener was cleared by the reset — a further mutation does not notify it.
    storylineMock.setTargetIntensity(20)
    expect(calls).toBe(1) // only the pre-reset mutation counted
  })
})
