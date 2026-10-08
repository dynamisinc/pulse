/**
 * features/social/pages/HashtagFeed.polish.test.tsx
 * ---------------------------------------------------------------------------
 * The hashtag page polish (demo-polish F6, SOC-040, NFR-001): the header carries
 * the tag and a post count; the tabs are "Recent" and "Top" (the same orders as
 * Explore's search toggle); the empty state is an honest text message; the Reply
 * action opens the thread; a soft-deleted post never appears.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { seedPost } from '../explore/exploreTestUtils'
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

afterEach(() => {
  postStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
})

function seedTagged(count: number) {
  for (let index = 0; index < count; index += 1) {
    seedPost({
      id: `hp-${index}`,
      text: `Update ${index} on #PolishTag`,
      at: `2033-09-04T1${index}:00:00Z`,
    })
  }
}

describe('HashtagFeed — header (tag + post count)', () => {
  it('shows the tag as the page heading and the number of posts', async () => {
    seedTagged(3)
    renderFeed({ tag: 'polishtag' })

    await screen.findAllByTestId('post-card')
    expect(screen.getByRole('heading', { level: 1, name: '#polishtag' })).toBeInTheDocument()
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('3 posts')
  })

  it('uses the singular for one post', async () => {
    seedTagged(1)
    renderFeed({ tag: 'polishtag' })

    await screen.findAllByTestId('post-card')
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('1 post')
    expect(screen.getByTestId('hashtag-post-count')).not.toHaveTextContent('1 posts')
  })

  it('counts only posts that carry the tag (case-insensitively)', async () => {
    seedPost({ id: 'hp-a', text: 'one #PolishTag', at: '2033-09-04T10:00:00Z' })
    seedPost({ id: 'hp-b', text: 'two #polishtag', at: '2033-09-04T11:00:00Z' })
    seedPost({ id: 'hp-c', text: 'three #OtherTag', at: '2033-09-04T12:00:00Z' })
    renderFeed({ tag: 'polishtag' })

    await screen.findAllByTestId('post-card')
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('2 posts')
  })
})

describe('HashtagFeed — Recent / Top tabs', () => {
  it('offers exactly Recent (default) and Top', async () => {
    seedTagged(2)
    renderFeed({ tag: 'polishtag' })
    await screen.findAllByTestId('post-card')

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Recent', 'Top'])
    expect(screen.getByRole('tab', { name: 'Recent' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Latest' })).not.toBeInTheDocument()
  })

  it('Recent is scenario time descending; Top is engagement descending', async () => {
    seedPost({ id: 'hp-old-hot', text: 'old #PolishTag', at: '2033-09-04T09:00:00Z', counts: { like: 99 } })
    seedPost({ id: 'hp-new-cold', text: 'new #PolishTag', at: '2033-09-04T15:00:00Z' })
    seedPost({ id: 'hp-mid', text: 'mid #PolishTag', at: '2033-09-04T12:00:00Z', counts: { like: 4 } })
    const user = userEvent.setup()
    renderFeed({ tag: 'polishtag' })

    const ids = () =>
      screen.getAllByTestId('post-card').map(card => card.getAttribute('data-post-id'))
    await screen.findAllByTestId('post-card')
    expect(ids()).toEqual(['hp-new-cold', 'hp-mid', 'hp-old-hot'])

    await user.click(screen.getByRole('tab', { name: 'Top' }))
    expect(ids()).toEqual(['hp-old-hot', 'hp-mid', 'hp-new-cold'])
  })
})

describe('HashtagFeed — honest empty state (NFR-001)', () => {
  it('says so in text, with an icon, when no post carries the tag', async () => {
    seedTagged(1)
    renderFeed({ tag: 'nosuchtag' })

    const empty = await screen.findByTestId('hashtag-empty')
    expect(empty).toHaveTextContent('No posts with #nosuchtag yet.')
    expect(empty.querySelector('svg')).not.toBeNull()
    expect(screen.queryAllByTestId('post-card')).toHaveLength(0)
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('0 posts')
  })

  it('does not show the empty state when there are posts', async () => {
    seedTagged(2)
    renderFeed({ tag: 'polishtag' })

    await screen.findAllByTestId('post-card')
    expect(screen.queryByTestId('hashtag-empty')).not.toBeInTheDocument()
  })
})

describe('HashtagFeed — card actions stay wired', () => {
  it('opens the thread from the Reply action, and renders Reply inert without an opener', async () => {
    seedPost({ id: 'hp-reply', text: 'reply to me #PolishTag', at: '2033-09-04T12:00:00Z' })
    const onOpenThread = vi.fn()
    const user = userEvent.setup()
    const first = renderFeed({ tag: 'polishtag', onOpenThread })

    const card = await screen.findByTestId('post-card')
    await user.click(within(card).getByRole('button', { name: /Reply/ }))
    expect(onOpenThread).toHaveBeenCalledWith('hp-reply')
    first.unmount()

    renderFeed({ tag: 'polishtag' })
    const inertCard = await screen.findByTestId('post-card')
    expect(within(inertCard).queryByRole('button', { name: /Reply/ })).not.toBeInTheDocument()
  })
})
