/**
 * features/social/notifications/notificationModel.test.ts
 * ---------------------------------------------------------------------------
 * The derivation (demo-polish F7, story 16 "Derived items" + "Live and calm" aggregation):
 * replies to my posts, @mentions of my handle, like-count increases on my posts; the
 * first-load baseline; aggregation by (type, subject post); removal; read state and its
 * persistence round-trip; and the cost shape under a burst. Pure model -- no React, no store.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ParticipantPostView } from '../types/post'
import {
  NotificationModel,
  mentionMatcher,
  toExcerpt,
  type NotificationModelOptions,
} from './notificationModel'
import { EMPTY_PERSISTED } from './notificationStorage'
import { describeItem } from './notificationText'
import {
  EXCERPT_MAX_LENGTH,
  GROUPS_CAP,
  MENTION_STORM_THRESHOLD,
  MENTION_STORM_WINDOW_MS,
  MINE_CAP,
  READ_IDS_CAP,
  type NotificationItem,
} from './notificationTypes'

const ME = 'persona-dreyes_fh'
const HANDLE = 'dreyes_fh'
const ALEX = 'persona-alex'
const SAM = 'persona-sam'
const KIM = 'persona-kim'

interface PostInput {
  readonly id: string
  readonly by?: string
  readonly text?: string
  readonly at?: string
  readonly like?: number
  readonly replyTo?: { readonly postId: string; readonly authorHandle: string }
}

function post(input: PostInput): ParticipantPostView {
  return {
    id: input.id,
    authorPersonaId: input.by ?? ALEX,
    text: input.text ?? 'plain text',
    scenarioTime: input.at ?? '2033-09-04T14:00:00.000Z',
    counts: { reply: 0, repost: 0, like: input.like ?? 0 },
    ...(input.replyTo !== undefined ? { inReplyTo: input.replyTo } : {}),
  }
}

/** One of my posts. */
const mine = (id: string, like = 0, at = '2033-09-04T12:00:00.000Z'): ParticipantPostView =>
  post({ id, by: ME, like, at, text: `My post ${id}` })

/** A reply to one of my posts. */
const replyTo = (id: string, parentId: string, by = ALEX, at = '2033-09-04T14:00:00.000Z') =>
  post({ id, by, at, text: `Reply ${id}`, replyTo: { postId: parentId, authorHandle: HANDLE } })

const EIGHT_AM = Date.UTC(2033, 8, 4, 8, 0, 0)

/**
 * A distinct, increasing scenario instant for the n-th event, TWO MINUTES apart from 08:00Z --
 * further apart than the mention-storm window, so a run of mentions stays a run of rows.
 */
function tick(n: number): string {
  return new Date(EIGHT_AM + n * 120_000).toISOString()
}

/** The n-th second after 08:00Z: events this close together are a burst (one storm window). */
function sec(n: number): string {
  return new Date(EIGHT_AM + n * 1000).toISOString()
}

interface Harness {
  readonly model: NotificationModel
  readonly removed: Set<string>
  setNow(iso: string): void
}

function harness(over: Partial<NotificationModelOptions> = {}): Harness {
  let nowIso = '2033-09-04T15:00:00.000Z'
  const removed = new Set<string>()
  const model = new NotificationModel({
    selfPersonaId: ME,
    selfHandle: HANDLE,
    persisted: EMPTY_PERSISTED,
    now: () => nowIso,
    isRemoved: id => removed.has(id),
    ...over,
  })
  return { model, removed, setNow: iso => { nowIso = iso } }
}

function only(items: readonly NotificationItem[]): NotificationItem {
  expect(items).toHaveLength(1)
  const [item] = items
  if (item === undefined) throw new Error('unreachable')
  return item
}

describe('nothing is fabricated', () => {
  it('an empty model has no rows', () => {
    expect(harness().model.items()).toEqual([])
  })

  it('a feed with no replies to me, no mention and no likes derives nothing', () => {
    const { model } = harness()
    model.ingestBatch([
      mine('m1'),
      post({ id: 'o1', text: 'weather update' }),
      post({ id: 'o2', replyTo: { postId: 'someone-elses', authorHandle: 'zed' } }),
    ])
    expect(model.items()).toEqual([])
  })
})

