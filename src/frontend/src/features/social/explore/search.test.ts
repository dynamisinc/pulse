/**
 * features/social/explore/search.test.ts
 * ---------------------------------------------------------------------------
 * Unit tests for the pure client-side search (demo-polish F6, SOC-042, SOC-052 /
 * D1-008): query parsing, post matching (text + hashtag), the Top / Recent
 * orders, soft-deleted exclusion, and the People match + ordering — including the
 * guarantee that a verified agency and its unverified lookalike are matched and
 * ordered WITHOUT consulting the verified flag (so the platform neither promotes
 * the real account nor demotes the fake).
 */
import { describe, expect, it } from 'vitest'
import { SEEDED_PERSONAS, toParticipantPersona, type Persona } from '@/features/personas'
import type { PostView } from '../components/post/types'
import { nth } from './exploreTestUtils'
import {
  compareRecent,
  compareTop,
  engagementScore,
  parseQuery,
  runSearch,
  searchPeople,
  searchPosts,
  sortPosts,
} from './search'

const DAY = '2033-09-04'

function persona(overrides: Partial<Persona> & Pick<Persona, 'handle' | 'displayName'>): Persona {
  return {
    id: `persona-${overrides.handle.toLowerCase()}`,
    exerciseId: 'ex-test',
    templateId: `tmpl-${overrides.handle.toLowerCase()}`,
    kind: 'org',
    verified: false,
    avatarColor: '#336',
    initials: 'XX',
    audienceBand: 'micro',
    followerCount: 100,
    joinedAt: '2033-01-01T00:00:00Z',
    ...overrides,
  }
}

const AUTHOR = persona({ handle: 'author1', displayName: 'Some Author' })

function post(
  id: string,
  text: string,
  at: string,
  counts: Partial<PostView['counts']> = {},
  extra: object = {},
): PostView {
  return {
    id,
    author: AUTHOR,
    text,
    counts: { reply: 0, repost: 0, like: 0, ...counts },
    scenarioTime: `${DAY}T${at}:00Z`,
    ...extra,
  }
}

describe('parseQuery', () => {
  it('treats blank, #-only and @-only input as empty', () => {
    for (const raw of ['', '   ', '#', ' # ', '@', '@  ']) {
      expect(parseQuery(raw)).toEqual({ kind: 'empty' })
    }
  })

  it('parses text queries into lowercase AND terms and ignores a leading @', () => {
    expect(parseQuery('  Boil   WATER ')).toEqual({
      kind: 'text',
      needle: 'boil water',
      terms: ['boil', 'water'],
    })
    expect(parseQuery('@FairhavenWater')).toEqual({
      kind: 'text',
      needle: 'fairhavenwater',
      terms: ['fairhavenwater'],
    })
  })

  it('parses a leading # as a hashtag query (first word only)', () => {
    expect(parseQuery('#WaterIssues')).toEqual({ kind: 'hashtag', needle: 'waterissues' })
    expect(parseQuery('#water issues')).toEqual({ kind: 'hashtag', needle: 'water' })
  })
})

describe('searchPosts — text and hashtag matching', () => {
  const posts = [
    post('a', 'Boil water advisory for Zones 2-4 #WaterIssues', '10:00'),
    post('b', 'The water main break is fixed', '11:00'),
    post('c', 'Shelter open at the high school #Shelter', '12:00'),
    post('d', 'Totally unrelated', '13:00'),
  ]

  it('matches post text case-insensitively', () => {
    const ids = searchPosts(posts, parseQuery('WATER'), 'recent').map(p => p.id)
    expect(ids).toEqual(['b', 'a'])
  })

  it('requires every term (AND), in any order', () => {
    expect(searchPosts(posts, parseQuery('advisory boil'), 'recent').map(p => p.id)).toEqual(['a'])
    expect(searchPosts(posts, parseQuery('boil shelter'), 'recent')).toEqual([])
  })

  it('matches hashtags by prefix with a # query', () => {
    expect(searchPosts(posts, parseQuery('#water'), 'recent').map(p => p.id)).toEqual(['a'])
    expect(searchPosts(posts, parseQuery('#WaterIssues'), 'recent').map(p => p.id)).toEqual(['a'])
    expect(searchPosts(posts, parseQuery('#shel'), 'recent').map(p => p.id)).toEqual(['c'])
  })

  it('does not let a # query match plain words (it is hashtag-only)', () => {
    expect(searchPosts(posts, parseQuery('#advisory'), 'recent')).toEqual([])
  })

  it('also finds a hashtag from a plain-word query', () => {
    expect(searchPosts(posts, parseQuery('waterissues'), 'recent').map(p => p.id)).toEqual(['a'])
  })

  it('matches nothing for an empty query', () => {
    expect(searchPosts(posts, parseQuery(''), 'recent')).toEqual([])
  })

  it('never returns a soft-deleted post', () => {
    const withGone = [
      ...posts,
      post('gone', 'water water everywhere #WaterIssues', '14:00', {}, { status: 'taken-down' }),
    ]
    expect(searchPosts(withGone, parseQuery('water'), 'recent').map(p => p.id)).toEqual(['b', 'a'])
    expect(searchPosts(withGone, parseQuery('#water'), 'recent').map(p => p.id)).toEqual(['a'])
  })
})

