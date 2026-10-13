/**
 * features/controller/runSheet/injectDraft.test.ts
 * ---------------------------------------------------------------------------
 * The editor's form model <-> wire conversion (inject-queue story 07, "Author live"):
 *  - blank drafts are valid-to-edit but invalid-to-submit with field-keyed errors;
 *  - post mode submits ONLY the first post but keeps the others in the draft;
 *  - blank numbers are "unset", non-numbers are flagged, not sent;
 *  - reply modes / media / baseline map onto the frozen `InjectPostWrite` members;
 *  - `draftFromItem` -> `draftToWrite` round-trips a server item;
 *  - CHILD IDENTITY (amendment): existing children echo their `id` on PUT, new ones omit it;
 *  - SIBLING REPLIES: held by draft key and sent as `{ sequence }` (works at create), recomputed
 *    after a reorder, CLEARED with an inline notice if the target was removed or now comes after.
 */
import { describe, expect, it } from 'vitest'
import {
  REPLY_TARGET_NOW_LATER,
  REPLY_TARGET_REMOVED,
  blankDraft,
  blankPost,
  draftFromItem,
  draftToWrite,
  normalizeSiblingReplies,
  type Draft,
} from './injectDraft'
import { makeItem, makePost } from './runSheetTestHarness'

const filled = () => {
  const draft = blankDraft('human-controller-01')
  draft.title = '  Boil-water advisory  '
  draft.posts[0] = { ...blankPost(), personaId: 'persona-a', text: 'Hello' }
  return draft
}

describe('draftToWrite', () => {
  it('a blank draft has errors keyed by field path', () => {
    const { errors } = draftToWrite(blankDraft())
    expect(Object.keys(errors).sort()).toEqual(['posts.0.personaId', 'posts.0.text', 'title'])
  })

  it('builds a trimmed-title post write assigned to the chosen controller', () => {
    const { write, errors } = draftToWrite(filled())
    expect(errors).toEqual({})
    expect(write).toEqual({
      kind: 'post',
      title: 'Boil-water advisory',
      assigneeId: 'human-controller-01',
      posts: [{ personaId: 'persona-a', text: 'Hello' }],
    })
  })

  it('unassigned becomes assigneeId null (explicitly cleared)', () => {
    const draft = filled()
    draft.assigneeId = ''
    expect(draftToWrite(draft).write.assigneeId).toBeNull()
  })

  it('post mode submits only the first post but the draft keeps the rest', () => {
    const draft = filled()
    draft.posts.push({ ...blankPost(), personaId: 'persona-b', text: 'Second' })
    const { write } = draftToWrite(draft)
    expect(write.posts).toHaveLength(1)
    expect(draft.posts).toHaveLength(2)
  })

  it('burst mode submits every post in order with the window', () => {
    const draft = filled()
    draft.kind = 'burst'
    draft.windowSeconds = '120'
    draft.posts.push({ ...blankPost(), personaId: 'persona-b', text: 'Second' })
    const { write, errors } = draftToWrite(draft)
    expect(errors).toEqual({})
    expect(write.posts.map(p => p.text)).toEqual(['Hello', 'Second'])
    expect(write.burstWindowSeconds).toBe(120)
  })

  it('a blank window is left to the server default; an out-of-range window is flagged', () => {
    const draft = filled()
    draft.kind = 'burst'
    draft.posts.push({ ...blankPost(), personaId: 'persona-b', text: 'Second' })
    draft.windowSeconds = ''
    expect(draftToWrite(draft).write.burstWindowSeconds).toBeUndefined()
    draft.windowSeconds = '10'
    expect(draftToWrite(draft).errors.burstWindowSeconds).toBeDefined()
    draft.windowSeconds = '601'
    expect(draftToWrite(draft).errors.burstWindowSeconds).toBeDefined()
  })

  it('a post never carries a window', () => {
    const draft = filled()
    draft.windowSeconds = '120'
    expect(draftToWrite(draft).write).not.toHaveProperty('burstWindowSeconds')
  })

  it('T+N: blank = unset, a number is sent, junk is flagged', () => {
    const draft = filled()
    expect(draftToWrite(draft).write).not.toHaveProperty('plannedMinute')
    draft.plannedMinute = '15'
    expect(draftToWrite(draft).write.plannedMinute).toBe(15)
    draft.plannedMinute = 'abc'
    expect(draftToWrite(draft).errors.plannedMinute).toBeDefined()
    draft.plannedMinute = '-3'
    expect(draftToWrite(draft).errors.plannedMinute).toBeDefined()
  })

  it('maps media, reply-to (both kinds) and the baseline onto the frozen write shape', () => {
    const draft = filled()
    const post = draft.posts[0]
    if (!post) throw new Error('no post')
    post.media = [{ mediaId: ' media-1 ', alt: 'Brown water in a glass' }]
    post.reply = { kind: 'scripted', injectPostId: 'injp-9' }
    post.baselineOn = true
    post.baselineLike = '120'
    post.baselineRepost = ''
    post.baselineReply = '4'
    const first = draftToWrite(draft).write.posts[0]
    expect(first?.media).toEqual([{ mediaId: 'media-1', alt: 'Brown water in a glass' }])
    expect(first?.replyTo).toEqual({ injectPostId: 'injp-9' })
    expect(first?.engagementBaseline).toEqual({ like: 120, reply: 4 })

    post.reply = { kind: 'postId', postId: ' post-77 ' }
    expect(draftToWrite(draft).write.posts[0]?.replyTo).toEqual({ postId: 'post-77' })
  })

  it('media without alt text is refused (NFR-001)', () => {
    const draft = filled()
    const post = draft.posts[0]
    if (!post) throw new Error('no post')
    post.media = [{ mediaId: 'media-1', alt: '' }]
    expect(draftToWrite(draft).errors['posts.0.media.0.alt']).toBeDefined()
  })

  it('a baseline switched on but left empty sends no baseline', () => {
    const draft = filled()
    const post = draft.posts[0]
    if (!post) throw new Error('no post')
    post.baselineOn = true
    expect(draftToWrite(draft).write.posts[0]).not.toHaveProperty('engagementBaseline')
  })
})