describe('(a) replies to my posts', () => {
  it('derives an unread reply row about MY post, with the replier and an excerpt', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), replyTo('r1', 'm1', ALEX, '2033-09-04T14:05:00.000Z')])
    expect(only(model.items())).toEqual({
      id: 'reply:m1',
      type: 'reply',
      subjectPostId: 'm1',
      subjectHandle: HANDLE,
      at: '2033-09-04T14:05:00.000Z',
      unread: true,
      count: 1,
      actorIds: [ALEX],
      actorCount: 1,
      excerpt: 'Reply r1',
    })
  })

  it('ignores a reply to a post that is not mine', () => {
    const { model } = harness()
    model.ingestBatch([post({ id: 'x', by: SAM }), replyTo('r1', 'x')])
    expect(model.items()).toEqual([])
  })

  it('finds a reply even when the feed lists it BEFORE its (older) parent', () => {
    const { model } = harness()
    // Newest-first, as a feed is: the reply precedes the post it answers.
    model.ingestBatch([replyTo('r1', 'm1'), mine('m1')])
    expect(only(model.items()).type).toBe('reply')
  })

  it('never notifies me about my own reply under my own post', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), replyTo('r-self', 'm1', ME)])
    expect(model.items()).toEqual([])
  })

  it('is idempotent: re-offering a reply (echo, re-read) does not count it twice', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), replyTo('r1', 'm1')])
    const again = model.ingest(replyTo('r1', 'm1'))
    expect(again.changed).toBe(false)
    expect(only(model.items()).count).toBe(1)
  })
})

describe('(b) @mentions of my handle', () => {
  it.each([
    ['@dreyes_fh are you safe?', true],
    ['thanks @DREYES_FH!', true],
    ['(@dreyes_fh)', true],
    ['cc @dreyes_fh, @zed', true],
    ['end of sentence @dreyes_fh.', true],
    ['line one\n@Dreyes_Fh', true],
    ['@dreyes_fhx is someone else', false],
    ['@dreyes is someone else', false],
    ['mail me@dreyes_fh.org', false],
    ['dreyes_fh without the at sign', false],
    ['@@dreyes_fh', false],
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(mentionMatcher(HANDLE)(text)).toBe(expected)
  })

  it('treats regex characters in a handle literally and an empty handle as matching nothing', () => {
    expect(mentionMatcher('a.b')('@a.b yes')).toBe(true)
    expect(mentionMatcher('a.b')('@axb no')).toBe(false)
    expect(mentionMatcher('')('@ nothing')).toBe(false)
    expect(mentionMatcher('@dreyes_fh')('@dreyes_fh')).toBe(true)
  })

  it('derives a mention row whose subject is the mentioning post itself', () => {
    const { model } = harness()
    model.ingest(post({ id: 'p1', by: KIM, text: 'hello @dreyes_fh', at: '2033-09-04T14:10:00.000Z' }))
    expect(only(model.items())).toMatchObject({
      id: 'mention:p1',
      type: 'mention',
      subjectPostId: 'p1',
      subjectHandle: undefined,
      unread: true,
      count: 1,
      actorIds: [KIM],
    })
  })

  it('groups mentions that are replies under the SAME post into one row about that post', () => {
    const { model } = harness()
    const parent = { postId: 'someone-elses', authorHandle: 'zed' }
    model.ingest(post({ id: 'p1', by: ALEX, text: '@dreyes_fh one', replyTo: parent }))
    model.ingest(post({ id: 'p2', by: SAM, text: '@dreyes_fh two', replyTo: parent }))
    const row = only(model.items())
    expect(row).toMatchObject({
      id: 'mention:someone-elses',
      subjectPostId: 'someone-elses',
      subjectHandle: 'zed',
      count: 2,
      actorCount: 2,
    })
  })

  it('never notifies me about a post of my own that names me', () => {
    const { model } = harness()
    model.ingest(post({ id: 'p1', by: ME, text: 'note to self @dreyes_fh' }))
    expect(model.items()).toEqual([])
  })

  it('a reply to my post that also names me is ONE row, a reply', () => {
    const { model } = harness()
    model.ingestBatch([
      mine('m1'),
      post({
        id: 'r1',
        text: 'thanks @dreyes_fh',
        replyTo: { postId: 'm1', authorHandle: HANDLE },
      }),
    ])
    expect(only(model.items()).type).toBe('reply')
  })
})

