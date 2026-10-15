/**
 * features/controller/noise/noiseStatus.test.ts
 * ---------------------------------------------------------------------------
 * Story 09 AC1/AC2 as pure logic: the rate and counts wording, and the stopped reasons in words
 * (empty pool first, then Freeze, then the clock), including a Freeze the server has not pushed.
 */
import { describe, expect, it } from 'vitest'
import {
  formatNoiseCounts,
  formatNoiseRate,
  noiseStatusLine,
  NOISE_STOPPED_CLOCK,
  NOISE_STOPPED_EMPTY_POOL,
  NOISE_STOPPED_ENDED,
  NOISE_STOPPED_FROZEN,
  NOISE_STOPPED_PAUSED,
} from './noiseStatus'
import type { NoiseStateDto } from './noiseTypes'

function state(overrides: Partial<NoiseStateDto> = {}): NoiseStateDto {
  return { level: 'medium', ratePerMinute: 6, poolSize: 40, postedCount: 12, running: true, ...overrides }
}

describe('noise wording', () => {
  it('says the rate as "N posts/min"', () => {
    expect(formatNoiseRate(6)).toBe('6 posts/min')
    expect(formatNoiseRate(0)).toBe('0 posts/min')
    expect(formatNoiseRate(1)).toBe('1 post/min')
  })

  it('says the pool size and the posted count', () => {
    expect(formatNoiseCounts(state())).toBe('40 in pool · 12 posted')
  })
})

describe('noiseStatusLine (why noise is stopped, in words)', () => {
  it('is Off when the level is off, whatever else is true', () => {
    expect(noiseStatusLine(state({ level: 'off', ratePerMinute: 0, running: false }), 'freeze'))
      .toEqual({ kind: 'off', text: 'Off' })
  })

  it('is Running when a level is set and the server says running', () => {
    expect(noiseStatusLine(state(), 'running')).toEqual({ kind: 'running', text: 'Running' })
  })

  it('names an empty pool first, even when the world is also frozen', () => {
    expect(noiseStatusLine(state({ poolSize: 0, running: false }), 'freeze'))
      .toEqual({ kind: 'stopped', text: NOISE_STOPPED_EMPTY_POOL })
  })

  it('says the world is frozen under the Freeze tier', () => {
    expect(noiseStatusLine(state({ running: false }), 'freeze'))
      .toEqual({ kind: 'stopped', text: NOISE_STOPPED_FROZEN })
  })

  it('says frozen even before the server reports running=false (no push on Freeze)', () => {
    expect(noiseStatusLine(state({ running: true }), 'freeze').text).toBe(NOISE_STOPPED_FROZEN)
  })

  it('says the clock is not running for any other stop', () => {
    expect(noiseStatusLine(state({ running: false }), 'running'))
      .toEqual({ kind: 'stopped', text: NOISE_STOPPED_CLOCK })
  })

  it.each([
    ['completed', NOISE_STOPPED_ENDED],
    ['archived', NOISE_STOPPED_ENDED],
    ['complete', NOISE_STOPPED_ENDED],
    ['paused', NOISE_STOPPED_PAUSED],
    ['live', NOISE_STOPPED_CLOCK],
    ['staged', NOISE_STOPPED_CLOCK],
  ] as const)('names a %s lifecycle after the pool and Freeze checks', (status, text) => {
    expect(noiseStatusLine(state({ running: false }), 'running', status).text).toBe(text)
  })

  it('keeps the pool and Freeze reasons ahead of the lifecycle', () => {
    expect(noiseStatusLine(state({ poolSize: 0, running: false }), 'running', 'completed').text)
      .toBe(NOISE_STOPPED_EMPTY_POOL)
    expect(noiseStatusLine(state({ running: false }), 'freeze', 'paused').text)
      .toBe(NOISE_STOPPED_FROZEN)
  })

  it('does not treat Pause injects or Pause engine as a stop (DF-13)', () => {
    expect(noiseStatusLine(state(), 'injects').kind).toBe('running')
    expect(noiseStatusLine(state(), 'engine').kind).toBe('running')
  })
})
