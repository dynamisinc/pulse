/**
 * features/social/explore/trending.test.ts
 * ---------------------------------------------------------------------------
 * Unit tests for the pure, memoized organic-trending computation (demo-polish F6,
 * SOC-041 client-side, COR-053):
 *  - the window is measured from the scenario "now" passed in (never a clock),
 *  - recency weighting (a half-life decay), distinct-tag-per-post counting,
 *  - a deterministic total-order tie-break (input order cannot matter),
 *  - soft-deleted / taken-down posts never contribute,
 *  - empty / malformed input, a 200-post burst, the limit clamp,
 *  - memoization (same feed + options => the SAME array reference),
 *  - the varied, never-authoritative category labels.
 */
import { describe, expect, it } from 'vitest'
import { nth } from './exploreTestUtils'
import {
  TRENDING_FUTURE_TOLERANCE_MS,
  TRENDING_HALF_LIFE_MS,
  TRENDING_MAX_LIMIT,
  TRENDING_WINDOW_MS,
  categoryFor,
  computeTrending,
  pickDisplayCasing,
  trendingTopics,
  type TrendingPostInput,
} from './trending'

const HOUR = 60 * 60 * 1000
/** A fixed scenario "now" (2033, nowhere near the real wall-clock). */
const NOW = Date.parse('2033-09-04T16:00:00.000Z')

let counter = 0
function post(
  text: string,
  ageMs: number,
  extra: Partial<TrendingPostInput> = {},
): TrendingPostInput {
  counter += 1
  return {
    id: `p-${counter}`,
    text,
    scenarioTime: new Date(NOW - ageMs).toISOString(),
    ...extra,
  }
}

describe('computeTrending — windowing in scenario time', () => {
  it('counts posts inside the window and ignores older ones', () => {
    const topics = computeTrending(
      [
        post('fresh #Inside', 1 * HOUR),
        post('edge #Edge', TRENDING_WINDOW_MS), // exactly on the boundary: still in
        post('stale #Outside', TRENDING_WINDOW_MS + 1), // just past it: out
      ],
      { now: NOW },
    )
    expect(topics.map(t => t.tag).sort()).toEqual(['edge', 'inside'])
  })

  it('measures the window from the `now` it is given, not from any clock', () => {
    const posts = [post('a #Water', 2 * HOUR)]
    expect(computeTrending(posts, { now: NOW })).toHaveLength(1)
    // Move "now" a day later: the same post is outside the 12h window.
    expect(computeTrending(posts, { now: NOW + 24 * HOUR })).toHaveLength(0)
  })

  it('honours a custom window', () => {
    const posts = [post('a #Water', 2 * HOUR), post('b #Power', 5 * HOUR)]
    expect(computeTrending(posts, { now: NOW, windowMs: 3 * HOUR }).map(t => t.tag)).toEqual([
      'water',
    ])
  })

  it('treats a post stamped slightly after `now` as brand new (age clamped to 0)', () => {
    const [topic] = computeTrending([post('ahead #Skew', -5 * 60 * 1000)], { now: NOW })
    expect(topic?.tag).toBe('skew')
    expect(topic?.score).toBeCloseTo(1, 9)
  })

  it('skips a post stamped further ahead than the 15-minute tolerance', () => {
    const justInside = post('inside #Inside', -TRENDING_FUTURE_TOLERANCE_MS)
    const justOutside = post('outside #Outside', -TRENDING_FUTURE_TOLERANCE_MS - 1)
    const farFuture = post('far #Far', -7 * 365 * 24 * HOUR) // a 2033 fixture vs a 2026 clock
    expect(
      computeTrending([justInside, justOutside, farFuture], { now: NOW }).map(t => t.tag),
    ).toEqual(['inside'])
  })

  it('honours a custom tolerance, and Infinity disables the check (the dev mock)', () => {
    const farFuture = post('far #Far', -30 * 24 * HOUR)
    expect(computeTrending([farFuture], { now: NOW, futureToleranceMs: HOUR })).toEqual([])
    const [topic] = computeTrending([farFuture], {
      now: NOW,
      futureToleranceMs: Number.POSITIVE_INFINITY,
    })
    expect(topic).toMatchObject({ tag: 'far', postCount: 1 })
    expect(topic?.score).toBeCloseTo(1, 9) // clamped to age 0
  })

  it('treats a negative tolerance as zero', () => {
    const slightlyAhead = post('ahead #Ahead', -1000)
    expect(computeTrending([slightlyAhead], { now: NOW, futureToleranceMs: -5 })).toEqual([])
  })

  it('ignores posts whose scenarioTime is not a date', () => {
    const bad: TrendingPostInput = { id: 'bad', text: '#Broken', scenarioTime: 'not-a-date' }
    expect(computeTrending([bad], { now: NOW })).toEqual([])
  })

  it('returns [] for a non-finite now or a non-positive window/half-life', () => {
    const posts = [post('x #Water', HOUR)]
    expect(computeTrending(posts, { now: Number.NaN })).toEqual([])
    expect(computeTrending(posts, { now: NOW, windowMs: 0 })).toEqual([])
    expect(computeTrending(posts, { now: NOW, halfLifeMs: -1 })).toEqual([])
  })
})