describe('(c) like-count increases on my posts', () => {
  it('the FIRST load sets the baseline: existing likes are not retroactive new likes', () => {
    const { model } = harness()
    const events = model.ingestBatch([mine('m1', 12), mine('m2', 3)])
    expect(model.items()).toEqual([])
    expect(events).toEqual([])
  })

  it('a later rise becomes ONE aggregated row, dated by when the rise was seen', () => {
    const { model, setNow } = harness()
    model.ingestBatch([mine('m1', 12)])
    setNow('2033-09-04T15:20:00.000Z')
    const events = model.ingestBatch([mine('m1', 15)])
    expect(events).toEqual([{ type: 'like', amount: 3 }])
    expect(only(model.items())).toMatchObject({
      id: 'like:m1',
      type: 'like',
      subjectPostId: 'm1',
      subjectHandle: HANDLE,
      count: 3,
      unread: true,
      at: '2033-09-04T15:20:00.000Z',
      actorIds: [],
      actorCount: 0,
      excerpt: 'My post m1',
    })
  })

  it('further rises accumulate on the same row and keep it ONE row', () => {
    const { model, setNow } = harness()
    model.ingestBatch([mine('m1', 10)])
    setNow('2033-09-04T15:10:00.000Z')
    model.ingestBatch([mine('m1', 12)])
    setNow('2033-09-04T15:40:00.000Z')
    model.ingestBatch([mine('m1', 17)])
    const row = only(model.items())
    expect(row.count).toBe(7)
    expect(row.at).toBe('2033-09-04T15:40:00.000Z')
  })

  it('re-reading an unchanged count adds nothing', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 10)])
    model.ingestBatch([mine('m1', 13)])
    expect(model.ingestBatch([mine('m1', 13)])).toEqual([])
    expect(only(model.items()).count).toBe(3)
  })

  it('an unlike follows the baseline down so a later like still counts', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 10)])
    model.ingestBatch([mine('m1', 7)]) // three unlikes: below the baseline
    expect(model.items()).toEqual([])
    model.ingestBatch([mine('m1', 9)])
    expect(only(model.items()).count).toBe(2)
  })

  it('one row per post of mine, and none for a post that did not rise', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 1), mine('m2', 1), mine('m3', 1)])
    model.ingestBatch([mine('m1', 4), mine('m2', 1), mine('m3', 2)])
    const rows = model.items()
    expect(rows.map(row => row.id).sort()).toEqual(['like:m1', 'like:m3'])
  })

  it('a post first seen mid-session (one just published) starts at its own count', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 5)])
    model.ingest(mine('fresh', 0))
    expect(model.items()).toEqual([])
    model.ingestBatch([mine('fresh', 2)])
    expect(model.items().map(row => [row.id, row.count])).toEqual([['like:fresh', 2]])
  })

  it('likes by other people on THEIR posts are ignored', () => {
    const { model } = harness()
    model.ingestBatch([post({ id: 'o1', by: SAM, like: 1 })])
    model.ingest(post({ id: 'o1', by: SAM, like: 50 }))
    expect(model.items()).toEqual([])
  })
})

describe('aggregation (same subject post, same type)', () => {
  it('a burst of replies to one post is ONE row with the count and the newest actors', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    const actors = [ALEX, SAM, KIM]
    for (let index = 0; index < 120; index += 1) {
      const minute = String(index % 60).padStart(2, '0')
      model.ingest(replyTo(`r${index}`, 'm1', actors[index % 3] ?? ALEX, `2033-09-04T14:${minute}:00.000Z`))
    }
    const row = only(model.items())
    expect(row.count).toBe(120)
    expect(row.actorCount).toBe(3)
    expect(row.actorIds).toHaveLength(2) // the preview is capped
  })

  it('previews the NEWEST distinct actors first', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    model.ingest(replyTo('r1', 'm1', ALEX, '2033-09-04T14:01:00.000Z'))
    model.ingest(replyTo('r2', 'm1', SAM, '2033-09-04T14:03:00.000Z'))
    model.ingest(replyTo('r3', 'm1', KIM, '2033-09-04T14:02:00.000Z'))
    model.ingest(replyTo('r4', 'm1', ALEX, '2033-09-04T14:04:00.000Z'))
    expect(only(model.items()).actorIds).toEqual([ALEX, SAM])
  })

  it('different subject posts stay separate rows', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), mine('m2'), replyTo('r1', 'm1'), replyTo('r2', 'm2')])
    expect(model.items().map(row => row.id).sort()).toEqual(['reply:m1', 'reply:m2'])
  })

  it('a reply row and a like row about the same post are different types, so two rows', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 0), replyTo('r1', 'm1')])
    model.ingestBatch([mine('m1', 4)])
    expect(model.items().map(row => row.id).sort()).toEqual(['like:m1', 'reply:m1'])
  })
})

describe('ordering and identity', () => {
  it('lists rows newest first by scenario time, even for backdated arrivals', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), mine('m2'), mine('m3')])
    model.ingest(replyTo('r1', 'm1', ALEX, '2033-09-04T14:10:00.000Z'))
    model.ingest(replyTo('r2', 'm2', ALEX, '2033-09-04T14:30:00.000Z'))
    // Arrives LAST but is backdated to the middle: still sorted by its scenario time.
    model.ingest(replyTo('r3', 'm3', ALEX, '2033-09-04T14:20:00.000Z'))
    expect(model.items().map(row => row.subjectPostId)).toEqual(['m2', 'm3', 'm1'])
  })

  it('hands back the SAME object for a row that did not change', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), mine('m2'), replyTo('r1', 'm1'), replyTo('r2', 'm2')])
    const before = model.items()
    model.ingest(replyTo('r3', 'm1', SAM, '2033-09-04T14:30:00.000Z'))
    const after = model.items()
    const find = (rows: readonly NotificationItem[], id: string) => rows.find(row => row.id === id)
    expect(find(after, 'reply:m2')).toBe(find(before, 'reply:m2'))
    expect(find(after, 'reply:m1')).not.toBe(find(before, 'reply:m1'))
    expect(find(after, 'reply:m1')?.count).toBe(2)
  })

  it('carries only participant-safe data: no provenance can appear on a row (XC-002)', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), replyTo('r1', 'm1')])
    model.ingestBatch([mine('m1', 3)])
    for (const row of model.items()) {
      expect(Object.keys(row).sort()).toEqual([
        'actorCount', 'actorIds', 'at', 'count', 'excerpt', 'id', 'subjectHandle',
        'subjectPostId', 'type', 'unread',
      ])
    }
  })
})

