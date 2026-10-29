/**
 * features/social/components/post/PostCard.readOnlyEmbed.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 21, "Read-only PostCard (R-S1, COR-015)": with `readOnly` the whole
 * engagement row (reply / repost / like / pin / edit, its counts and its live region) is
 * ABSENT from the DOM and the a11y tree, not disabled. There is no share, follow or
 * overflow control on a card either way. The author and open targets remain when wired,
 * the anatomy and the verified seal are unchanged (the read-only card IS the default card
 * minus the row), and the "Edited" marker still shows. Omitting the prop (or passing
 * `false`) renders byte-identical markup to before.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaById, personaIdForHandle } from '@/features/personas'
import { editedPostsStore } from '../../edit/editedPostsStore'
import { PostCard } from './PostCard'
import type { PostView } from './types'

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FulcoEM'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-embed-1',
    author,
    text: 'Distribution opens at 3 PM. #WaterIssues',
    counts: { reply: 12, repost: 1450, like: 3 },
    viewer: { liked: false, reposted: false },
    scenarioTime: '2033-09-04T14:00:00.000Z',
    ...overrides,
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>{children}</SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )
}

async function renderCards(node: ReactNode) {
  const utils = render(<Providers>{node}</Providers>)
  await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
  return utils
}

const ACTION_NAMES = /reply|repost|like|pin|edit post|share|follow|more|menu|options/i

afterEach(() => {
  editedPostsStore.reset()
  vi.restoreAllMocks()
})

describe('PostCard readOnly (embedded)', () => {
  it('has no engagement row in the DOM or the a11y tree', async () => {
    await renderCards(<PostCard post={buildPost()} readOnly />)
    const card = screen.getByTestId('post-card')

    expect(within(card).queryByTestId('post-actions')).toBeNull()
    expect(within(card).queryByTestId('post-actions-notice')).toBeNull()
    expect(card.querySelector('[data-action]')).toBeNull()
    expect(within(card).queryAllByRole('button', { name: ACTION_NAMES })).toEqual([])
    expect(within(card).queryByRole('status')).toBeNull()
    // Not even the inert label/count text: absent, not disabled.
    expect(within(card).queryByText('Reply')).toBeNull()
    expect(within(card).queryByText('1.4K')).toBeNull()
    expect(card.querySelector('[disabled], [aria-disabled="true"]')).toBeNull()
  })

  it('has no interactive control at all when nothing is wired', async () => {
    await renderCards(<PostCard post={buildPost()} readOnly />)
    const card = screen.getByTestId('post-card')

    expect(card.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')).toHaveLength(0)
  })

  it('keeps the author, open and hashtag targets when the host wires them', async () => {
    const onOpen = vi.fn()
    const onOpenProfile = vi.fn()
    const onHashtagOpen = vi.fn()
    await renderCards(
      <PostCard
        post={buildPost()}
        readOnly
        onOpen={onOpen}
        onOpenProfile={onOpenProfile}
        onHashtagOpen={onHashtagOpen}
      />,
    )
    const card = screen.getByTestId('post-card')

    within(card).getByTestId('post-author-target').click()
    within(card).getByTestId('post-open-target').click()
    within(card).getByRole('link', { name: /#WaterIssues/i }).click()

    expect(onOpenProfile).toHaveBeenCalledWith(personaIdForHandle('FulcoEM'))
    expect(onOpen).toHaveBeenCalledWith('post-embed-1')
    expect(onHashtagOpen).toHaveBeenCalledWith('waterissues')
    // Every remaining control is named (no unnamed button in the a11y tree).
    for (const control of within(card).getAllByRole('button')) {
      expect(control).toHaveAccessibleName()
    }
  })

  it('keeps the anatomy: identical to the default card minus the engagement row', async () => {
    const post = buildPost()
    await renderCards(
      <>
        <div data-testid="full"><PostCard post={post} /></div>
        <div data-testid="embed"><PostCard post={post} readOnly /></div>
      </>,
    )
    const full = screen.getByTestId('full').querySelector('[data-testid="post-card"]')
    const embed = screen.getByTestId('embed').querySelector('[data-testid="post-card"]')
    if (full === null || embed === null) throw new Error('cards not rendered')

    const stripped = full.cloneNode(true) as Element
    stripped.querySelector('[data-testid="post-actions"]')?.remove()
    stripped.querySelector('[data-testid="post-actions-notice"]')?.remove()

    expect(embed.outerHTML).toBe(stripped.outerHTML)
    // The verified seal is part of that unchanged anatomy, and the time stays scenario time.
    expect(within(embed as HTMLElement).getByRole('img', { name: /verified/i })).toBeInTheDocument()
    expect(embed.querySelector('time')?.getAttribute('dateTime')).toBe(post.scenarioTime)
  })

  it('still shows the "Edited" marker (the card seeds it, with no row to)', async () => {
    await renderCards(
      <PostCard
        post={buildPost({ edited: { count: 1, scenarioTime: '2033-09-04T14:05:00.000Z' } })}
        readOnly
      />,
    )

    expect(await screen.findByRole('button', { name: 'Edited, view edit history' })).toBeInTheDocument()
  })
})

describe('PostCard default rendering is unchanged', () => {
  it('omitting readOnly and readOnly={false} render byte-identical markup, row included', async () => {
    const post = buildPost()
    await renderCards(
      <>
        <div data-testid="omitted"><PostCard post={post} /></div>
        <div data-testid="explicit"><PostCard post={post} readOnly={false} /></div>
      </>,
    )
    const omitted = screen.getByTestId('omitted')
    const explicit = screen.getByTestId('explicit')

    expect(within(omitted).getByTestId('post-actions')).toBeInTheDocument()
    expect(explicit.innerHTML).toBe(omitted.innerHTML)
  })

  it("the observer variant is untouched: inert counts stay ('readOnly' variant ≠ readOnly prop)", async () => {
    await renderCards(<PostCard post={buildPost()} variant="readOnly" />)
    const card = screen.getByTestId('post-card')

    expect(within(card).getByTestId('post-actions')).toBeInTheDocument()
    expect(card.querySelector('span[data-action="reply"]')).not.toBeNull()
  })
})
