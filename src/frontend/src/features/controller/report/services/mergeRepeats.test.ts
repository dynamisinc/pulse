/**
 * features/controller/report/services/mergeRepeats.test.ts
 * ---------------------------------------------------------------------------
 * Story 34 (DF-50): identical engine repeats in a half-hour group print once, standing for all
 * of them; every protected post (participant, controller-as-persona, scripted, engagement,
 * media, edited, taken down, thread member) keeps its own card, and nothing is dropped.
 */
import { describe, expect, it } from 'vitest'
import type { ReportPost } from '../types/report'
import { isMergeable, mergeRepeats, repeatsLabel } from './reportFormat'

const TOM = { handle: '@tbrandt41', displayName: 'Tom Brandt', verified: false, avatarUrl: null }
const MARISOL = { handle: '@mvega_fh', displayName: 'Marisol Vega', verified: false, avatarUrl: null }

function post(id: string, at: string, overrides: Partial<ReportPost> = {}): ReportPost {
  return {
    id,
    scenarioAt: `2026-10-15 ${at}`,
    scenarioTime: at,
    author: TOM,
    source: 'engine',
    postedBy: null,
    injectRef: null,
    replyToHandle: null,
    parentPostId: null,
    text: 'anyone else smell it?',
    media: [],
    likes: 0,
    reposts: 0,
    replies: 0,
    pinnedForAll: false,
    takenDownAt: null,
    editCount: 0,
    lastEditedAt: null,
    threadRootId: id,
    depth: 0,
    ...overrides,
  }
}

const ids = (entries: ReturnType<typeof mergeRepeats>) =>
  entries.map(entry => `${entry.post.id}×${entry.repeats.length}`)

describe('mergeRepeats (DF-50)', () => {
  it('merges interleaved repeats by author and text, at the first one\'s position', () => {
    const posts = [
      post('a1', '14:45'),
      post('b1', '14:45', { author: MARISOL, text: 'sold out' }),
      post('a2', '14:46'),
      post('b2', '14:47', { author: MARISOL, text: 'sold out' }),
      post('c1', '14:47', { author: MARISOL, text: 'something else' }),
      post('a3', '14:49'),
    ]
    const entries = mergeRepeats(posts, new Set())
    expect(ids(entries)).toEqual(['a1×3', 'b1×2', 'c1×1'])
    expect(entries[0]?.repeats.map(p => p.id)).toEqual(['a1', 'a2', 'a3'])
    // Nothing is dropped.
    expect(entries.flatMap(entry => entry.repeats)).toHaveLength(posts.length)
  })

  it('never merges the same text from two different authors', () => {
    const entries = mergeRepeats([post('a', '14:45'), post('b', '14:45', { author: MARISOL })], new Set())
    expect(ids(entries)).toEqual(['a×1', 'b×1'])
  })

  it.each<[string, Partial<ReportPost>]>([
    ['a participant post', { source: 'participant' }],
    ['a controller-as-persona post', { source: 'controller-as-persona' }],
    ['a scripted inject post', { source: 'scripted' }],
    ['a liked post', { likes: 1 }],
    ['a reposted post', { reposts: 1 }],
    ['a post with replies', { replies: 1 }],
    ['an edited post', { editCount: 1, lastEditedAt: '2026-10-15 14:50' }],
    ['a taken-down post', { takenDownAt: '2026-10-15 14:50' }],
    ['a reply (even to an unlisted parent)', { parentPostId: 'gone', replyToHandle: '@x' }],
    ['a post carrying an inject ref', { injectRef: 'INJ-9' }],
    ['a post with media', {
      media: [{ kind: 'image', url: null, alt: 'x', durationSec: null, width: null, height: null }],
    }],
  ])('keeps %s as its own card', (_case, overrides) => {
    const entries = mergeRepeats([post('a', '14:45', overrides), post('b', '14:46', overrides)], new Set())
    expect(ids(entries)).toEqual(['a×1', 'b×1'])
  })

  it('keeps thread members whole: a listed root and its nested reply', () => {
    const root = post('root', '14:45')
    const reply = post('reply', '14:46', { threadRootId: 'root', depth: 1 })
    const twin = post('twin', '14:47') // the root's twin is still mergeable on its own, but not into the root
    const entries = mergeRepeats([root, reply, twin], new Set(['reply']))
    expect(ids(entries)).toEqual(['root×1', 'reply×1', 'twin×1'])
    expect(isMergeable(root, new Set(['root']))).toBe(false)
  })
})

describe('repeatsLabel (DF-50, NFR-001: the count is in words)', () => {
  const run = [post('a', '14:45'), post('b', '14:46'), post('c', '14:49')]

  it('states the count and the span', () => {
    expect(repeatsLabel(run, false)).toBe('Posted 3 times, 14:45–14:49')
    expect(repeatsLabel(run, true)).toBe('Posted 3 times, 15 Oct 14:45–14:49')
  })

  it('says "at" when every repeat shares a minute, and dates both ends across midnight', () => {
    expect(repeatsLabel([post('a', '14:45'), post('b', '14:45')], false)).toBe('Posted 2 times at 14:45')
    const late = post('x', '23:59')
    const early = { ...post('y', '00:01'), scenarioAt: '2026-10-16 00:01' }
    expect(repeatsLabel([late, early], true)).toBe('Posted 2 times, 15 Oct 23:59–16 Oct 00:01')
  })
})