describe('excerpts', () => {
  it('collapses whitespace and truncates to the limit with an ellipsis', () => {
    expect(toExcerpt('  a \n\n b\tc  ')).toBe('a b c')
    const long = 'x'.repeat(400)
    const cut = toExcerpt(long)
    expect(cut.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH)
    expect(cut.endsWith('…')).toBe(true)
    expect(toExcerpt('short')).toBe('short')
  })
})

describe('taken-down posts', () => {
  it('a removed reply leaves its row (and the row goes when it was the last)', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1'), replyTo('r1', 'm1'), replyTo('r2', 'm1', SAM)])
    expect(model.remove('r1')).toBe(true)
    expect(only(model.items()).count).toBe(1)
    expect(model.remove('r2')).toBe(true)
    expect(model.items()).toEqual([])
  })

  it('a removed post of mine takes its like row AND the replies under it with it', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 0), replyTo('r1', 'm1')])
    model.ingestBatch([mine('m1', 5)])
    expect(model.items()).toHaveLength(2)
    expect(model.remove('m1')).toBe(true)
    expect(model.items()).toEqual([])
  })

  it('a removed mention (or the post a mention replies to) leaves the list', () => {
    const { model } = harness()
    model.ingest(post({ id: 'p1', text: '@dreyes_fh hi' }))
    expect(model.remove('p1')).toBe(true)
    expect(model.items()).toEqual([])

    model.ingest(post({ id: 'p2', text: '@dreyes_fh hi', replyTo: { postId: 'par', authorHandle: 'z' } }))
    expect(model.remove('par')).toBe(true)
    expect(model.items()).toEqual([])
  })

  it('a post that is already taken down is never ingested', () => {
    const { model, removed } = harness()
    removed.add('r1')
    model.ingestBatch([mine('m1'), replyTo('r1', 'm1')])
    expect(model.items()).toEqual([])
  })

  it('removing something it never held changes nothing', () => {
    expect(harness().model.remove('unknown')).toBe(false)
  })
})

describe('read state', () => {
  let h: Harness
  beforeEach(() => {
    h = harness()
    h.model.ingestBatch([mine('m1', 2), replyTo('r1', 'm1')])
    h.model.ingest(post({ id: 'p1', by: KIM, text: '@dreyes_fh', at: '2033-09-04T14:40:00.000Z' }))
    h.model.ingestBatch([mine('m1', 6)])
  })

  it('starts with every derived row unread', () => {
    const rows = h.model.items()
    expect(rows.map(row => row.type).sort()).toEqual(['like', 'mention', 'reply'])
    expect(rows.every(row => row.unread)).toBe(true)
  })

  it('"mark all read" reads every row but keeps them listed (like count preserved)', () => {
    h.model.markAllRead()
    const rows = h.model.items()
    expect(rows).toHaveLength(3)
    expect(rows.every(row => !row.unread)).toBe(true)
    expect(rows.find(row => row.type === 'like')?.count).toBe(4)
  })

  it('likes after "mark all read" count only the NEW ones, as a fresh unread row', () => {
    h.model.markAllRead()
    h.model.ingestBatch([mine('m1', 8)])
    const like = h.model.items().find(row => row.type === 'like')
    expect(like).toMatchObject({ unread: true, count: 2 })
  })

  it('a reply arriving after "mark all read" makes ITS row unread again', () => {
    h.model.markAllRead()
    const result = h.model.ingest(replyTo('r2', 'm1', SAM))
    expect(result.event).toEqual({ type: 'reply', amount: 1 })
    const reply = h.model.items().find(row => row.type === 'reply')
    expect(reply).toMatchObject({ unread: true, count: 2 })
  })

  it('reports dirtiness once so the store writes only when something changed', () => {
    h.model.takeDirty()
    expect(h.model.takeDirty()).toBe(false)
    h.model.markAllRead()
    expect(h.model.takeDirty()).toBe(true)
    expect(h.model.takeDirty()).toBe(false)
  })

  it('remembers at most READ_IDS_CAP read events (the oldest are forgotten first)', () => {
    const big = harness()
    big.model.ingest(mine('m1'))
    for (let index = 0; index < READ_IDS_CAP + 25; index += 1) {
      big.model.ingest(replyTo(`r${index}`, 'm1'))
    }
    big.model.markAllRead()
    const persisted = big.model.toPersisted()
    expect(persisted.readIds).toHaveLength(READ_IDS_CAP)
    expect(persisted.readIds).toContain(`r${READ_IDS_CAP + 24}`)
    expect(persisted.readIds).not.toContain('r0')
  })
})

