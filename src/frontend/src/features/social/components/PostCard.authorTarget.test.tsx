/**
 * features/social/components/PostCard.authorTarget.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the author tap-through target added by the profiles-social-graph
 * integration pass (#88, SOC-050, NFR-001, WR-001/WR-002):
 *  - when `onOpenProfile` IS wired, the author identity gets a real, keyboard-
 *    operable `<button>` with the accessible name "View {displayName}'s
 *    profile", firing with the AUTHOR's persona id;
 *  - that button is a SIBLING of the card's body-open overlay, never nested
 *    inside it (and vice versa) — an interactive element inside another is
 *    invalid ARIA and was the WR-001 Gate-2 finding;
 *  - tapping the author never ALSO opens the thread, and the card's own
 *    thread-open target still works and is not shadowed;
 *  - when `onOpenProfile` is NOT wired the header renders as before: no
 *    button, no focusable no-op (WR-002), identity still readable, and the
 *    verified seal keeps its own accessible name either way (SOC-052 — the
 *    trust signal is never swallowed into a control's label).
 *
 * Exercises `<PostCard>` as a black box through the same real
 * `ExerciseContextProvider` harness as `PostCard.hashtags.test.tsx`.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostCard, type PostCounts, type PostView } from './PostCard'

async function renderWithExerciseContext(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())
  return utils
}

function buildCounts(overrides: Partial<PostCounts> = {}): PostCounts {
  return { reply: 1, repost: 2, like: 3, ...overrides }
}

/** A post by the VERIFIED agency account, so the seal renders alongside the
 * author target (the SOC-052 signal must survive the new control). */
function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-author-target-1',
    author,
    text: 'Crews are flushing the main on Elm Street.',
    counts: buildCounts(),
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

describe('PostCard — author tap-through when onOpenProfile IS wired (SOC-050)', () => {
  it('renders a keyboard-operable button named "View {displayName}\'s profile"', async () => {
    const post = buildPost()
    await renderWithExerciseContext(<PostCard post={post} onOpenProfile={vi.fn()} />)

    const target = screen.getByRole('button', {
      name: `View ${post.author.displayName}'s profile`,
    })
    expect(target).toBe(screen.getByTestId('post-author-target'))
    expect(target.tagName.toLowerCase()).toBe('button')
    // A real <button> — natively focusable and Enter/Space-activated, no
    // custom key handling to get wrong.
    expect(target).not.toHaveAttribute('disabled')
  })

  it('fires onOpenProfile with the AUTHOR persona id on click', async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    const post = buildPost()
    await renderWithExerciseContext(<PostCard post={post} onOpenProfile={onOpenProfile} />)

    await user.click(screen.getByTestId('post-author-target'))

    expect(onOpenProfile).toHaveBeenCalledTimes(1)
    expect(onOpenProfile).toHaveBeenCalledWith(post.author.id)
  })

  it('is reachable and activatable from the keyboard', async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    const post = buildPost()
    await renderWithExerciseContext(<PostCard post={post} onOpenProfile={onOpenProfile} />)

    const target = screen.getByTestId('post-author-target')
    target.focus()
    expect(target).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onOpenProfile).toHaveBeenCalledWith(post.author.id)
  })

  it('does not ALSO open the thread when the author is tapped', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    await renderWithExerciseContext(
      <PostCard post={buildPost()} onOpen={onOpen} onOpenProfile={vi.fn()} />,
    )

    await user.click(screen.getByTestId('post-author-target'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves the card\'s own thread-open target working and unshadowed', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onOpenProfile = vi.fn()
    const post = buildPost()
    await renderWithExerciseContext(
      <PostCard post={post} onOpen={onOpen} onOpenProfile={onOpenProfile} />,
    )

    await user.click(screen.getByTestId('post-open-target'))

    expect(onOpen).toHaveBeenCalledWith(post.id)
    expect(onOpenProfile).not.toHaveBeenCalled()
  })

  it('never nests either overlay inside the other (WR-001)', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost()} onOpen={vi.fn()} onOpenProfile={vi.fn()} />,
    )

    const openTarget = screen.getByTestId('post-open-target')
    const authorTarget = screen.getByTestId('post-author-target')
    expect(openTarget.contains(authorTarget)).toBe(false)
    expect(authorTarget.contains(openTarget)).toBe(false)
    // The identity text and the verified seal stay OUTSIDE the control, so the
    // trust signal is never absorbed into its accessible name (SOC-052).
    const post = buildPost()
    expect(authorTarget.contains(screen.getByText(post.author.displayName))).toBe(false)
    expect(authorTarget.contains(screen.getByTestId('verified-mark'))).toBe(false)
    expect(screen.getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
  })
})

describe('PostCard — author identity when onOpenProfile is NOT wired (WR-002)', () => {
  it('renders no author button at all — never a focusable no-op', async () => {
    const post = buildPost()
    await renderWithExerciseContext(<PostCard post={post} onOpen={vi.fn()} />)

    expect(screen.queryByTestId('post-author-target')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `View ${post.author.displayName}'s profile` }),
    ).not.toBeInTheDocument()
    // Identity still renders as plain, readable text.
    expect(screen.getByText(post.author.displayName)).toBeInTheDocument()
    expect(screen.getByText(`@${post.author.handle}`)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
  })
})
