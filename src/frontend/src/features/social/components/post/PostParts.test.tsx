/**
 * features/social/components/post/PostParts.test.tsx
 * ---------------------------------------------------------------------------
 * The small presentational parts in isolation (demo-polish F0): `PostReplyContext`,
 * `PostMediaSlot`, `PostLinkCard` and `PostBody` — none needs a provider for the
 * cases below (a VIDEO in the media slot does since F2: its player reads the chrome
 * config; that is covered in `PostMediaSlot.test.tsx` under the real providers). Pins
 * the "renders nothing without its input" contract the frozen `PostCard` relies on.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { PostBody } from './PostBody'
import type { PostMediaView } from './types'
import { PostLinkCard } from './PostLinkCard'
import { PostMediaSlot } from './PostMediaSlot'
import { PostReplyContext } from './PostReplyContext'

describe('PostReplyContext', () => {
  it('renders nothing without inReplyTo', () => {
    const { container } = render(<PostReplyContext />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders "Replying to @handle" as ONE text node, adding the @', () => {
    render(<PostReplyContext inReplyTo={{ postId: 'p', authorHandle: 'FulcoEM' }} />)

    expect(screen.getByText('Replying to @FulcoEM')).toBeInTheDocument()
    expect(screen.getByTestId('post-reply-context')).toBeInTheDocument()
  })
})

describe('PostMediaSlot', () => {
  it('renders nothing for undefined or empty media', () => {
    expect(render(<PostMediaSlot postId="p" />).container).toBeEmptyDOMElement()
    expect(render(<PostMediaSlot postId="p" media={[]} />).container).toBeEmptyDOMElement()
  })

  it('renders one labelled tile per image attachment, in order', () => {
    render(
      <PostMediaSlot
        postId="p"
        media={[
          { id: 'a', kind: 'image', url: '/a', alt: 'First' },
          { id: 'b', kind: 'image', url: '/b', alt: 'Second' },
        ]}
      />,
    )

    const items = screen.getAllByRole('img')
    expect(items.map(i => i.getAttribute('alt'))).toEqual(['First', 'Second'])
    expect(screen.getByTestId('post-media')).toBeInTheDocument()
  })

  it('keeps the F0 accessible placeholder for a legacy { kind, alt } attachment with no url', () => {
    render(
      <PostMediaSlot
        postId="p"
        media={[{ id: 'a', kind: 'image', alt: 'First' } as unknown as PostMediaView]}
      />,
    )

    const [placeholder] = screen.getAllByRole('img')
    expect(placeholder?.getAttribute('aria-label')).toBe('First')
    expect(placeholder).toHaveTextContent('First')
  })

  it('keys by media id, so two attachments with the same alt both render', () => {
    render(
      <PostMediaSlot
        postId="p"
        media={[
          { id: 'a', kind: 'image', url: '/a', alt: 'Same' },
          { id: 'b', kind: 'image', url: '/b', alt: 'Same' },
        ]}
      />,
    )

    expect(screen.getAllByRole('img', { name: 'Same' })).toHaveLength(2)
  })
})

describe('PostLinkCard', () => {
  it('renders nothing without a preview', () => {
    expect(render(<PostLinkCard />).container).toBeEmptyDOMElement()
  })

  it('renders the title and in-sim domain, hiding the decorative image label', () => {
    render(
      <PostLinkCard
        linkPreview={{ title: 'Boil water advisory', domain: 'fulco.gov', imageLabel: 'Graphic' }}
      />,
    )

    expect(screen.getByText('Boil water advisory')).toBeInTheDocument()
    expect(screen.getByText('fulco.gov')).toBeInTheDocument()
    expect(screen.getByText('Graphic')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('PostBody', () => {
  it('renders script-like text inert, never as markup (NFR-004)', () => {
    const { container } = render(<PostBody text={'<img src=x onerror=alert(1)>'} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  })

  it('linkifies a hashtag only when a handler is wired, and activating it stops propagation', async () => {
    const onHashtagOpen = vi.fn()
    const onParentClick = vi.fn()
    const user = userEvent.setup()
    render(
      <div onClick={onParentClick} role="presentation">
        <PostBody text="Update #Zone2 now" onHashtagOpen={onHashtagOpen} />
      </div>,
    )

    await user.click(screen.getByText('#Zone2'))

    expect(onHashtagOpen).toHaveBeenCalledWith('zone2')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('renders an inert span (no role, no tab stop) without a handler', () => {
    render(<PostBody text="Update #Zone2 now" />)

    const tag = screen.getByText('#Zone2')
    expect(tag.tagName.toLowerCase()).toBe('span')
    expect(tag).not.toHaveAttribute('role')
    expect(tag).not.toHaveAttribute('tabindex')
  })
})
