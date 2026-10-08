/**
 * features/social/components/post/PostReplyContext.test.tsx
 * ---------------------------------------------------------------------------
 * The "Replying to @handle" context line (demo-polish F4, story 13 "Every reply card
 * shows a 'Replying to @handle' line"; SOC-011, NFR-004): nothing for a non-reply
 * (including a wire `null`), one text node for a reply, the '@' added by the
 * component, and a hostile handle rendered as inert text.
 *
 * (Inside a full `<PostCard>` - feed, thread, profile - it is covered with the cards
 * in `ThreadView.test.tsx`, `ThreadView.v2.test.tsx` and `PostCard.parts.test.tsx`.)
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PostInReplyTo } from '../../types/post'
import { PostReplyContext } from './PostReplyContext'

describe('PostReplyContext', () => {
  it('renders nothing for a post that is not a reply', () => {
    const { container } = render(<PostReplyContext />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a wire null (treated as absent)', () => {
    const { container } = render(
      <PostReplyContext inReplyTo={null as unknown as PostInReplyTo} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders "Replying to @handle" as ONE text node, adding the leading @', () => {
    render(<PostReplyContext inReplyTo={{ postId: 'post-1', authorHandle: 'FulcoEM' }} />)

    const line = screen.getByTestId('post-reply-context')
    expect(line).toHaveTextContent('Replying to @FulcoEM')
    expect(line.childNodes).toHaveLength(1)
    expect(screen.getByText('Replying to @FulcoEM')).toBe(line)
  })

  it('renders a hostile handle as inert text, never as markup (NFR-004)', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const { container } = render(
      <PostReplyContext inReplyTo={{ postId: 'post-1', authorHandle: hostile }} />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('post-reply-context')).toHaveTextContent(`Replying to @${hostile}`)
  })

  it('is not interactive (it names the author, it does not link to them)', () => {
    render(<PostReplyContext inReplyTo={{ postId: 'post-1', authorHandle: 'FulcoEM' }} />)

    const line = screen.getByTestId('post-reply-context')
    expect(line.tagName).toBe('P')
    expect(line.querySelector('a, button')).toBeNull()
    expect(line).not.toHaveAttribute('tabindex')
  })
})