describe('"Mark all read" never leaves an old event unread (W-1)', () => {
  it('clears every row after MORE than READ_IDS_CAP events, in one group', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    // Oldest first: the old cap evicted from the FRONT, i.e. exactly the oldest events.
    for (let index = 0; index < READ_IDS_CAP + 20; index += 1) {
      const minute = String(Math.floor(index / 60) % 60).padStart(2, '0')
      const second = String(index % 60).padStart(2, '0')
      model.ingest(replyTo(`r${index}`, 'm1', ALEX, `2033-09-04T14:${minute}:${second}.000Z`))
    }
    expect(only(model.items()).unread).toBe(true)

    model.markAllRead()

    expect(model.items().every(item => !item.unread)).toBe(true)
  })

  it('clears every row after more than READ_IDS_CAP events across many groups', () => {
    const { model } = harness()
    for (let index = 0; index < READ_IDS_CAP + 40; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    model.markAllRead()
    expect(model.items().every(item => !item.unread)).toBe(true)
  })

  it('still WRITES at most READ_IDS_CAP ids, the newest', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    for (let index = 0; index < READ_IDS_CAP + 40; index += 1) {
      model.ingest(replyTo(`r${index}`, 'm1', ALEX, tick(index)))
    }
    model.markAllRead()
    const written = model.toPersisted().readIds
    expect(written).toHaveLength(READ_IDS_CAP)
    expect(written.at(-1)).toBe(`r${READ_IDS_CAP + 39}`)
    // ... without touching the live set: the model itself still reads everything as read.
    expect(model.items().every(item => !item.unread)).toBe(true)
  })
})

/** A top-level mention of me, by author `by`, at the given instant. */
const mention = (id: string, at: string, by = ALEX): ParticipantPostView =>
  post({ id, by, at, text: `@${HANDLE} help (${id})` })

