/**
 * features/controller/services/takedownService.feedBeat.test.tsx
 * ---------------------------------------------------------------------------
 * THE MODERATION BEAT end to end in MOCK mode (demo-polish C5, story 22 "Mock mode: the full beat
 * is demonstrable on `npm run dev`"; demo beat 5): the console's takedown call and an OPEN
 * participant Home feed in the same tab. Real service, real `postStore`, real `removedPosts`,
 * real `<Feed>`:
 *  - a post on screen vanishes the moment the takedown call resolves - no refresh;
 *  - it stays gone when the feed is mounted afresh (the mock backend's soft delete: the read no
 *    longer returns it), and a post taken down before the feed ever mounted never appears;
 *  - an unrelated post is untouched; and the participant DOM keeps no trace of the removed text.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { Feed } from '@/features/social/pages/Feed'
import { ownPostStore } from '@/features/social/services/ownPostStore'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { takeDownPost } from './takedownService'

const TARGET = 'post-seed-fwupd-rumor'

function feedElement() {
  return (
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>
  )
}

function ids(): (string | null)[] {
  return screen.getAllByTestId('post-card').map(card => card.getAttribute('data-post-id'))
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  removedPosts.resetForTests()
  resetExerciseClock()
})

describe('the moderation beat in mock mode', () => {
  it('an open participant feed drops the post when the console takes it down - no refresh', async () => {
    render(feedElement())
    await screen.findAllByTestId('post-card')
    expect(ids()).toContain(TARGET)
    const text = screen.getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === TARGET)?.textContent ?? ''

    await act(async () => {
      await takeDownPost(TARGET, 'pii')
    })

    expect(ids()).not.toContain(TARGET)
    expect(ids()).toHaveLength(5)
    expect(document.body.textContent ?? '').not.toContain(text)
  })

  it('it stays gone when the feed is mounted afresh (the read no longer returns it)', async () => {
    const first = render(feedElement())
    await screen.findAllByTestId('post-card')
    await act(async () => {
      await takeDownPost(TARGET, 'other')
    })
    first.unmount()
    // A new participant session on the same tab starts clean - but the mock backend has deleted it.
    removedPosts.resetForTests()

    render(feedElement())
    await screen.findAllByTestId('post-card')

    expect(ids()).not.toContain(TARGET)
    expect(ids()).toHaveLength(5)
  })

  it('a post taken down before the feed mounted never appears', async () => {
    await takeDownPost(TARGET, 'inappropriate')

    render(feedElement())
    await screen.findAllByTestId('post-card')

    expect(ids()).not.toContain(TARGET)
  })
})
