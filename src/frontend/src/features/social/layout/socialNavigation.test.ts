/**
 * features/social/layout/socialNavigation.test.ts
 * ---------------------------------------------------------------------------
 * The adapter's pure route vocabulary (demo-polish F1): the path builders and the
 * classifier that mirrors the `<Routes>` table. The classifier decides two real
 * behaviors -- which pathnames keep Home mounted, and which are redirect hops the
 * focus rule must ignore -- so its answers are pinned over a battery of paths,
 * including the COR-004 cases (a participant typing a staff path).
 */
import { describe, expect, it } from 'vitest'
import {
  SOCIAL_RESERVED_SEGMENTS,
  THREAD_HANDLE_PLACEHOLDER,
  isReservedSegment,
  isThreadHandle,
  matchSocialRoute,
  normalizeHashtagParam,
  socialPaths,
  type SocialRouteKind,
} from './socialNavigation'

describe('socialPaths', () => {
  it('builds the five in-channel URLs', () => {
    expect(socialPaths.home()).toBe('/home')
    expect(socialPaths.explore()).toBe('/explore')
    expect(socialPaths.hashtag('waterissues')).toBe('/hashtag/waterissues')
    expect(socialPaths.profile('FulcoEM')).toBe('/FulcoEM')
    expect(socialPaths.thread('post-1', 'FulcoEM')).toBe('/FulcoEM/status/post-1')
  })

  it('uses the placeholder handle for a thread opened from a post id alone', () => {
    expect(socialPaths.thread('post-1')).toBe(`/${THREAD_HANDLE_PLACEHOLDER}/status/post-1`)
  })

  it('encodes path-significant characters instead of splicing them in', () => {
    expect(socialPaths.thread('a/b?c#d', 'x')).toBe('/x/status/a%2Fb%3Fc%23d')
    expect(socialPaths.hashtag('a b')).toBe('/hashtag/a%20b')
  })
})

describe('reserved segments (COR-004)', () => {
  it('reserves exactly the routes the channel owns plus the app-level prefixes', () => {
    expect([...SOCIAL_RESERVED_SEGMENTS].sort()).toEqual(
      ['explore', 'hashtag', 'home', 'i', 'login', 'staff'].sort(),
    )
  })

  it('compares case-insensitively', () => {
    expect(isReservedSegment('STAFF')).toBe(true)
    expect(isReservedSegment('Home')).toBe(true)
    expect(isReservedSegment('FulcoEM')).toBe(false)
  })

  it('lets the placeholder (and any ordinary handle) head a thread URL, but not a staff prefix', () => {
    expect(isThreadHandle('i')).toBe(true)
    expect(isThreadHandle('FulcoEM')).toBe(true)
    expect(isThreadHandle('staff')).toBe(false)
    expect(isThreadHandle('explore')).toBe(false)
  })
})

describe('matchSocialRoute', () => {
  const cases: ReadonlyArray<readonly [string, SocialRouteKind]> = [
    ['/home', 'home'],
    ['/HOME', 'home'],
    ['/home/', 'home'],
    ['/explore', 'explore'],
    ['/hashtag/waterissues', 'hashtag'],
    ['/hashtag/%23WaterIssues', 'hashtag'],
    ['/hashtag/caf%C3%A9', 'hashtag'],
    ['/hashtag/%23', 'redirect'],
    ['/hashtag/a%20b', 'redirect'],
    ['/hashtag/%3Cscript%3E', 'redirect'],
    ['/FulcoEM', 'profile'],
    ['/fulcoem', 'profile'],
    ['/FulcoEM/status/post-1', 'thread'],
    ['/i/status/post-1', 'thread'],
    // Redirect hops: root, unknown, and every reserved prefix that is not a route.
    ['/', 'redirect'],
    ['/staff', 'redirect'],
    ['/staff/console', 'redirect'],
    ['/staff/status/1', 'redirect'],
    // An encoded reserved prefix is still reserved: the router decodes before it matches.
    ['/%73taff', 'redirect'],
    ['/%53taff/status/1', 'redirect'],
    ['/login', 'redirect'],
    ['/hashtag', 'redirect'],
    ['/i', 'redirect'],
    ['/a/b/c/d', 'redirect'],
    ['/FulcoEM/followers', 'redirect'],
  ]

  it.each(cases)('%s -> %s', (pathname, expected) => {
    expect(matchSocialRoute(pathname)).toBe(expected)
  })
})

describe('normalizeHashtagParam (the :tag URL segment)', () => {
  it('lower-cases and strips leading #s, exactly as HashtagFeed keys its feed', () => {
    expect(normalizeHashtagParam('WaterIssues')).toBe('waterissues')
    expect(normalizeHashtagParam('#WaterIssues')).toBe('waterissues')
    expect(normalizeHashtagParam('##Zone2')).toBe('zone2')
  })

  it('accepts letters (any script), digits and underscore', () => {
    expect(normalizeHashtagParam('café')).toBe('café')
    expect(normalizeHashtagParam('zone_2')).toBe('zone_2')
    expect(normalizeHashtagParam('2024')).toBe('2024')
  })

  it.each(['', '#', '##', 'a b', 'a-b', 'a.b', 'a/b', '<script>', 'a\nb', 'x'.repeat(101)])(
    'rejects %j (not a hashtag)',
    raw => {
      expect(normalizeHashtagParam(raw)).toBeUndefined()
    },
  )

  it('accepts exactly 100 characters', () => {
    expect(normalizeHashtagParam('x'.repeat(100))).toBe('x'.repeat(100))
  })
})
