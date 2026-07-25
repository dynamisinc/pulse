/**
 * features/social/services/audience.test.ts
 * ---------------------------------------------------------------------------
 * Test pass for profiles-social-graph/05 "Audience magnitude & follower
 * affordance" (#113) — the SHARED model (SOC-054, D1-012):
 *
 *  - AC1: displayed follower count = audience magnitude + real edges;
 *  - AC3: the reach/velocity formula E8 (ADP-004) and E10 (EVL-012) import —
 *         asserted at its boundaries (zero audience, zero/one amplification,
 *         intensity 0/100 and out-of-range, elapsed-time saturation) so a
 *         coefficient change is a deliberate, visible edit here rather than a
 *         silent drift in two other epics;
 *  - the magnitude formatting boundaries (999/1000, 999999/1000000, the
 *    truncate-never-round rule, and the float-artifact case 2,900,000).
 *
 * Pure unit tests: no React, no clock, no network — mirroring the module's own
 * purity contract.
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIENCE_REACH_MODEL,
  audienceReach,
  displayedFollowerCount,
  formatMagnitude,
} from './audience'

describe('displayedFollowerCount — count = magnitude + real edges (AC1, SOC-054)', () => {
  it('sums the audience magnitude and the real follow edges', () => {
    expect(displayedFollowerCount(48_200, 5)).toBe(48_205)
  })

  it('treats the edge count as optional (a profile with no follow graph yet)', () => {
    expect(displayedFollowerCount(48_200)).toBe(48_200)
  })

  it('returns the edge count alone when an account has no simulated audience', () => {
    expect(displayedFollowerCount(0, 3)).toBe(3)
  })

  it('never double-counts: magnitude and edges are disjoint populations', () => {
    // The magnitude is NOT a total that already contains the edges, so adding
    // an edge always moves the displayed count by exactly one.
    expect(displayedFollowerCount(1_000, 1) - displayedFollowerCount(1_000, 0)).toBe(1)
  })

  it('floors fractional inputs and clamps negative / non-finite ones to 0', () => {
    expect(displayedFollowerCount(10.9, 2.7)).toBe(12)
    expect(displayedFollowerCount(-5, -2)).toBe(0)
    expect(displayedFollowerCount(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('formatMagnitude — compact in-fiction counts (D1-012)', () => {
  it('renders the story\'s canonical example', () => {
    expect(formatMagnitude(48_200)).toBe('48.2K')
  })

  it('shows small counts EXACTLY (below 1,000 nothing is compacted)', () => {
    expect(formatMagnitude(0)).toBe('0')
    expect(formatMagnitude(1)).toBe('1')
    expect(formatMagnitude(450)).toBe('450')
    expect(formatMagnitude(999)).toBe('999')
  })

  it('switches to K exactly at 1,000 and drops a .0 tenth', () => {
    expect(formatMagnitude(1_000)).toBe('1K')
    expect(formatMagnitude(1_100)).toBe('1.1K')
    expect(formatMagnitude(220_000)).toBe('220K')
  })

  it('TRUNCATES rather than rounds, so a count is never overstated', () => {
    expect(formatMagnitude(48_299)).toBe('48.2K')
    expect(formatMagnitude(1_999)).toBe('1.9K')
    expect(formatMagnitude(999_999)).toBe('999.9K')
  })

  it('switches to M exactly at 1,000,000 and to B at 1,000,000,000', () => {
    expect(formatMagnitude(1_000_000)).toBe('1M')
    expect(formatMagnitude(1_500_000)).toBe('1.5M')
    expect(formatMagnitude(999_999_999)).toBe('999.9M')
    expect(formatMagnitude(1_000_000_000)).toBe('1B')
    expect(formatMagnitude(2_400_000_000)).toBe('2.4B')
  })

  it('uses integer arithmetic — the float-artifact case reads 2.9M, not 2.8M', () => {
    expect(formatMagnitude(2_900_000)).toBe('2.9M')
    expect(formatMagnitude(8_100_000)).toBe('8.1M')
  })

  it('degrades safely on a broken count rather than throwing', () => {
    expect(formatMagnitude(-1)).toBe('0')
    expect(formatMagnitude(Number.NaN)).toBe('0')
    expect(formatMagnitude(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatMagnitude(1_234.9)).toBe('1.2K')
  })
})

describe('audienceReach — the shared reach model (AC3; E10 EVL-012)', () => {
  it('computes reach over the audience model: (magnitude + edges) × exposure rate', () => {
    const result = audienceReach({ magnitude: 46_000, followEdges: 4 })

    expect(result.audience).toBe(46_004)
    expect(result.organicImpressions)
      .toBe(Math.round(46_004 * AUDIENCE_REACH_MODEL.baseExposureRate))
    expect(result.amplifiedImpressions).toBe(0)
    expect(result.impressions).toBe(result.organicImpressions)
  })

  it('reports a total that always equals its own breakdown (an evaluator can add it up)', () => {
    const result = audienceReach({ magnitude: 220_000, amplifications: 9, intensity: 55 })

    expect(result.impressions).toBe(result.organicImpressions + result.amplifiedImpressions)
  })

  it('reaches only a FRACTION of the audience — never "everyone saw it"', () => {
    const result = audienceReach({ magnitude: 100_000 })

    expect(result.impressions).toBeLessThan(result.audience)
  })

  it('scales monotonically with magnitude (SOC-054: reach is a function of magnitude)', () => {
    const nano = audienceReach({ magnitude: 450 }).impressions
    const mid = audienceReach({ magnitude: 46_000 }).impressions
    const mega = audienceReach({ magnitude: 1_500_000 }).impressions

    expect(nano).toBeLessThan(mid)
    expect(mid).toBeLessThan(mega)
  })

  it('is zero at the zero boundary — an audience of nobody reaches nobody', () => {
    const result = audienceReach({ magnitude: 0 })

    expect(result.audience).toBe(0)
    expect(result.impressions).toBe(0)
    expect(result.accruedImpressions).toBe(0)
    expect(result.velocity).toBe(0)
  })

  it('discounts amplification sub-linearly — overlapping audiences, not N× fresh eyes', () => {
    const base = audienceReach({ magnitude: 10_000 })
    const one = audienceReach({ magnitude: 10_000, amplifications: 1 })
    const ten = audienceReach({ magnitude: 10_000, amplifications: 10 })

    expect(base.amplifiedImpressions).toBe(0)
    // One repost by a peer-magnitude account adds one peer audience's worth.
    expect(one.amplifiedImpressions).toBe(base.organicImpressions)
    // Ten reposts add far less than ten times that (0.75 exponent → ~5.6×).
    expect(ten.amplifiedImpressions).toBeLessThan(10 * one.amplifiedImpressions)
    expect(ten.amplifiedImpressions).toBeGreaterThan(one.amplifiedImpressions)
  })

  it('uses the supplied amplifier magnitude when the amplifier set is known', () => {
    const peers = audienceReach({ magnitude: 10_000, amplifications: 4 })
    const megaphones = audienceReach({
      magnitude: 10_000,
      amplifications: 4,
      amplifierMagnitude: 1_000_000,
    })

    expect(megaphones.amplifiedImpressions).toBeGreaterThan(peers.amplifiedImpressions)
  })
})

describe('audienceReach — spread velocity (AC3; E8 ADP-004)', () => {
  it('scales velocity with audience magnitude', () => {
    const small = audienceReach({ magnitude: 4_800 }).velocity
    const large = audienceReach({ magnitude: 220_000 }).velocity

    expect(large).toBeGreaterThan(small)
  })

  it('scales velocity with storyline intensity (ADP-004: velocity = f(intensity, magnitude))', () => {
    const quiet = audienceReach({ magnitude: 46_000, intensity: 0 })
    const hot = audienceReach({ magnitude: 46_000, intensity: 100 })

    expect(hot.impressions).toBeGreaterThan(quiet.impressions)
    expect(hot.velocity).toBeGreaterThan(quiet.velocity)
    // A hot storyline also spreads FASTER: the time constant shrinks.
    expect(hot.spreadMinutes).toBeLessThan(quiet.spreadMinutes)
  })

  it('bounds the intensity lift at both ends (0 and 100), clamping out-of-range input', () => {
    const zero = audienceReach({ magnitude: 46_000, intensity: 0 })
    const full = audienceReach({ magnitude: 46_000, intensity: 100 })

    expect(audienceReach({ magnitude: 46_000, intensity: -40 })).toEqual(zero)
    expect(audienceReach({ magnitude: 46_000, intensity: 9_000 })).toEqual(full)
    // The lift is bounded: full intensity is at most (1 + lift)× the quiet case.
    const bound = 1 + AUDIENCE_REACH_MODEL.intensityLift
    expect(full.impressions).toBeLessThanOrEqual(Math.ceil(zero.impressions * bound))
  })

  it('reports velocity as the initial slope of the same curve accrual walks', () => {
    const result = audienceReach({ magnitude: 46_000, intensity: 40 })

    expect(result.velocity).toBeCloseTo(result.impressions / result.spreadMinutes, 6)
    expect(result.spreadMinutes).toBeGreaterThan(0)
  })
})

describe('audienceReach — scenario-time accrual (COR-053: minutes are passed in)', () => {
  it('treats an omitted elapsed time as fully accrued', () => {
    const result = audienceReach({ magnitude: 46_000 })

    expect(result.accruedImpressions).toBe(result.impressions)
  })

  it('accrues nothing at t=0 and saturates toward the total', () => {
    const input = { magnitude: 46_000, intensity: 50 }
    const atZero = audienceReach({ ...input, elapsedScenarioMinutes: 0 })
    const atTau = audienceReach({
      ...input,
      elapsedScenarioMinutes: audienceReach(input).spreadMinutes,
    })
    const late = audienceReach({ ...input, elapsedScenarioMinutes: 100_000 })
    const total = audienceReach(input).impressions

    expect(atZero.accruedImpressions).toBe(0)
    // One time constant ≈ 63% of the eventual total.
    expect(atTau.accruedImpressions / total).toBeCloseTo(0.632, 2)
    expect(late.accruedImpressions).toBe(total)
  })

  it('accrues monotonically as scenario minutes pass', () => {
    const input = { magnitude: 46_000 }
    const t5 = audienceReach({ ...input, elapsedScenarioMinutes: 5 }).accruedImpressions
    const t30 = audienceReach({ ...input, elapsedScenarioMinutes: 30 }).accruedImpressions
    const t90 = audienceReach({ ...input, elapsedScenarioMinutes: 90 }).accruedImpressions

    expect(t5).toBeLessThan(t30)
    expect(t30).toBeLessThan(t90)
  })

  it('ignores a negative or non-finite elapsed time rather than producing nonsense', () => {
    const total = audienceReach({ magnitude: 46_000 }).impressions

    expect(audienceReach({ magnitude: 46_000, elapsedScenarioMinutes: -10 }).accruedImpressions)
      .toBe(total)
    expect(
      audienceReach({ magnitude: 46_000, elapsedScenarioMinutes: Number.NaN }).accruedImpressions,
    ).toBe(total)
  })
})

describe('audienceReach — the model is a frozen, shared contract', () => {
  it('exposes its coefficients so E8/E10 cite them instead of hardcoding copies', () => {
    expect(AUDIENCE_REACH_MODEL.baseExposureRate).toBeGreaterThan(0)
    expect(AUDIENCE_REACH_MODEL.baseExposureRate).toBeLessThan(1)
    expect(AUDIENCE_REACH_MODEL.amplificationExponent).toBeLessThan(1)
    expect(AUDIENCE_REACH_MODEL.spreadTimeConstantMinutes).toBeGreaterThan(0)
    expect(Object.isFrozen(AUDIENCE_REACH_MODEL)).toBe(true)
  })

  it('is pure: the same inputs always produce the same outputs', () => {
    const input = { magnitude: 46_000, followEdges: 3, amplifications: 7, intensity: 62 }

    expect(audienceReach(input)).toEqual(audienceReach(input))
  })

  it('never returns follower ROWS — magnitude is a number, never fabricated identities', () => {
    const result = audienceReach({ magnitude: 1_500_000 })

    for (const value of Object.values(result)) {
      expect(typeof value).toBe('number')
    }
  })
})
