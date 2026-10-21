/**
 * Regression (fix/noise-new-posts-clock; demo 10/20 participant pill): "N new posts",
 * tap, pill hides, nothing new at the top.
 *
 *  A. Ordering: noise is now stamped by the SAME (server) clock as every other post, so
 *     a noise post published after the loaded human posts sorts ABOVE them and the tap
 *     changes the top of the feed.
 *  B. Unknown author: a post whose author isn't in the participant's cached persona cast
 *     (a persona created after page load, e.g. an easy-login / roster participant) is NOT
 *     dropped by the tap: it stays buffered, the pill keeps counting it, and the cast is
 *     re-read so a later tap can render it. It is dropped only once a REFRESHED cast still
 *     lacks the author (B, B2), and renders once the refresh brings the author in (B3).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import { SEEDED_PERSONAS } from '@/features/personas/personaService'
import type { StaffPersona } from '@/features/personas/types'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

function livePost(id: string, scenarioTime: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-x',
    text: `text of ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-10-20T12:00:00.000Z',
    scenarioTime,
    origin: 'controller-as-persona',
    ...overrides,
  }
}

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

function cardIds(): string[] {
  return screen.getAllByTestId('post-card').map(c => c.getAttribute('data-post-id') ?? '')
}

beforeEach(() => {
  resetTelemetryBuffer()
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  postStore.resetForTests()
  resetTelemetryBuffer()
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('participant pill with white noise', () => {
  it('A: noise stamped by the one clock lands above already-loaded human posts', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    // Three human posts (wall-clock stamps 16:00..16:10) arrive and are loaded.
    act(() => {
      postStore.appendPost(livePost('human-1', '2033-09-04T16:00:00Z'))
      postStore.appendPost(livePost('human-2', '2033-09-04T16:05:00Z'))
      postStore.appendPost(livePost('human-3', '2033-09-04T16:10:00Z', { origin: 'participant' }))
    })
    fireEvent.click(await screen.findByTestId('new-posts-pill'))
    await waitFor(() => expect(cardIds()[0]).toBe('human-3'))

    // Noise published AFTER them, stamped by the same clock (so it is later).
    act(() => {
      postStore.appendPost(livePost('noise-1', '2033-09-04T16:11:00Z', { origin: 'noise' }))
      postStore.appendPost(livePost('noise-2', '2033-09-04T16:12:00Z', { origin: 'noise' }))
    })
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('2 new posts')
    fireEvent.click(pill)

    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
    const ids = cardIds()
    expect(ids.slice(0, 3)).toEqual(['noise-2', 'noise-1', 'human-3']) // the top changed
  })

  it('B: a post by an author missing from the cached cast stays buffered behind the pill', async () => {
    renderFeed()
    const before = (await screen.findAllByTestId('post-card')).length

    act(() => {
      postStore.appendPost(livePost('late-joiner-1', '2033-09-04T16:00:00Z', {
        authorPersonaId: 'persona-created-after-page-load',
      }))
    })
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')
    fireEvent.click(pill)

    // Nothing could render, but nothing was lost either: the pill still promises the post.
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')
    expect(screen.getAllByTestId('post-card')).toHaveLength(before) // nothing added

    // One refreshed cast per post: once the re-read has landed and STILL lacks the author,
    // the next tap drops it (as the old baseline skip did) and the control does not stay stuck.
    await flushCastRefresh()
    fireEvent.click(screen.getByTestId('new-posts-pill'))
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
    expect(screen.getAllByTestId('post-card')).toHaveLength(before)
  })

  it('B2: a second tap BEFORE the cast re-read lands keeps the post waiting', async () => {
    renderFeed()
    const before = (await screen.findAllByTestId('post-card')).length
    act(() => {
      postStore.appendPost(livePost('late-joiner-2', '2033-09-04T16:00:00Z', {
        authorPersonaId: 'persona-created-after-page-load',
      }))
    })
    const pill = await screen.findByTestId('new-posts-pill')

    // Two taps back to back: the re-read the first one asked for has not resolved yet.
    fireEvent.click(pill)
    fireEvent.click(screen.getByTestId('new-posts-pill'))
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('1 new post')
    expect(screen.getAllByTestId('post-card')).toHaveLength(before)
  })

  it('B3: once the re-read brings the author in, the next tap renders the post', async () => {
    const template = SEEDED_PERSONAS[0]
    if (template === undefined) throw new Error('the seeded cast is empty')
    const late: StaffPersona = {
      ...template,
      id: 'persona-created-after-page-load',
      handle: 'LateJoiner',
      displayName: 'Late Joiner',
    }
    renderFeed()
    await screen.findAllByTestId('post-card')
    act(() => {
      postStore.appendPost(livePost('late-joiner-3', '2033-09-04T16:00:00Z', {
        authorPersonaId: late.id,
      }))
    })
    fireEvent.click(await screen.findByTestId('new-posts-pill'))

    // The author joins the cast before the requested re-read resolves.
    const cast = SEEDED_PERSONAS as StaffPersona[]
    cast.push(late)
    try {
      await flushCastRefresh()
      fireEvent.click(screen.getByTestId('new-posts-pill'))
      await waitFor(() => expect(cardIds()[0]).toBe('late-joiner-3'))
      expect(screen.queryByTestId('new-posts-pill')).toBeNull()
      const loads = getEmittedTelemetryEvents().filter(
        e => e.eventType === 'view' && e.payload !== undefined && 'newPostsLoaded' in e.payload,
      )
      expect(loads).toHaveLength(1)
      expect(loads[0]?.payload?.newPostsLoaded).toBe(1)
    } finally {
      cast.splice(cast.indexOf(late), 1)
    }
  })
})

/** Lets the persona re-read `invalidatePersonas()` started resolve and re-render the feed. */
async function flushCastRefresh(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}