describe('computeTrending — recency weighting', () => {
  it('halves a post\'s weight every half-life', () => {
    const fresh = computeTrending([post('#Fresh', 0)], { now: NOW })[0]
    const half = computeTrending([post('#Half', TRENDING_HALF_LIFE_MS)], { now: NOW })[0]
    const quarter = computeTrending([post('#Quarter', 2 * TRENDING_HALF_LIFE_MS)], { now: NOW })[0]
    expect(fresh?.score).toBeCloseTo(1, 9)
    expect(half?.score).toBeCloseTo(0.5, 9)
    expect(quarter?.score).toBeCloseTo(0.25, 9)
  })

  it('ranks a tag with fresher posts above an older tag with the same count', () => {
    const topics = computeTrending(
      [post('old #Older', 8 * HOUR), post('new #Newer', 30 * 60 * 1000)],
      { now: NOW },
    )
    expect(topics.map(t => t.tag)).toEqual(['newer', 'older'])
  })

  it('lets volume outweigh age when there is enough of it', () => {
    const topics = computeTrending(
      [
        post('lone #Lone', 10 * 60 * 1000),
        post('a #Crowd', 2 * HOUR),
        post('b #Crowd', 2 * HOUR),
        post('c #Crowd', 2 * HOUR),
      ],
      { now: NOW },
    )
    expect(topics.map(t => t.tag)).toEqual(['crowd', 'lone'])
  })

  it('counts a tag once per post however often it is repeated, and groups by case', () => {
    const [topic, ...rest] = computeTrending(
      [post('#Water water #water #WATER', HOUR), post('again #water', HOUR)],
      { now: NOW },
    )
    expect(rest.map(t => t.tag)).toEqual([])
    expect(topic).toMatchObject({ tag: 'water', postCount: 2 })
  })

  it('shows the casing authors used most', () => {
    const [topic] = computeTrending(
      [
        post('#WaterIssues one', 3 * HOUR),
        post('#WaterIssues two', 2 * HOUR),
        post('#waterissues three', 10 * 60 * 1000),
      ],
      { now: NOW },
    )
    expect(topic).toMatchObject({ tag: 'waterissues', display: '#WaterIssues', postCount: 3 })
  })

  it('reports the newest post time for the tag', () => {
    const newest = new Date(NOW - 30 * 60 * 1000).toISOString()
    const [topic] = computeTrending(
      [post('#Water a', 5 * HOUR), { id: 'n', text: '#Water b', scenarioTime: newest }],
      { now: NOW },
    )
    expect(topic?.latestScenarioTime).toBe(newest)
  })
})

describe('computeTrending — deterministic tie-break', () => {
  it('breaks an exact score+count+recency tie by tag, regardless of input order', () => {
    const at = 2 * HOUR
    const a = post('#Bravo', at)
    const b = post('#Alpha', at)
    const c = post('#Charlie', at)
    const forward = computeTrending([a, b, c], { now: NOW }).map(t => t.tag)
    const reversed = computeTrending([c, b, a], { now: NOW }).map(t => t.tag)
    expect(forward).toEqual(['alpha', 'bravo', 'charlie'])
    expect(reversed).toEqual(forward)
  })

  it('prefers more posts when scores tie, then the more recent tag', () => {
    // Same score by construction: 1 fresh post (1.0) vs 2 posts at one half-life each (0.5 + 0.5).
    const topics = computeTrending(
      [
        post('#Single', 0),
        post('a #Pair', TRENDING_HALF_LIFE_MS),
        post('b #Pair', TRENDING_HALF_LIFE_MS),
      ],
      { now: NOW },
    )
    expect(topics.map(t => t.tag)).toEqual(['pair', 'single'])
  })

  it('gives the same ranking for any ordering of the same feed', () => {
    const feed: TrendingPostInput[] = []
    for (let index = 0; index < 40; index += 1) {
      feed.push(post(`msg #Tag${index % 7} #Shared`, ((index * 37) % 11) * HOUR * 0.9))
    }
    const expected = computeTrending(feed, { now: NOW })
    const shuffled = [...feed].sort((x, y) => (x.id < y.id ? 1 : -1))
    const rotated = [...feed.slice(13), ...feed.slice(0, 13)]
    expect(computeTrending(shuffled, { now: NOW })).toEqual(expected)
    expect(computeTrending(rotated, { now: NOW })).toEqual(expected)
  })
})