describe('draftFromItem', () => {
  it('round-trips a server item through the form and back, echoing every child id', () => {
    const item = makeItem({
      kind: 'burst',
      title: 'Pile-on',
      notes: 'after the advisory',
      plannedMinute: 15,
      assigneeId: 'human-controller-02',
      burstWindowSeconds: 120,
      posts: [
        makePost({ id: 'p1', sequence: 1, text: 'one', media: [{ mediaId: 'm', alt: 'alt' }] }),
        makePost({
          id: 'p2',
          sequence: 2,
          text: 'two',
          replyTo: { injectPostId: 'p1' },
          engagementBaseline: { like: 5 },
        }),
      ],
    })
    const { write, errors } = draftToWrite(draftFromItem(item))
    expect(errors).toEqual({})
    expect(write).toEqual({
      kind: 'burst',
      title: 'Pile-on',
      notes: 'after the advisory',
      plannedMinute: 15,
      assigneeId: 'human-controller-02',
      burstWindowSeconds: 120,
      posts: [
        {
          id: 'p1',
          personaId: 'persona-fairhavenwater',
          text: 'one',
          media: [{ mediaId: 'm', alt: 'alt' }],
        },
        {
          id: 'p2',
          personaId: 'persona-fairhavenwater',
          text: 'two',
          // A reply to an earlier SIBLING is re-expressed as its current position.
          replyTo: { sequence: 1 },
          engagementBaseline: { like: 5 },
        },
      ],
    })
  })

  it('flags a fired child so the editor can lock it', () => {
    const item = makeItem({
      kind: 'burst',
      posts: [
        makePost({ id: 'p1', sequence: 1, status: 'fired' }),
        makePost({ id: 'p2', sequence: 2, status: 'pending' }),
      ],
    })
    const draft = draftFromItem(item)
    expect(draft.posts.map(p => p.fired)).toEqual([true, false])
  })

  it('a server `{ sequence }` reply and a same-item `{ injectPostId }` reply both become sibling replies', () => {
    const item = makeItem({
      kind: 'burst',
      posts: [
        makePost({ id: 'p1', sequence: 1 }),
        makePost({ id: 'p2', sequence: 2, replyTo: { sequence: 1 } }),
        makePost({ id: 'p3', sequence: 3, replyTo: { injectPostId: 'p2' } }),
      ],
    })
    const draft = draftFromItem(item)
    expect(draft.posts[1]?.reply).toEqual({ kind: 'sibling', key: draft.posts[0]?.key })
    expect(draft.posts[2]?.reply).toEqual({ kind: 'sibling', key: draft.posts[1]?.key })
  })

  it('a reply to a post in ANOTHER item stays `injectPostId`; a pasted id stays `postId`', () => {
    const item = makeItem({
      kind: 'burst',
      posts: [
        makePost({ id: 'p1', sequence: 1, replyTo: { injectPostId: 'other-item-post' } }),
        makePost({ id: 'p2', sequence: 2, replyTo: { postId: 'post-9' } }),
      ],
    })
    const draft = draftFromItem(item)
    expect(draft.posts[0]?.reply).toEqual({ kind: 'scripted', injectPostId: 'other-item-post' })
    expect(draft.posts[1]?.reply).toEqual({ kind: 'postId', postId: 'post-9' })
    const { write } = draftToWrite(draft)
    expect(write.posts[0]?.replyTo).toEqual({ injectPostId: 'other-item-post' })
    expect(write.posts[1]?.replyTo).toEqual({ postId: 'post-9' })
  })
})

