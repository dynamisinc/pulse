/**
 * features/controller/runSheet/injectDraft.test.ts
 * ---------------------------------------------------------------------------
 * The editor's form model <-> wire conversion (inject-queue story 07, "Author live"):
 *  - blank drafts are valid-to-edit but invalid-to-submit with field-keyed errors;
 *  - post mode submits ONLY the first post but keeps the others in the draft;
 *  - blank numbers are "unset", non-numbers are flagged, not sent;
 *  - reply modes / media / baseline map onto the frozen `InjectPostWrite` members;
 *  - `draftFromItem` -> `draftToWrite` round-trips a server item.
 */
import { describe, expect, it } from 'vitest'
import { blankDraft, blankPost, draftFromItem, draftToWrite } from './injectDraft'
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
  it('round-trips a server item through the form and back', () => {
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
        { personaId: 'persona-fairhavenwater', text: 'one', media: [{ mediaId: 'm', alt: 'alt' }] },
        {
          personaId: 'persona-fairhavenwater',
          text: 'two',
          replyTo: { injectPostId: 'p1' },
          engagementBaseline: { like: 5 },
        },
      ],
    })
  })
})