describe('mention storms fold into ONE row (SOC-071, W-1)', () => {
  it('keeps one row per mention up to the threshold, even inside one window', () => {
    const { model } = harness()
    for (let index = 0; index < MENTION_STORM_THRESHOLD; index += 1) {
      model.ingest(mention(`p${index}`, sec(index)))
    }
    const rows = model.items()
    expect(rows).toHaveLength(MENTION_STORM_THRESHOLD)
    expect(rows.every(row => row.count === 1)).toBe(true)
  })

  it('folds into ONE storm row once MORE than the threshold arrive inside the window', () => {
    const { model } = harness()
    for (let index = 0; index <= MENTION_STORM_THRESHOLD; index += 1) {
      model.ingest(mention(`p${index}`, sec(index), `persona-${index}`))
    }
    const row = only(model.items())
    expect(row).toMatchObject({ type: 'mention', count: MENTION_STORM_THRESHOLD + 1, unread: true })
    expect(row.actorCount).toBe(MENTION_STORM_THRESHOLD + 1)
  })

  it('120 mentions in a burst are ONE unread group that reads "Keisha and 41 others mentioned you"', () => {
    const { model } = harness()
    const events: Array<{ type: string; amount: number }> = []
    for (let index = 0; index < 120; index += 1) {
      const result = model.ingest(mention(`p${index}`, sec(index % 59), `persona-${index % 42}`))
      if (result.event !== undefined) events.push(result.event)
    }
    const row = only(model.items())
    expect(row.count).toBe(120)
    expect(row.actorCount).toBe(42)
    expect(row.unread).toBe(true)
    expect(describeItem(row, ['Keisha Ward', 'Tom Brandt'])).toBe(
      'Keisha Ward and 41 others mentioned you',
    )
    // Every mention is still a thing to announce: the throttle (not the model) folds them.
    expect(events).toHaveLength(120)
    expect(events.every(event => event.type === 'mention' && event.amount === 1)).toBe(true)
  })

  it('opens the NEWEST mention of the storm, whose author is the first previewed actor', () => {
    const { model } = harness()
    for (let index = 0; index < 10; index += 1) {
      model.ingest(mention(`p${index}`, sec(index), `persona-${index}`))
    }
    const row = only(model.items())
    expect(row.subjectPostId).toBe('p9')
    expect(row.actorIds[0]).toBe('persona-9')
    expect(row.at).toBe(sec(9))
  })

  it('keeps three SPREAD-OUT mentions as three rows', () => {
    const { model } = harness()
    model.ingest(mention('p1', tick(0)))
    model.ingest(mention('p2', tick(5)))
    model.ingest(mention('p3', tick(10)))
    expect(model.items().map(row => row.subjectPostId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('does not call a slow trickle a storm: one a minute for an hour is sixty rows', () => {
    const { model } = harness()
    for (let index = 0; index < 60; index += 1) {
      model.ingest(mention(`p${index}`, new Date(EIGHT_AM + index * 61_000).toISOString()))
    }
    expect(model.items()).toHaveLength(60)
  })

  it('two bursts far apart are two storms', () => {
    const { model } = harness()
    const half = (index: number) => new Date(EIGHT_AM + 30 * 60_000 + index * 1000).toISOString()
    for (let index = 0; index < 8; index += 1) model.ingest(mention(`a${index}`, sec(index)))
    for (let index = 0; index < 9; index += 1) model.ingest(mention(`b${index}`, half(index)))
    expect(model.items().map(row => row.count).sort()).toEqual([8, 9])
  })

  it('ROLLS: a storm absorbs mentions within a window of it, and a gap ends it', () => {
    const { model } = harness()
    for (let index = 0; index < 6; index += 1) model.ingest(mention(`s${index}`, sec(index)))
    expect(model.items()).toHaveLength(1) // the storm
    // 50 s after the newest member (+55 s), then again 50 s after that: still the same burst.
    model.ingest(mention('t1', sec(55)))
    model.ingest(mention('t2', sec(105)))
    expect(only(model.items()).count).toBe(8)
    // A 100 s lull: this one is NOT part of it -- a row of its own.
    model.ingest(mention('later', sec(205)))
    const rows = model.items()
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.subjectPostId === 'later')?.count).toBe(1)
  })

  it('is the same whichever order the mentions are offered in (feed read vs. stream)', () => {
    const forward = harness()
    const backward = harness()
    const batch = Array.from({ length: 40 }, (_, index) =>
      mention(`p${index}`, sec(index), `persona-${index % 9}`))
    for (const item of batch) forward.model.ingest(item)
    backward.model.ingestBatch([...batch].reverse()) // a feed is newest-first
    const a = only(forward.model.items())
    const b = only(backward.model.items())
    expect(b).toMatchObject({ count: a.count, actorCount: a.actorCount, at: a.at })
  })

  it('merges two storms that a later mention bridges', () => {
    const { model } = harness()
    for (let index = 0; index < 6; index += 1) model.ingest(mention(`b${index}`, sec(100 + index)))
    for (let index = 0; index < 6; index += 1) model.ingest(mention(`a${index}`, sec(index)))
    expect(model.items()).toHaveLength(2) // 100 s apart: two storms
    model.ingest(mention('bridge', sec(52))) // within a window of A, whose edge then reaches B
    const row = only(model.items())
    expect(row.count).toBe(13)
  })

  it('leaves mentions that are REPLIES under one post alone (they already group by subject)', () => {
    const { model } = harness()
    const parent = { postId: 'someone-elses', authorHandle: 'zed' }
    for (let index = 0; index < 12; index += 1) {
      model.ingest(post({ id: `p${index}`, text: `@${HANDLE} hi`, at: sec(index), replyTo: parent }))
    }
    expect(only(model.items())).toMatchObject({ id: 'mention:someone-elses', count: 12 })
  })

  it('"Mark all read" reads a storm; a mention that joins it makes it unread again', () => {
    const { model } = harness()
    for (let index = 0; index < 10; index += 1) model.ingest(mention(`p${index}`, sec(index)))
    model.markAllRead()
    expect(only(model.items()).unread).toBe(false)
    const joined = model.ingest(mention('late', sec(30)))
    expect(joined.event).toEqual({ type: 'mention', amount: 1 })
    expect(only(model.items())).toMatchObject({ unread: true, count: 11 })
  })

  it('a taken-down member leaves the storm; the last one takes the row with it', () => {
    const { model } = harness()
    for (let index = 0; index < 7; index += 1) model.ingest(mention(`p${index}`, sec(index)))
    expect(model.remove('p3')).toBe(true)
    expect(only(model.items()).count).toBe(6)
    for (const id of ['p0', 'p1', 'p2', 'p4', 'p5', 'p6']) model.remove(id)
    expect(model.items()).toEqual([])
  })

  it('a taken-down post is never folded into a storm', () => {
    const { removed, model } = harness()
    for (let index = 0; index < 6; index += 1) {
      if (index === 2) removed.add(`p${index}`)
      model.ingest(mention(`p${index}`, sec(index)))
    }
    // 5 survivors: not more than the threshold, so no storm and no row for the removed one.
    expect(model.items()).toHaveLength(5)
  })

  it('stays bounded: a burst of 1000 is one row, and storms + spread rows respect GROUPS_CAP', () => {
    const { model } = harness()
    for (let index = 0; index < 1000; index += 1) {
      model.ingest(mention(`b${index}`, sec(index % 30), `persona-${index % 50}`))
    }
    expect(only(model.items()).count).toBe(1000)

    // Plus far more spread-out mentions than the cap holds: the storm is the NEWEST, so it stays.
    for (let index = 0; index < GROUPS_CAP + 100; index += 1) {
      model.ingest(mention(`s${index}`, tick(index + 1)))
    }
    const rows = model.items()
    expect(rows.length).toBeLessThanOrEqual(GROUPS_CAP)
    expect(rows.some(row => row.count === 1000)).toBe(false) // the OLD storm aged out with the cap
    expect(rows[0]?.subjectPostId).toBe(`s${GROUPS_CAP + 99}`)
  })

  it('a window of exactly MENTION_STORM_WINDOW_MS still counts as "within"', () => {
    const { model } = harness()
    for (let index = 0; index < MENTION_STORM_THRESHOLD; index += 1) {
      model.ingest(mention(`p${index}`, sec(index * 12)))
    }
    expect(model.items()).toHaveLength(MENTION_STORM_THRESHOLD)
    // The sixth lands exactly one window after the first.
    model.ingest(mention('edge', new Date(EIGHT_AM + MENTION_STORM_WINDOW_MS).toISOString()))
    expect(only(model.items()).count).toBe(MENTION_STORM_THRESHOLD + 1)
  })
})

describe('counts only move with a feed READ (S-3)', () => {
  it('ignores the counts of a pushed post that is already mine', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 10)])
    model.ingestBatch([mine('m1', 14)]) // a read: 4 new likes
    expect(only(model.items()).count).toBe(4)

    // A late / replayed push of the same post, carrying the counts it had when it was sent.
    const stale = model.ingest(mine('m1', 0))
    expect(stale).toEqual({ changed: false })
    expect(only(model.items()).count).toBe(4) // the baseline was NOT dragged down to 0

    // ... so the next read reports 4 + 1, not 14 + 1.
    model.ingestBatch([mine('m1', 15)])
    expect(only(model.items()).count).toBe(5)
  })

  it('does not let a stale push raise a count either', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 3)])
    expect(model.ingest(mine('m1', 50)).event).toBeUndefined()
    expect(model.items()).toEqual([])
  })

  it('still registers a NEW post of mine from a push (its counts are its baseline)', () => {
    const { model } = harness()
    model.ingest(mine('fresh', 2))
    model.ingestBatch([mine('fresh', 6)])
    expect(only(model.items()).count).toBe(4)
  })

  it('a feed read may lower a baseline (an unlike)', () => {
    const { model } = harness()
    model.ingestBatch([mine('m1', 10)])
    model.ingestBatch([mine('m1', 7)])
    model.ingestBatch([mine('m1', 9)])
    expect(only(model.items()).count).toBe(2)
  })
})