describe('computeTrending — soft-deleted posts never contribute', () => {
  it('ignores taken-down and deleted posts entirely', () => {
    const topics = computeTrending(
      [
        post('live #Water', HOUR),
        post('gone #Water #Hidden', HOUR, { status: 'taken-down' }),
        post('gone #Water #AlsoHidden', HOUR, { status: 'deleted' }),
        post('explicitly visible #Power', HOUR, { status: 'visible' }),
      ],
      { now: NOW },
    )
    expect(topics.map(t => [t.tag, t.postCount])).toEqual([
      ['power', 1],
      ['water', 1],
    ])
  })

  it('does not let a deleted post lift a tag above a visible one', () => {
    const topics = computeTrending(
      [
        post('real #Real', 4 * HOUR),
        post('x #Ghost', 0, { status: 'taken-down' }),
        post('y #Ghost', 0, { status: 'taken-down' }),
      ],
      { now: NOW },
    )
    expect(topics.map(t => t.tag)).toEqual(['real'])
  })
})

describe('computeTrending — empty feeds and limits', () => {
  it('returns [] for an empty feed, a feed with no hashtags, and an all-deleted feed', () => {
    expect(computeTrending([], { now: NOW })).toEqual([])
    expect(computeTrending([post('no tags here', HOUR)], { now: NOW })).toEqual([])
    expect(
      computeTrending([post('#Water', HOUR, { status: 'taken-down' })], { now: NOW }),
    ).toEqual([])
  })

  it('does not treat digits-only or embedded # as hashtags (parser rules)', () => {
    expect(computeTrending([post('#2024 C# foo#bar', HOUR)], { now: NOW })).toEqual([])
  })

  it('clamps the limit to 1..10 and defaults to 10', () => {
    const feed = Array.from({ length: 15 }, (_, index) => post(`#T${index}x`, index * 60_000))
    expect(computeTrending(feed, { now: NOW })).toHaveLength(TRENDING_MAX_LIMIT)
    expect(computeTrending(feed, { now: NOW, limit: 3 })).toHaveLength(3)
    expect(computeTrending(feed, { now: NOW, limit: 99 })).toHaveLength(TRENDING_MAX_LIMIT)
    expect(computeTrending(feed, { now: NOW, limit: 0 })).toHaveLength(1)
  })

  it('can require a minimum number of posts', () => {
    const feed = [post('a #Many', HOUR), post('b #Many', HOUR), post('c #Once', HOUR)]
    expect(computeTrending(feed, { now: NOW, minPosts: 2 }).map(t => t.tag)).toEqual(['many'])
  })

  it('handles a burst of 200 posts', () => {
    const feed: TrendingPostInput[] = []
    for (let index = 0; index < 200; index += 1) {
      // 12 tags; tag 0 is by far the busiest and the most recent.
      const tagIndex = index % 4 === 0 ? 0 : (index % 11) + 1
      feed.push(post(`burst message ${index} #Tag${tagIndex}x`, (index % 24) * 20 * 60_000))
    }
    const topics = computeTrending(feed, { now: NOW })
    expect(topics.length).toBeLessThanOrEqual(TRENDING_MAX_LIMIT)
    expect(topics[0]?.tag).toBe('tag0x')
    expect(topics[0]?.postCount).toBe(50)
    // Strictly non-increasing scores: it really is a ranking.
    for (let index = 1; index < topics.length; index += 1) {
      expect(nth(topics, index - 1).score).toBeGreaterThanOrEqual(nth(topics, index).score)
    }
    // Deterministic across runs.
    expect(computeTrending(feed, { now: NOW })).toEqual(topics)
  })
})