describe('child identity on PUT', () => {
  it('a new post has no id; existing posts echo theirs', () => {
    const item = makeItem({
      kind: 'burst',
      posts: [makePost({ id: 'p1', sequence: 1 }), makePost({ id: 'p2', sequence: 2 })],
    })
    const draft = draftFromItem(item)
    draft.posts.push({ ...blankPost(), personaId: 'persona-a', text: 'brand new' })
    const { write } = draftToWrite(draft)
    expect(write.posts.map(p => p.id)).toEqual(['p1', 'p2', undefined])
    expect(write.posts[2]).not.toHaveProperty('id')
  })

  it('a create never sends an id', () => {
    const draft = filled()
    expect(draftToWrite(draft).write.posts[0]).not.toHaveProperty('id')
  })

  it('a removed post is simply omitted (the server drops an unfired child left out)', () => {
    const item = makeItem({
      kind: 'burst',
      posts: [
        makePost({ id: 'p1', sequence: 1 }),
        makePost({ id: 'p2', sequence: 2 }),
        makePost({ id: 'p3', sequence: 3 }),
      ],
    })
    const draft = draftFromItem(item)
    draft.posts = draft.posts.filter(p => p.id !== 'p2')
    expect(draftToWrite(draft).write.posts.map(p => p.id)).toEqual(['p1', 'p3'])
  })
})

describe('sibling replies', () => {
  /** A 3-post burst; post 3 replies to post 1 (a create: no ids). */
  const burstDraft = (): Draft => {
    const draft = filled()
    draft.kind = 'burst'
    draft.posts = [
      { ...blankPost(), personaId: 'persona-a', text: 'one' },
      { ...blankPost(), personaId: 'persona-b', text: 'two' },
      { ...blankPost(), personaId: 'persona-c', text: 'three' },
    ]
    return draft
  }

  it('works at CREATE time: a sibling reply is sent as `{ sequence }` of its target', () => {
    const draft = burstDraft()
    const first = draft.posts[0]
    const second = draft.posts[1]
    const third = draft.posts[2]
    if (!first || !second || !third) throw new Error('fixture')
    second.reply = { kind: 'sibling', key: first.key }
    third.reply = { kind: 'sibling', key: second.key }
    const { write, errors } = draftToWrite(draft)
    expect(errors).toEqual({})
    expect(write.posts.map(p => p.replyTo)).toEqual([undefined, { sequence: 1 }, { sequence: 2 }])
  })

  it('a reply to a post at or after itself (or a missing target) is refused on that post', () => {
    const draft = burstDraft()
    const first = draft.posts[0]
    const third = draft.posts[2]
    if (!first || !third) throw new Error('fixture')
    first.reply = { kind: 'sibling', key: third.key } // a LATER post
    expect(draftToWrite(draft).errors['posts.0.replyTo']).toBeDefined()
    first.reply = { kind: 'sibling', key: 'no-such-key' }
    expect(draftToWrite(draft).errors['posts.0.replyTo']).toBeDefined()
  })

  it('stays correct when posts are reordered: `{ sequence }` follows the target\'s new position', () => {
    const draft = burstDraft()
    const [first, second, third] = draft.posts
    if (!first || !second || !third) throw new Error('fixture')
    third.reply = { kind: 'sibling', key: first.key }
    // Swap posts 1 and 2: the target (first) is now position 2, still before `third`.
    draft.posts = normalizeSiblingReplies([second, first, third])
    expect(draft.posts[2]?.reply).toEqual({ kind: 'sibling', key: first.key })
    expect(draftToWrite(draft).write.posts[2]?.replyTo).toEqual({ sequence: 2 })
  })
})

describe('normalizeSiblingReplies', () => {
  const trio = () => {
    const a = { ...blankPost(), text: 'a' }
    const b = { ...blankPost(), text: 'b' }
    const c = { ...blankPost(), text: 'c' }
    return { a, b, c }
  }

  it('clears a reply whose target was REMOVED, with an inline notice', () => {
    const { a, b, c } = trio()
    const reply = { ...c, reply: { kind: 'sibling' as const, key: b.key } }
    const out = normalizeSiblingReplies([a, reply]) // b removed
    expect(out[1]?.reply).toEqual({ kind: 'none' })
    expect(out[1]?.replyNotice).toBe(REPLY_TARGET_REMOVED)
  })

  it('clears a reply whose target now comes AFTER it, with an inline notice', () => {
    const { a, b } = trio()
    const reply = { ...b, reply: { kind: 'sibling' as const, key: a.key } }
    const out = normalizeSiblingReplies([reply, a]) // a moved below its reply
    expect(out[0]?.reply).toEqual({ kind: 'none' })
    expect(out[0]?.replyNotice).toBe(REPLY_TARGET_NOW_LATER)
  })

  it('keeps a reply whose target merely moved but is still earlier (re-pointed by key)', () => {
    const { a, b, c } = trio()
    const reply = { ...c, reply: { kind: 'sibling' as const, key: a.key } }
    const out = normalizeSiblingReplies([b, a, reply])
    expect(out[2]).toBe(reply) // untouched, same object
    expect(out[2]?.replyNotice).toBeUndefined()
  })

  it('leaves non-sibling replies and plain posts untouched (same object identity)', () => {
    const { a, b } = trio()
    const scripted = { ...b, reply: { kind: 'scripted' as const, injectPostId: 'x' } }
    const out = normalizeSiblingReplies([a, scripted])
    expect(out[0]).toBe(a)
    expect(out[1]).toBe(scripted)
  })
})