describe('Top / Recent ordering', () => {
  const posts = [
    post('early-low', 'water early', '09:00', { like: 1 }),
    post('mid-high', 'water mid', '10:00', { reply: 5, repost: 5, like: 5 }),
    post('late-zero', 'water late', '11:00'),
    post('late-tie', 'water late tie', '11:00'),
    post('mid-share', 'water share', '10:30', { like: 14, share: 1 }),
  ]

  it('Recent is scenario time descending, ties by id', () => {
    expect(sortPosts(posts, 'recent').map(p => p.id)).toEqual([
      'late-tie',
      'late-zero',
      'mid-share',
      'mid-high',
      'early-low',
    ])
  })

  it('Top is engagement descending (share counts), ties by recency then id', () => {
    expect(engagementScore(nth(posts, 4))).toBe(15)
    expect(sortPosts(posts, 'top').map(p => p.id)).toEqual([
      'mid-share', // 15, later than mid-high
      'mid-high', // 15
      'early-low', // 1
      'late-tie', // 0, tie on time -> id
      'late-zero',
    ])
  })

  it('searchPosts applies the requested order', () => {
    const query = parseQuery('water')
    expect(searchPosts(posts, query, 'recent')[0]?.id).toBe('late-tie')
    expect(searchPosts(posts, query, 'top')[0]?.id).toBe('mid-share')
  })

  it('does not mutate its input, and is deterministic for any input order', () => {
    const snapshot = posts.map(p => p.id)
    const expected = sortPosts(posts, 'top').map(p => p.id)
    sortPosts(posts, 'recent')
    expect(posts.map(p => p.id)).toEqual(snapshot)
    expect(sortPosts([...posts].reverse(), 'top').map(p => p.id)).toEqual(expected)
  })

  it('comparators agree with sortPosts', () => {
    expect([...posts].sort(compareRecent).map(p => p.id)).toEqual(
      sortPosts(posts, 'recent').map(p => p.id),
    )
    expect([...posts].sort(compareTop).map(p => p.id)).toEqual(
      sortPosts(posts, 'top').map(p => p.id),
    )
  })

  it('sorts a post with an unparseable time last in Recent rather than throwing', () => {
    const odd = post('odd', 'water odd', '10:00', {}, { scenarioTime: 'nonsense' })
    expect(sortPosts([odd, ...posts], 'recent').at(-1)?.id).toBe('odd')
  })
})