describe('the model is bounded (S-1: cost stays flat over a long session)', () => {
  it('keeps only the newest GROUPS_CAP reply/mention rows', () => {
    const { model } = harness()
    const total = GROUPS_CAP + 200
    for (let index = 0; index < total; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    const rows = model.items()
    expect(rows).toHaveLength(GROUPS_CAP)
    const subjects = new Set(rows.map(row => row.subjectPostId))
    expect(subjects.has(`p${total - 1}`)).toBe(true) // the newest is kept
    expect(subjects.has('p0')).toBe(false) // the oldest went
    expect(subjects.has(`p${total - GROUPS_CAP}`)).toBe(true) // exactly the newest GROUPS_CAP
    expect(subjects.has(`p${total - GROUPS_CAP - 1}`)).toBe(false)
  })

  it('does not rediscover (or announce) an evicted row when the feed is read again', () => {
    const { model } = harness()
    for (let index = 0; index < GROUPS_CAP + 10; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    // p0 was evicted. A re-read offers it again: nothing changes, nothing is announced.
    expect(model.ingest(post({ id: 'p0', text: '@dreyes_fh hi', at: tick(0) }))).toEqual({
      changed: false,
    })
    expect(model.items()).toHaveLength(GROUPS_CAP)
  })

  it('a backdated arrival older than everything it would displace is ignored, not stored', () => {
    const { model } = harness()
    for (let index = 0; index < GROUPS_CAP; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index + 10) }))
    }
    // Full. A very old mention would rank last, i.e. be the one evicted at once.
    const old = model.ingest(post({ id: 'old', text: '@dreyes_fh hi', at: tick(0) }))
    expect(old.event).toBeUndefined()
    expect(model.items().some(row => row.subjectPostId === 'old')).toBe(false)
    expect(model.items()).toHaveLength(GROUPS_CAP)
  })

  it('a NEWER arrival into a full model displaces the oldest and IS announced', () => {
    const { model } = harness()
    for (let index = 0; index < GROUPS_CAP; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    const fresh = model.ingest(post({ id: 'fresh', text: '@dreyes_fh hi', at: tick(GROUPS_CAP + 5) }))
    expect(fresh.event).toEqual({ type: 'mention', amount: 1 })
    const subjects = model.items().map(row => row.subjectPostId)
    expect(subjects).toContain('fresh')
    expect(subjects).not.toContain('p0')
    expect(subjects).toHaveLength(GROUPS_CAP)
  })

  it('adding to an EXISTING group never evicts anything', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    for (let index = 0; index < GROUPS_CAP - 1; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    expect(model.items()).toHaveLength(GROUPS_CAP - 1)
    for (let index = 0; index < 50; index += 1) {
      model.ingest(replyTo(`r${index}`, 'm1', ALEX, tick(index)))
    }
    expect(model.items()).toHaveLength(GROUPS_CAP)
  })

  it('tracks at most MINE_CAP of my own posts (the oldest forgotten first)', () => {
    const { model } = harness()
    for (let index = 0; index < MINE_CAP + 5; index += 1) model.ingest(mine(`m${index}`))
    model.ingest(replyTo('r-old', 'm0')) // m0 was forgotten: this is no longer a reply to "mine"
    model.ingest(replyTo('r-new', `m${MINE_CAP + 4}`))
    expect(model.items().map(row => row.subjectPostId)).toEqual([`m${MINE_CAP + 4}`])
  })

  it('building the list stays proportional to the cap, not to how long the session ran', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    // 5 x GROUPS_CAP distinct rows over a "long session"; the list never exceeds the cap.
    for (let index = 0; index < GROUPS_CAP * 5; index += 1) {
      model.ingest(post({ id: `p${index}`, text: '@dreyes_fh hi', at: tick(index) }))
    }
    expect(model.items().length).toBeLessThanOrEqual(GROUPS_CAP)
  })
})

