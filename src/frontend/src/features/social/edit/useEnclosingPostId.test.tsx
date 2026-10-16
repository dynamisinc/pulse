/**
 * features/social/edit/useEnclosingPostId.test.tsx
 * ---------------------------------------------------------------------------
 * `PostHeader` / `PostBody` are given no post object by `PostCard` (story 21 owns it), so they
 * resolve their post from the enclosing `<article data-post-id>`; an explicit `postId` prop wins,
 * and with neither there is no overlay (nothing breaks outside a card).
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PostBody } from '../components/post/PostBody'
import { editedPostsStore } from './editedPostsStore'

const FRAME = {
  postId: 'p-card',
  text: 'edited text',
  edited: { count: 1, scenarioTime: '2033-09-04T10:01:00Z' },
  version: 1,
}

afterEach(() => editedPostsStore.resetForTests())

describe('useEnclosingPostId via PostBody', () => {
  it('reads the id from the enclosing article', () => {
    editedPostsStore.apply(FRAME)
    render(<article data-post-id="p-card"><PostBody text="original" /></article>)

    expect(screen.getByText('edited text')).toBeInTheDocument()
  })

  it('prefers an explicit postId over the enclosing article', () => {
    editedPostsStore.apply(FRAME)
    render(<article data-post-id="other"><PostBody text="original" postId="p-card" /></article>)

    expect(screen.getByText('edited text')).toBeInTheDocument()
  })

  it('shows its own text outside any card', () => {
    editedPostsStore.apply(FRAME)
    render(<PostBody text="original" />)

    expect(screen.getByText('original')).toBeInTheDocument()
  })
})
