/**
 * features/social/pages/HashtagFeed.hashtagOpen.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 M-4 (+ the `useId()` low). A card on a hashtag page can lead to a
 * DIFFERENT hashtag:
 *
 *  - `HashtagFeed` takes `onHashtagOpen` and threads it to every `<PostCard>`: a
 *    `#Other` in a card is a link that fires it with the normalized tag; without the
 *    prop the hashtag stays inert text (no focusable no-op);
 *  - routed (`renderChannel`): on `/hashtag/<tag>`, activating `#Other` in a card moves
 *    the address bar to `/hashtag/other` and the page re-points at it (the route supplies
 *    `openHashtag`);
 *  - the heading / tab / panel ids come from `useId()`, so two instances on one page never
 *    share an id, and a tab's `aria-controls` still names the panel it controls.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { resetReplyIntent } from '../services/replyIntent'
import { seedPost } from '../explore/exploreTestUtils'
import { RouterProbe } from '../layout/RouterProbe.testUtils'
import { renderChannel } from '../layout/renderChannel.testUtils'
import { HashtagFeed, type HashtagFeedProps } from './HashtagFeed'

function renderFeed(props: HashtagFeedProps) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          <HashtagFeed {...props} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  seedPost({ id: 'ho-1', text: 'Water at the depot #PolishTag and #OtherTag', at: '2033-09-04T10:00:00Z' })
})

afterEach(() => {
  postStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
  resetReplyIntent()
  vi.restoreAllMocks()
})

describe('HashtagFeed — a card\'s other hashtag (M-4)', () => {
  it('fires onHashtagOpen with the normalized tag for a different hashtag in a card', async () => {
    const onHashtagOpen = vi.fn<(tag: string) => void>()
    const user = userEvent.setup()
    renderFeed({ tag: 'polishtag', onHashtagOpen })

    const card = await screen.findByTestId('post-card')
    await user.click(within(card).getByRole('link', { name: '#OtherTag' }))

    expect(onHashtagOpen).toHaveBeenCalledTimes(1)
    expect(onHashtagOpen).toHaveBeenCalledWith('othertag')
  })

  it('leaves hashtags as inert text (no link) when no opener is supplied', async () => {
    renderFeed({ tag: 'polishtag' })

    const card = await screen.findByTestId('post-card')
    expect(within(card).queryByRole('link', { name: '#OtherTag' })).not.toBeInTheDocument()
    expect(within(card).getByText('#OtherTag')).toBeInTheDocument()
  })
})

describe('HashtagRoute — a card\'s other hashtag navigates (M-4)', () => {
  it('on /hashtag/polishtag, #OtherTag in a card opens /hashtag/othertag', async () => {
    const user = userEvent.setup()
    renderChannel({ entries: ['/hashtag/polishtag'], beside: <RouterProbe /> })

    const card = await screen.findByTestId('post-card')
    expect(screen.getByTestId('router-location')).toHaveTextContent('/hashtag/polishtag')
    await user.click(within(card).getByRole('link', { name: '#OtherTag' }))

    await waitFor(() =>
      expect(screen.getByTestId('router-location')).toHaveTextContent('/hashtag/othertag'),
    )
    expect(await screen.findByRole('heading', { level: 1, name: '#OtherTag' })).toBeInTheDocument()
  })
})

describe('HashtagFeed — ids are per instance (useId)', () => {
  it('two instances share no id, and each active tab controls a real panel', async () => {
    renderFeed({ tag: 'polishtag' })
    renderFeed({ tag: 'othertag' })
    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(2))

    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const tab of screen.getAllByRole('tab', { selected: true })) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).not.toBeNull()
      const panel = document.getElementById(panelId ?? '')
      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
    }
  })
})