describe('persistence round-trip (the model never touches storage itself)', () => {
  it('a reloaded viewer keeps read events read, new events unread, and likes against the stored baseline', () => {
    const first = harness()
    first.model.ingestBatch([mine('m1', 5), replyTo('r1', 'm1')])
    first.model.markAllRead()
    first.model.ingestBatch([mine('m1', 9)]) // 4 new likes since the baseline moved to 5
    const persisted = first.model.toPersisted()

    // A reload: a fresh model, the same stored state, the same feed (plus one new reply).
    const second = harness({ persisted })
    const events = second.model.ingestBatch([
      mine('m1', 9),
      replyTo('r1', 'm1'),
      replyTo('r2', 'm1', SAM),
    ])
    // Only the genuinely new reply is an event; the pending likes are NOT re-announced.
    expect(events).toEqual([{ type: 'reply', amount: 1 }])
    const rows = second.model.items()
    expect(rows.find(row => row.type === 'reply')).toMatchObject({ unread: true, count: 2 })
    expect(rows.find(row => row.type === 'like')).toMatchObject({ unread: true, count: 4 })
  })

  it('a stored read event stays read after a reload', () => {
    const first = harness()
    first.model.ingestBatch([mine('m1'), replyTo('r1', 'm1')])
    first.model.markAllRead()
    const second = harness({ persisted: first.model.toPersisted() })
    second.model.ingestBatch([mine('m1'), replyTo('r1', 'm1')])
    expect(only(second.model.items()).unread).toBe(false)
  })

  it('a different viewer\'s empty state starts clean: no inherited baseline, no inherited read marks', () => {
    const first = harness()
    first.model.ingestBatch([mine('m1', 5), replyTo('r1', 'm1')])
    first.model.markAllRead()
    const stranger = harness() // EMPTY_PERSISTED: a different persona / exercise key
    stranger.model.ingestBatch([mine('m1', 9), replyTo('r1', 'm1')])
    const rows = stranger.model.items()
    expect(rows.map(row => row.type)).toEqual(['reply']) // 9 likes = the new baseline
    expect(rows[0]?.unread).toBe(true)
  })
})

describe('cost under a burst (SOC-071: no per-arrival O(n^2))', () => {
  it('an unrelated post is a shared no-op result: no allocation, no change', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    const a = model.ingest(post({ id: 'u1', text: 'just chatting' }))
    const b = model.ingest(post({ id: 'u2', text: 'also chatting' }))
    expect(a).toBe(b)
    expect(a.changed).toBe(false)
  })

  it('arrivals do not rebuild rows: a row is built only when something asks for the list', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    for (let index = 0; index < 2000; index += 1) model.ingest(replyTo(`r${index}`, 'm1'))
    // 2000 arrivals, one group: reading the list is O(groups), not O(arrivals x anything).
    const rows = model.items()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(2000)
  })

  it('120 posts a minute of unrelated chatter derives nothing and leaves the list empty', () => {
    const { model } = harness()
    model.ingest(mine('m1'))
    let changes = 0
    for (let index = 0; index < 120; index += 1) {
      if (model.ingest(post({ id: `u${index}`, by: SAM, text: `chatter ${index}` })).changed) {
        changes += 1
      }
    }
    expect(changes).toBe(0)
    expect(model.items()).toEqual([])
  })
})
