/**
 * features/social/components/PostCard.hashtags.test.tsx
 * ---------------------------------------------------------------------------
 * Covers hashtags-trending story 01's PostCard linkify edit (SOC-040,
 * NFR-001, NFR-004) AND the Gate-2 WR-001/WR-002 a11y fixes to it:
 *  - when `onHashtagOpen` IS wired, a hashtag in post text renders as a
 *    keyboard-focusable link carrying the normalized tag, firing the handler
 *    on click/Enter/Space, and a hashtag tap never also opens the post's
 *    thread (stops propagation) — the seam Wave-2 shell wiring reads;
 *  - when `onHashtagOpen` is NOT wired (e.g. `Profile`/`HashtagFeed`), a
 *    hashtag instead renders as an INERT, non-focusable `<span>` — no
 *    role/tabIndex/handler, so it can never be a focusable no-op (WR-002);
 *  - plain text and non-matching "#" look-alikes always stay inert text.
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

describe('PostCard — hashtag linkification when onHashtagOpen IS wired (SOC-040)', () => {
  it('renders a hashtag as a focusable link carrying its normalized tag', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Boil water advisory for #Zone2 residents.' })}
        onHashtagOpen={vi.fn()}
      />,
    )

    const link = screen.getByText('#Zone2')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('role', 'link')
    expect(link).toHaveAttribute('data-hashtag', 'zone2')
    expect(link).toHaveAttribute('tabIndex', '0')
  })

  it('renders surrounding plain text as ordinary text, not part of the link', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Update: #BoilWater lifted for zone 3.' })}
        onHashtagOpen={vi.fn()}
      />,
    )

    expect(screen.getByText(/^Update:/)).toBeInTheDocument()
    expect(screen.getByText('#BoilWater')).toHaveAttribute('data-hashtag', 'boilwater')
    expect(screen.getByText(/lifted for zone 3\.$/)).toBeInTheDocument()
  })

  it('links multiple distinct hashtags in the same post independently', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: '#Flood and #Evacuation updates.' })} onHashtagOpen={vi.fn()} />,
    )

    const flood = screen.getByText('#Flood')
    const evacuation = screen.getByText('#Evacuation')
    expect(flood).toHaveAttribute('data-hashtag', 'flood')
    expect(flood).toHaveAttribute('role', 'link')
    expect(evacuation).toHaveAttribute('data-hashtag', 'evacuation')
    expect(evacuation).toHaveAttribute('role', 'link')
  })

  it('fires onHashtagOpen with the normalized tag on click', async () => {
    const onHashtagOpen = vi.fn()
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Follow #Zone2 for updates.' })} onHashtagOpen={onHashtagOpen} />,
    )

    screen.getByText('#Zone2').click()

    expect(onHashtagOpen).toHaveBeenCalledWith('zone2')
  })

  it('fires onHashtagOpen with the normalized tag on Enter', async () => {
    const onHashtagOpen = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Follow #Zone2 for updates.' })} onHashtagOpen={onHashtagOpen} />,
    )

    const link = screen.getByText('#Zone2')
    link.focus()
    await user.keyboard('{Enter}')

    expect(onHashtagOpen).toHaveBeenCalledWith('zone2')
  })

  it('a hashtag click does not also fire the card\'s onOpen (stops propagation)', async () => {
    const onOpen = vi.fn()
    const onHashtagOpen = vi.fn()
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Follow #Zone2 for updates.' })}
        onOpen={onOpen}
        onHashtagOpen={onHashtagOpen}
      />,
    )

    screen.getByText('#Zone2').click()

    expect(onHashtagOpen).toHaveBeenCalledWith('zone2')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a hashtag Enter keypress does not also fire the card\'s onOpen', async () => {
    const onOpen = vi.fn()
    const onHashtagOpen = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Follow #Zone2 for updates.' })}
        onOpen={onOpen}
        onHashtagOpen={onHashtagOpen}
      />,
    )

    const link = screen.getByText('#Zone2')
    link.focus()
    await user.keyboard('{Enter}')

    expect(onHashtagOpen).toHaveBeenCalledWith('zone2')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('the hashtag link is never a descendant of the card\'s open-region button (WR-001)', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ text: 'Follow #Zone2 for updates.' })}
        onOpen={vi.fn()}
        onHashtagOpen={vi.fn()}
      />,
    )

    const openButton = screen.getByTestId('post-open-target')
    const link = screen.getByText('#Zone2')

    expect(openButton.contains(link)).toBe(false)
  })
})

describe('PostCard — hashtag rendering when onHashtagOpen is NOT wired (WR-002, NFR-001)', () => {
  it('renders a hashtag as an inert, non-focusable span rather than a link', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Boil water advisory for #Zone2 residents.' })} />,
    )

    const tag = screen.getByText('#Zone2')
    expect(tag.tagName.toLowerCase()).toBe('span')
    expect(tag).toHaveAttribute('data-hashtag', 'zone2')
    expect(tag).not.toHaveAttribute('role')
    expect(tag).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders multiple unwired hashtags as independent inert spans, still tagged', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: '#Flood and #Evacuation updates.' })} />,
    )

    const flood = screen.getByText('#Flood')
    const evacuation = screen.getByText('#Evacuation')
    expect(flood.tagName.toLowerCase()).toBe('span')
    expect(flood).toHaveAttribute('data-hashtag', 'flood')
    expect(evacuation.tagName.toLowerCase()).toBe('span')
    expect(evacuation).toHaveAttribute('data-hashtag', 'evacuation')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('is a no-op on click — no onOpen leak, and nothing throws', async () => {
    const onOpen = vi.fn()
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'Follow #Zone2 for updates.' })} onOpen={onOpen} />,
    )

    expect(() => screen.getByText('#Zone2').click()).not.toThrow()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PostCard — non-hashtag text stays inert (SOC-040)', () => {
  it('does not linkify a non-hashtag "#" look-alike (e.g. "C#")', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'I write C#code for a living.' })} onHashtagOpen={vi.fn()} />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('I write C#code for a living.')).toBeInTheDocument()
  })

  it('does not linkify a pure-number hashtag ("#2024")', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ text: 'see you in #2024' })} onHashtagOpen={vi.fn()} />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('PostCard — hashtag content security (NFR-004)', () => {
  it('renders a hashtag inside otherwise script-like text as inert text, never parsed HTML', async () => {
    const maliciousText = '<img src=x onerror=alert(1)> check #Advisory now'
    const { container } = await renderWithExerciseContext(
      <PostCard post={buildPost({ text: maliciousText })} onHashtagOpen={vi.fn()} />,
    )

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('#Advisory')).toHaveAttribute('data-hashtag', 'advisory')
  })
})
