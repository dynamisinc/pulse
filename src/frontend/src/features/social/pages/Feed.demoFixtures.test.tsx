/**
 * features/social/pages/Feed.demoFixtures.test.tsx
 * ---------------------------------------------------------------------------
 * Smoke test for what `npm run dev` shows (demo-polish F0, implementation.md §5):
 * `<Feed>` over the RICH v2 fixture set (`postStore.resetForTests({ withDemoFixtures:
 * true })`) renders every top-level fixture post through the decomposed card
 * without crashing, keeps REPLIES out of the top-level feed, shows each media
 * post's attachments (alt text, image AND video), carries the viewer's liked state
 * onto the card, and leaks no provenance (XC-002). The default seed (the canonical
 * six) is covered by `Feed.test.tsx`.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { DEMO_IDS, listDemoFixturePosts } from '../services/mockFixtures'
import { listPosts } from '../services/postService'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

const TOP_LEVEL_IDS = [
  ...listPosts().map(p => p.id),
  ...listDemoFixturePosts().filter(p => p.inReplyTo === undefined).map(p => p.id),
]
const REPLY_IDS = listDemoFixturePosts().filter(p => p.inReplyTo !== undefined).map(p => p.id)

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

function card(id: string): HTMLElement {
  const found = screen
    .getAllByTestId('post-card')
    .find(candidate => candidate.getAttribute('data-post-id') === id)
  if (found === undefined) throw new Error(`no card for ${id}`)
  return found
}

/** Waits for the SPECIFIC card (not merely "some card") — the list renders as the
 * baseline resolves, so asserting on a card the first `findAll` happened to see
 * can race under CI load. */
function findCard(id: string): Promise<HTMLElement> {
  return waitFor(() => card(id))
}

beforeEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests({ withDemoFixtures: true })
})

afterEach(() => {
  postStore.resetForTests()
  resetTelemetryBuffer()
})

describe('Feed over the v2 demo fixtures', () => {
  it('renders every top-level post and NO reply', async () => {
    renderFeed()
    await waitFor(() =>
      expect(screen.getAllByTestId('post-card')).toHaveLength(TOP_LEVEL_IDS.length))

    const rendered = screen.getAllByTestId('post-card').map(c => c.getAttribute('data-post-id'))
    expect([...rendered].sort()).toEqual([...TOP_LEVEL_IDS].sort())
    for (const replyId of REPLY_IDS) expect(rendered).not.toContain(replyId)
    expect(screen.queryAllByTestId('post-reply-context')).toHaveLength(0)
  })

  it('shows media posts\' attachments with their alt text, image and video alike', async () => {
    renderFeed()

    // Scoped to the media slot: a verified author's seal is also a role="img".
    const attachments = async (id: string) =>
      within(within(await findCard(id)).getByTestId('post-media')).getAllByRole('img')
    expect(await attachments(DEMO_IDS.grid1)).toHaveLength(1)
    expect(await attachments(DEMO_IDS.grid2)).toHaveLength(2)
    expect(await attachments(DEMO_IDS.grid3)).toHaveLength(3)
    expect(await attachments(DEMO_IDS.grid4)).toHaveLength(4)
    for (const id of [DEMO_IDS.videoPoster, DEMO_IDS.videoNoPoster]) {
      const [placeholder] = await attachments(id)
      expect(placeholder?.getAttribute('aria-label')?.length).toBeGreaterThan(10)
    }
  })

  it('starts the viewer-liked fixtures in the liked state (aria-pressed, name suffix)', async () => {
    renderFeed()
    const liked = await findCard(DEMO_IDS.grid1)
    const notLiked = await findCard(DEMO_IDS.countsModest)

    expect(within(liked).getByRole('button', { name: 'Like, 124, liked' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(notLiked).getByRole('button', { name: 'Like, 1000' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('leaks no provenance value into the DOM (XC-002)', async () => {
    const { container } = renderFeed()
    // The LAST fixture in newest-first order is the oldest top-level post: once it
    // is on screen the whole list has rendered.
    await findCard(DEMO_IDS.hashtagReminder)

    const provenance = /human-simcell|human-participant|system-engine|ex-mock-0001/
    expect(container.textContent).not.toMatch(provenance)
  })
})
