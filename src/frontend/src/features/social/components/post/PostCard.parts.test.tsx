/**
 * features/social/components/post/PostCard.parts.test.tsx
 * ---------------------------------------------------------------------------
 * The decomposed `<PostCard>` composes every part and every slot is ALREADY
 * mounted (demo-polish F0, implementation.md §4.3): header -> reply context ->
 * body -> media slot -> link card -> actions, in that DOM order, with the stable
 * DOM hooks (`post-card`, `data-post-id`, `post-open-target`, `post-author-target`,
 * `post-media`, `post-link-preview`, `post-actions`, `data-action`). A reply card
 * shows its reply context; a plain card shows none. The legacy re-export shim
 * resolves to the very same component. (Behavioural PostCard coverage lives in
 * `components/PostCard*.test.tsx`; time is covered there via `useScenarioTime`.)
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostCard as ShimPostCard } from '../PostCard'
import { PostCard } from './PostCard'
import type { PostView } from './types'

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FulcoEM'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-parts-1',
    author,
    text: 'Distribution opens at 3 PM. #WaterIssues',
    counts: { reply: 1, repost: 2, like: 3 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

async function renderCard(node: ReactNode) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>{node}</SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())
  return utils
}

/** True when `a` comes before `b` in document order. */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('PostCard — composition and DOM hooks', () => {
  it('mounts every slot in order: header, reply context, body, media, link card, actions', async () => {
    await renderCard(
      <PostCard
        post={buildPost({
          inReplyTo: { postId: 'post-parent', authorHandle: 'mvega_fh' },
          media: [{ id: 'm1', kind: 'image', url: '/u.png', alt: 'A photo' }],
          linkPreview: { title: 'County update', domain: 'fulco.gov' },
        })}
        onOpen={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    const card = screen.getByTestId('post-card')
    expect(card).toHaveAttribute('data-post-id', 'post-parts-1')
    const header = card.querySelector('header')
    const reply = screen.getByTestId('post-reply-context')
    const body = screen.getByText(/Distribution opens at 3 PM/)
    const media = screen.getByTestId('post-media')
    const link = screen.getByTestId('post-link-preview')
    const actions = screen.getByTestId('post-actions')
    expect(header).not.toBeNull()
    if (header === null) return

    expect(before(header, reply)).toBe(true)
    expect(before(reply, body)).toBe(true)
    expect(before(body, media)).toBe(true)
    expect(before(media, link)).toBe(true)
    expect(before(link, actions)).toBe(true)
    expect(screen.getByTestId('post-open-target')).toBeInTheDocument()
    expect(screen.getByTestId('post-author-target')).toHaveAttribute('data-persona-id', 'persona-fulcoem')
    expect(card.querySelectorAll('button[data-action]')).toHaveLength(3)
  })

  it('shows "Replying to @handle" for a reply and nothing for a plain post', async () => {
    const { rerender } = await renderCard(
      <PostCard post={buildPost({ inReplyTo: { postId: 'p0', authorHandle: 'mvega_fh' } })} />,
    )
    expect(screen.getByTestId('post-reply-context')).toHaveTextContent('Replying to @mvega_fh')

    rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <PostCard post={buildPost()} />
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    expect(screen.queryByTestId('post-reply-context')).not.toBeInTheDocument()
  })

  it('renders no media slot or link card when the post has none', async () => {
    await renderCard(<PostCard post={buildPost()} />)

    expect(screen.queryByTestId('post-media')).not.toBeInTheDocument()
    expect(screen.queryByTestId('post-link-preview')).not.toBeInTheDocument()
  })

  it('renders an accessible placeholder for an image AND a video attachment (F0 behaviour)', async () => {
    await renderCard(
      <PostCard
        post={buildPost({
          media: [
            { id: 'i', kind: 'image', url: '/i.png', alt: 'Flooded street' },
            { id: 'v', kind: 'video', url: '/v.mp4', alt: 'Crew briefing clip', durationSec: 4 },
          ],
        })}
      />,
    )

    expect(screen.getByRole('img', { name: 'Flooded street' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Crew briefing clip' })).toBeInTheDocument()
  })

  it('is the same component through the legacy components/PostCard re-export shim', () => {
    expect(ShimPostCard).toBe(PostCard)
  })
})
