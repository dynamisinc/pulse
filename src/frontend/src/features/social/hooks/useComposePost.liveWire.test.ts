/**
 * features/social/hooks/useComposePost.liveWire.test.ts
 * ---------------------------------------------------------------------------
 * What actually goes ON THE WIRE when the participant composer publishes in LIVE
 * mode (demo-polish F4, story 13; COR-001, NFR-004, XC-004): the REAL
 * `livePostActions.publishPost` runs, and only the axios `post` underneath it is
 * stubbed, so this exercises the whole hook -> service -> request-body path.
 *
 *  - NO `exerciseId` in the request body, for a post, a post with media, or a reply
 *    — scope is the server's (the session), never the client's;
 *  - the body is exactly the contract's fields: `media` items are `{ mediaId, alt }`
 *    and nothing else, `parentPostId` is present only for a reply, and no staff-only
 *    `engagementBaseline` rides along;
 *  - body AND alt text go out SANITIZED (a stored `<script>` / `<img onerror>` is
 *    inert before it leaves the client — the server sanitizes again);
 *  - the client emits ZERO telemetry events in live mode (the server emits
 *    `post`/`reply`; emitting here too would double count).
 *
 * Own file for the same reason as `useComposePost.live.test.ts`: `vi.mock` of
 * `@/core/config/mockData` is module-wide.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import { uploadPickedMedia } from '@/core/media'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { useComposePost } from './useComposePost'
import { ownPostStore } from '../services/ownPostStore'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/core/auth', () => ({ useSession: vi.fn() }))
vi.mock('@/core/media', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

const EXERCISE_ID = 'ex-live-0001'

const scope: ExerciseScope = {
  exerciseId: EXERCISE_ID,
  exerciseName: 'Coastal Surge (Live)',
  timeZone: 'America/New_York',
  status: 'active',
}

const session: Session = {
  exerciseId: EXERCISE_ID,
  accountId: 'acct-live-participant',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

/** A 201 body the server would return for the post just sent. */
const CREATED = {
  id: 'post-created-1',
  authorPersonaId: 'persona-dreyes_fh',
  text: 'created',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
}

let uploader: FakeUploader
let postSpy: MockInstance<typeof api.post>

/** The JSON body of the first `POST /posts`. */
function sentBody(): Record<string, unknown> {
  const call = postSpy.mock.calls.find(([url]) => url === '/posts')
  const body: unknown = call?.[1]
  if (typeof body !== 'object' || body === null) throw new Error('no POST /posts body captured')
  return body as Record<string, unknown>
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(scope)
  vi.mocked(useSession).mockReturnValue(session)
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
  postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: CREATED, status: 201 })
  resetTelemetryBuffer()
})

afterEach(() => {
  vi.restoreAllMocks()
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('useComposePost — LIVE request body', () => {
  it('a plain post: exactly the contract fields, NO exerciseId, sanitized text', async () => {
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Hello <script>steal()</script><img src=x onerror=boom()>there'))
    act(() => result.current.publish())

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))
    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual([
      'actingHumanId',
      'authorPersonaId',
      'origin',
      'scenarioTime',
      'text',
      'timeZone',
    ])
    expect(body).not.toHaveProperty('exerciseId')
    expect(JSON.stringify(body)).not.toContain(EXERCISE_ID)
    expect(body.text).toBe('Hello there')
    expect(body.origin).toBe('participant')
  })

  it('a post with a photo: media items are { mediaId, alt } only, alt sanitized', async () => {
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.attachFiles([fakeFile('a.png', 'image/png')]))
    await act(async () => {
      uploader.byName('a.png').resolve({ id: 'asset-a' })
    })
    act(() => {
      result.current.setAttachmentAlt(
        result.current.attachments[0]?.key ?? '',
        '<img src=x onerror=boom()>Floodwater <b>on</b> Main Street',
      )
    })
    act(() => result.current.publish())

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))
    const body = sentBody()
    expect(body.media).toEqual([{ mediaId: 'asset-a', alt: 'Floodwater on Main Street' }])
    expect(body).not.toHaveProperty('exerciseId')
    expect(JSON.stringify(body)).not.toContain(EXERCISE_ID)
    expect(JSON.stringify(body)).not.toMatch(/<|onerror/i)
  })

  it('a reply: parentPostId is sent, still NO exerciseId and no engagementBaseline', async () => {
    const { result } = renderHook(() => useComposePost({ parentPostId: 'post-parent-1' }))

    act(() => result.current.setText('Replying.'))
    act(() => result.current.publish())

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))
    const body = sentBody()
    expect(body.parentPostId).toBe('post-parent-1')
    expect(body).not.toHaveProperty('exerciseId')
    expect(body).not.toHaveProperty('engagementBaseline')
  })

  it('emits no frontend telemetry for a post or a reply (the server is the emitter)', async () => {
    const post = renderHook(() => useComposePost())
    act(() => post.result.current.setText('A post.'))
    act(() => post.result.current.publish())
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))

    const reply = renderHook(() => useComposePost({ parentPostId: 'post-parent-1' }))
    act(() => reply.result.current.setText('A reply.'))
    act(() => reply.result.current.publish())
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2))

    expect(getEmittedTelemetryEvents()).toEqual([])
  })
})