describe('trendingTopics — memoization', () => {
  it('returns the SAME array for the same feed array and options', () => {
    const feed = [post('#Memo a', HOUR), post('#Memo b', 2 * HOUR)]
    const first = trendingTopics(feed, { now: NOW })
    expect(trendingTopics(feed, { now: NOW })).toBe(first)
    expect(trendingTopics(feed, { now: new Date(NOW) })).toBe(first)
  })

  it('recomputes when the minute, the options or the feed array changes', () => {
    const feed = [post('#Memo a', HOUR)]
    const first = trendingTopics(feed, { now: NOW })
    expect(trendingTopics(feed, { now: NOW + 60_000 })).not.toBe(first)
    expect(trendingTopics(feed, { now: NOW, limit: 4 })).not.toBe(first)
    expect(trendingTopics([...feed], { now: NOW })).not.toBe(first)
  })

  it('computes the same values as the uncached function', () => {
    const feed = [post('#Memo a', HOUR), post('#Other b', 3 * HOUR)]
    expect(trendingTopics(feed, { now: NOW })).toEqual(computeTrending(feed, { now: NOW }))
  })

  it('stays correct when many option variants are cached for one feed', () => {
    const feed = [post('#Memo a', HOUR)]
    for (let minute = 0; minute < 20; minute += 1) {
      const now = NOW + minute * 60_000
      expect(trendingTopics(feed, { now })).toEqual(computeTrending(feed, { now }))
    }
  })

  it('returns an empty list for invalid options without caching a bad value', () => {
    const feed = [post('#Memo a', HOUR)]
    expect(trendingTopics(feed, { now: Number.NaN })).toEqual([])
    expect(trendingTopics(feed, { now: NOW })).toHaveLength(1)
  })
})

describe('pickDisplayCasing — the casing authors use most', () => {
  it('picks the most-used casing, then the most recent, then code-unit order', () => {
    expect(
      pickDisplayCasing(
        [
          post('#WaterIssues a', 3 * HOUR),
          post('#WaterIssues b', 2 * HOUR),
          post('#waterissues c', 10 * 60 * 1000),
        ],
        'waterissues',
      ),
    ).toBe('#WaterIssues')
    // A tie on count goes to the more recent use.
    expect(
      pickDisplayCasing([post('#Zone2 a', 3 * HOUR), post('#ZONE2 b', HOUR)], 'zone2'),
    ).toBe('#ZONE2')
    // A tie on both goes to code-unit order (uppercase sorts first).
    const at = HOUR
    expect(pickDisplayCasing([post('#zone2', at), post('#Zone2', at)], 'zone2')).toBe('#Zone2')
  })

  it('returns undefined when no post carries the tag, and ignores soft-deleted posts', () => {
    expect(pickDisplayCasing([post('no tags', HOUR)], 'waterissues')).toBeUndefined()
    expect(
      pickDisplayCasing([post('#Ghost', HOUR, { status: 'taken-down' })], 'ghost'),
    ).toBeUndefined()
  })

  it('does not depend on the post order', () => {
    const posts = [post('#A1 x', HOUR), post('#a1 y', 2 * HOUR), post('#A1 z', 3 * HOUR)]
    expect(pickDisplayCasing([...posts].reverse(), 'a1')).toBe(pickDisplayCasing(posts, 'a1'))
  })
})

describe('categoryFor — varied, deterministic, never an authority label', () => {
  it('labels public-safety and weather tags and falls back to a generic trend line', () => {
    expect(categoryFor('waterissues')).toBe('Public safety · Trending')
    expect(categoryFor('BoilWater')).toBe('Public safety · Trending')
    expect(categoryFor('stormwatch')).toBe('Weather · Trending')
    expect(categoryFor('roadclosure')).toBe('Traffic · Trending')
    expect(categoryFor('poweroutage')).toBe('Utilities · Trending')
    expect(['Trending', 'Local · Trending']).toContain(categoryFor('zzz'))
  })

  it('is deterministic for the same tag', () => {
    for (const tag of ['alpha', 'bravo', 'charlie', 'waterissues']) {
      expect(categoryFor(tag)).toBe(categoryFor(tag))
    }
  })

  it('varies across tags and never says "official" or similar', () => {
    const tags = ['waterissues', 'stormwatch', 'roadclosure', 'poweroutage', 'volunteers', 'hello', 'zzz', 'plain', 'q1x', 'abc']
    const labels = new Set(tags.map(categoryFor))
    expect(labels.size).toBeGreaterThan(3)
    for (const label of labels) {
      expect(label).toMatch(/Trending$/)
      expect(label).not.toMatch(/official|verified|promoted|sponsored|recommended/i)
    }
  })

  it('stamps every computed topic with a category', () => {
    const [topic] = computeTrending([post('#WaterIssues', HOUR)], { now: NOW })
    expect(topic?.category).toBe('Public safety · Trending')
    expect(topic?.display).toBe('#WaterIssues')
  })
})
