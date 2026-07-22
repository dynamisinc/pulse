/**
 * features/social/components/PostCard.hashtags.test.tsx
 * ---------------------------------------------------------------------------
 * Covers hashtags-trending story 01's PostCard linkify edit (SOC-040,
 * NFR-001, NFR-004): a hashtag in post text renders as a keyboard-focusable
 * link carrying the normalized tag (the seam Wave-2 shell wiring reads),
 * while plain text and non-matching "#" look-alikes stay inert text, and a
 * hashtag tap never also opens the post's thread.
 *
 * Renders through the same real `ExerciseContextProvider` pattern as
 * `PostCard.test.tsx` (this is a NEW test file — it exercises `PostCard` as a
 * black box only, never touching the action-row/props source).
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostCard, type PostCounts, type PostView } from './PostCard'
import type { ReactNode } from 'react'

async function renderWithExerciseContext(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())
  return utils
}

function buildCounts(overrides: Partial<PostCounts> = {}): PostCounts {
  return { reply: 1, repost: 2, like: 3, ...overrides }
}

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-hashtag-1',
    author,
    text: 'placeholder',
    counts: buildCounts(),
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

describe('PostCard — hashtag linkification (SOC-040)', () => {
  it('renders a hashtag as a focusable link carrying its normalized tag', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Boil water advisory for #Zone2 residents.' })} />,
    )

    const link = screen.getByText('#Zone2')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('role', 'link')
    expect(link).toHaveAttribute('data-hashtag', 'zone2')
    expect(link).toHaveAttribute('tabIndex', '0')
  })

  it('renders surrounding plain text as ordinary text, not part of the link', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Update: #BoilWater lifted for zone 3.' })} />,
    )

    expect(screen.getByText(/^Update:/)).toBeInTheDocument()
    expect(screen.getByText('#BoilWater')).toHaveAttribute('data-hashtag', 'boilwater')
    expect(screen.getByText(/lifted for zone 3\.$/)).toBeInTheDocument()
  })

  it('links multiple distinct hashtags in the same post independently', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: '#Flood and #Evacuation updates.' })} />,
    )

    expect(screen.getByText('#Flood')).toHaveAttribute('data-hashtag', 'flood')
    expect(screen.getByText('#Evacuation')).toHaveAttribute('data-hashtag', 'evacuation')
  })

  it('does not linkify a non-hashtag "#" look-alike (e.g. "C#")', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'I write C#code for a living.' })} />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('I write C#code for a living.')).toBeInTheDocument()
  })

  it('does not linkify a pure-number hashtag ("#2024")', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'see you in #2024' })} />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders a hashtag inside otherwise script-like text as inert text, never parsed HTML (NFR-004)', async () => {
    const maliciousText = '<img src=x onerror=alert(1)> check #Advisory now'
    const { container } = await renderWithExerciseContext(
      <PostCard post={buildPost({ text: maliciousText })} />,
    )

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('#Advisory')).toHaveAttribute('data-hashtag', 'advisory')
  })

  it('a hashtag click does not also fire the card\'s onOpen (stops propagation)', async () => {
    const onOpen = vi.fn()
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Follow #Zone2 for updates.' })}
        onOpen={onOpen}
      />,
    )

    screen.getByText('#Zone2').click()

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a hashtag Enter keypress does not also fire the card\'s onOpen', async () => {
    const onOpen = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Follow #Zone2 for updates.' })}
        onOpen={onOpen}
      />,
    )

    const link = screen.getByText('#Zone2')
    link.focus()
    await user.keyboard('{Enter}')

    expect(onOpen).not.toHaveBeenCalled()
  })
})
