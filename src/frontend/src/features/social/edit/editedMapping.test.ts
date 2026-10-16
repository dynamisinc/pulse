/**
 * features/social/edit/editedMapping.test.ts
 * ---------------------------------------------------------------------------
 * The read seam for `edited` and `viewer.editableForSeconds` (story 20): the wire guard accepts
 * the contract shapes and fails closed on malformed ones; the mock `createPost` stamps a
 * participant's own post with the window as a DURATION; `feedService.toPostView` carries `edited`.
 */
import { describe, expect, it } from 'vitest'
import { toPostView } from '../services/feedService'
import { createPost, hasWellFormedV2Members } from '../services/postService'
import { personaById, personaIdForHandle } from '@/features/personas'
import { EDIT_WINDOW_SECONDS } from './editLimits'

const EDITED = { count: 2, scenarioTime: '2033-09-04T10:02:00Z' }

describe('hasWellFormedV2Members - edited / editableForSeconds', () => {
  it.each([
    ['absent', {}],
    ['edited null', { edited: null }],
    ['an edit summary', { edited: EDITED }],
    ['a viewer with seconds', { viewer: { liked: false, reposted: false, editableForSeconds: 12 } }],
    ['a viewer with null seconds', { viewer: { liked: false, reposted: false, editableForSeconds: null } }],
  ])('accepts %s', (_name, extra) => {
    expect(hasWellFormedV2Members(extra)).toBe(true)
  })

  it.each([
    ['a string edited', { edited: 'yes' }],
    ['a zero count', { edited: { count: 0, scenarioTime: EDITED.scenarioTime } }],
    ['a fractional count', { edited: { count: 1.5, scenarioTime: EDITED.scenarioTime } }],
    ['no scenario time', { edited: { count: 1 } }],
    ['string seconds', { viewer: { liked: false, reposted: false, editableForSeconds: '9' } }],
  ])('rejects %s', (_name, extra) => {
    expect(hasWellFormedV2Members(extra)).toBe(false)
  })
})

describe('mock createPost and toPostView', () => {
  it('stamps a participant post with the full window as a duration, never a clock', () => {
    const post = createPost({
      exerciseId: 'ex-mock-0001',
      timeZone: 'America/New_York',
      scenarioTime: '2033-09-04T10:00:00Z',
      authorPersonaId: personaIdForHandle('mvega_fh'),
      actingHumanId: 'human-participant-mvega',
      text: 'hello',
      origin: 'participant',
    })

    expect(post.viewer?.editableForSeconds).toBe(EDIT_WINDOW_SECONDS)
  })

  it('does not stamp a controller-as-persona post', () => {
    const post = createPost({
      exerciseId: 'ex-mock-0001',
      timeZone: 'America/New_York',
      scenarioTime: '2033-09-04T10:00:00Z',
      authorPersonaId: personaIdForHandle('mvega_fh'),
      actingHumanId: 'human-controller',
      text: 'hello',
      origin: 'controller-as-persona',
    })

    expect(post.viewer).toBeUndefined()
  })

  it('carries edited onto the presentational PostView', () => {
    const author = personaById(personaIdForHandle('mvega_fh'))
    if (!author) throw new Error('fixture missing seeded persona')
    const base = {
      id: 'p',
      authorPersonaId: author.id,
      text: 't',
      counts: { reply: 0, repost: 0, like: 0 },
      scenarioTime: '2033-09-04T10:00:00Z',
    }

    expect(toPostView({ ...base, edited: EDITED }, author).edited).toEqual(EDITED)
    expect(toPostView(base, author).edited).toBeUndefined()
  })
})