describe('searchPeople — name and handle, ordered by relevance only', () => {
  const real = persona({
    handle: 'FairhavenWater',
    displayName: 'Fairhaven Water Utility',
    verified: true,
  })
  const fake = persona({
    handle: 'FairhavenWaterUpd',
    displayName: 'Fairhaven Water Update',
    verified: false,
  })
  const other = persona({ handle: 'mvega_fh', displayName: 'Maria Vega', kind: 'human' })
  const county = persona({ handle: 'FulcoEM', displayName: 'Fairhaven County Emergency Mgmt' })
  const cast = [other, fake, county, real]

  it('matches on display name or handle, case-insensitively', () => {
    expect(searchPeople(cast, parseQuery('vega')).map(p => p.handle)).toEqual(['mvega_fh'])
    expect(searchPeople(cast, parseQuery('MARIA')).map(p => p.handle)).toEqual(['mvega_fh'])
    expect(searchPeople(cast, parseQuery('@fulcoem')).map(p => p.handle)).toEqual(['FulcoEM'])
  })

  it('finds nobody for an unmatched, empty or hashtag query', () => {
    expect(searchPeople(cast, parseQuery('zzzz'))).toEqual([])
    expect(searchPeople(cast, parseQuery(''))).toEqual([])
    expect(searchPeople(cast, parseQuery('#fairhaven'))).toEqual([])
  })

  it('orders by relevance: exact handle, handle prefix, name prefix, then containment', () => {
    const cast2 = [
      persona({ handle: 'zeta', displayName: 'The Water Desk' }), // contains
      persona({ handle: 'waterwatch', displayName: 'Watch' }), // handle prefix
      persona({ handle: 'water', displayName: 'Water' }), // exact handle
      persona({ handle: 'aqua', displayName: 'Water Works' }), // name prefix
    ]
    expect(searchPeople(cast2, parseQuery('water')).map(p => p.handle)).toEqual([
      'water',
      'waterwatch',
      'aqua',
      'zeta',
    ])
  })

  it('puts the verified agency and its unverified lookalike side by side', () => {
    const handles = searchPeople(cast, parseQuery('fairhaven water')).map(p => p.handle)
    expect(handles).toEqual(['FairhavenWater', 'FairhavenWaterUpd'])
    const wide = searchPeople(cast, parseQuery('fairhaven')).map(p => p.handle)
    const at = wide.indexOf('FairhavenWater')
    expect(wide[at + 1]).toBe('FairhavenWaterUpd')
  })

  it('NEVER consults the verified flag: flipping it leaves the order unchanged', () => {
    const baseline = searchPeople(cast, parseQuery('fairhaven')).map(p => p.id)
    const flipped = cast.map(p => ({ ...p, verified: !p.verified }))
    expect(searchPeople(flipped, parseQuery('fairhaven')).map(p => p.id)).toEqual(baseline)
    const allVerified = cast.map(p => ({ ...p, verified: true }))
    expect(searchPeople(allVerified, parseQuery('fairhaven')).map(p => p.id)).toEqual(baseline)
    const noneVerified = cast.map(p => ({ ...p, verified: false }))
    expect(searchPeople(noneVerified, parseQuery('fairhaven')).map(p => p.id)).toEqual(baseline)
  })

  it('does not depend on kind or follower counts either', () => {
    const baseline = searchPeople(cast, parseQuery('fairhaven')).map(p => p.id)
    const shuffled = cast.map((p, index) => ({
      ...p,
      kind: index % 2 === 0 ? ('human' as const) : ('org' as const),
      followerCount: 1_000_000 - index * 1000,
    }))
    expect(searchPeople(shuffled, parseQuery('fairhaven')).map(p => p.id)).toEqual(baseline)
  })

  it('is deterministic for any input order', () => {
    const baseline = searchPeople(cast, parseQuery('fairhaven')).map(p => p.id)
    expect(searchPeople([...cast].reverse(), parseQuery('fairhaven')).map(p => p.id)).toEqual(
      baseline,
    )
  })

  it('works over the real seeded cast (participant projection)', () => {
    const seeded = SEEDED_PERSONAS.map(toParticipantPersona)
    const handles = searchPeople(seeded, parseQuery('fairhaven water')).map(p => p.handle)
    expect(handles).toEqual(['FairhavenWater', 'FairhavenWaterUpd'])
    const [first, second] = searchPeople(seeded, parseQuery('fairhaven water'))
    expect(first?.verified).toBe(true)
    expect(second?.verified).toBe(false)
  })
})

describe('runSearch', () => {
  const posts = [post('a', 'Boil water #WaterIssues', '10:00'), post('b', 'Hello', '11:00')]
  const cast = [persona({ handle: 'wateruser', displayName: 'Water User' })]

  it('returns posts and people for a text query', () => {
    const results = runSearch({ posts, personas: cast, query: 'water', sort: 'recent' })
    expect(results.query.kind).toBe('text')
    expect(results.posts.map(p => p.id)).toEqual(['a'])
    expect(results.people.map(p => p.handle)).toEqual(['wateruser'])
  })

  it('returns only posts for a hashtag query', () => {
    const results = runSearch({ posts, personas: cast, query: '#water', sort: 'recent' })
    expect(results.query.kind).toBe('hashtag')
    expect(results.posts.map(p => p.id)).toEqual(['a'])
    expect(results.people).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    const results = runSearch({ posts, personas: cast, query: '  ', sort: 'top' })
    expect(results.query.kind).toBe('empty')
    expect(results.posts).toEqual([])
    expect(results.people).toEqual([])
  })
})
