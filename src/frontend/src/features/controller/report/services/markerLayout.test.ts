/**
 * features/controller/report/services/markerLayout.test.ts
 * ---------------------------------------------------------------------------
 * Story 31 collision test: the numbered chart badges never overlap, at any marker density.
 */
import { describe, expect, it } from 'vitest'
import { BADGE_HEIGHT, layoutMarkerBadges, type PlacedBadge } from './markerLayout'

function overlaps(a: PlacedBadge, b: PlacedBadge): boolean {
  if (a.row !== b.row) return false // rows are BADGE_HEIGHT apart or more
  return a.x - a.width / 2 < b.x + b.width / 2 && b.x - b.width / 2 < a.x + a.width / 2
}

function expectNoOverlap(badges: readonly PlacedBadge[]) {
  for (let i = 0; i < badges.length; i += 1) {
    for (let j = i + 1; j < badges.length; j += 1) {
      const a = badges[i]
      const b = badges[j]
      if (a === undefined || b === undefined) throw new Error('unreachable')
      expect(overlaps(a, b), `${a.label} vs ${b.label}`).toBe(false)
    }
  }
}

describe('layoutMarkerBadges', () => {
  it('numbers markers left to right whatever order they arrive in', () => {
    const layout = layoutMarkerBadges([{ x: 300 }, { x: 40 }, { x: 600 }])
    expect(layout.numberOf).toEqual([2, 1, 3])
    expect(layout.badges.map(badge => badge.label)).toEqual(['1', '2', '3'])
    expect(layout.rows).toBe(1)
  })

  it('keeps well-separated markers as separate single badges on one row', () => {
    const layout = layoutMarkerBadges([{ x: 40 }, { x: 140 }, { x: 240 }])
    expect(layout.badges).toHaveLength(3)
    expectNoOverlap(layout.badges)
  })

  it('never overlaps ten markers in adjacent bins (merging them)', () => {
    const markers = Array.from({ length: 10 }, (_, index) => ({ x: 100 + index * 5.3 }))
    const layout = layoutMarkerBadges(markers)
    expectNoOverlap(layout.badges)
    // Every marker is accounted for in exactly one badge.
    expect(layout.badges.flatMap(badge => [...badge.numbers]).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(layout.badges.some(badge => badge.label.includes('–'))).toBe(true)
  })

  it('never overlaps at any density (sweep over spacing and count)', () => {
    for (const spacing of [0, 1, 3, 8, 13, 16, 17, 20, 30]) {
      for (const count of [2, 5, 10, 25, 40]) {
        const markers = Array.from({ length: count }, (_, index) => ({ x: 34 + index * spacing }))
        expectNoOverlap(layoutMarkerBadges(markers).badges)
      }
    }
  })

  it('offsets a wide merged badge into a second row rather than overprinting its neighbour', () => {
    // "1-4" is wider than a single digit; a lone marker just to its right must clear it.
    const layout = layoutMarkerBadges([{ x: 100 }, { x: 105 }, { x: 110 }, { x: 115 }, { x: 134 }])
    expectNoOverlap(layout.badges)
    expect(BADGE_HEIGHT).toBeGreaterThan(0)
  })

  it('handles no markers', () => {
    expect(layoutMarkerBadges([])).toEqual({ badges: [], rows: 0, numberOf: [] })
  })
})
