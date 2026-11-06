/**
 * news-network 06, "Cross-channel consistency test" (SOC-002/004, D3-P2): the same post
 * embedded in the Metro Desk 9 (newsline7), Courier-Ledger, National Wire and The Scoop
 * article bodies renders IDENTICAL post-card markup (every element, class token and
 * attribute), and that markup equals the feed's own card for the post minus the
 * engagement row (the one thing a read-only embed omits, F21).
 */
import { useMemo } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePersonas } from '@/features/personas'
import {
  PostCard,
  SocialBrandScope,
  toParticipantView,
  toPostView,
  type Post,
} from '@/features/social'
import { ArticleBody } from './ArticleBody'
import { OUTLET_SKINS, Providers, buildPost, renderInSkin, stubThreadRead } from './bodyTestUtils'

afterEach(() => {
  vi.restoreAllMocks()
})

const POST = buildPost('p-embed', { text: 'Do NOT drink tap water in Zone 3. #WaterIssues' })
const BODY = '<p>Officials said:</p><pulse-post data-id="p-embed"></pulse-post><p>More soon.</p>'

/** The rendered card, as markup. */
async function cardMarkup(): Promise<string> {
  const card = await screen.findByTestId('post-card')
  await waitFor(() => expect(card.querySelector('img, [data-testid="avatar"], svg')).not.toBeNull())
  return card.outerHTML
}

/** The feed's card for the same post (feed rendering: Social's scope, an open target). */
function FeedCard({ post }: { readonly post: Post }) {
  const { personas } = usePersonas()
  const view = useMemo(() => {
    const author = personas.find(persona => persona.id === post.authorPersonaId)
    return author === undefined ? undefined : toPostView(toParticipantView(post), author)
  }, [personas, post])
  if (view === undefined) return null
  return (
    <SocialBrandScope>
      <PostCard post={view} onOpen={() => {}} />
    </SocialBrandScope>
  )
}

describe('the same post in every outlet\'s article body', () => {
  it('renders identical post-card markup in all four skins, equal to the feed card', async () => {
    stubThreadRead({ 'p-embed': POST })

    const embedded: string[] = []
    for (const [key, tokens] of OUTLET_SKINS) {
      const { unmount } = renderInSkin(
        <ArticleBody item={{ bodyHtml: BODY, media: [] }} />,
        tokens,
        key,
      )
      embedded.push(await cardMarkup())
      unmount()
    }
    expect(embedded).toHaveLength(4)
    const [first, ...rest] = embedded
    for (const markup of rest) expect(markup).toBe(first)
    // Non-vacuous: the card really rendered the post.
    expect(first).toContain('data-post-id="p-embed"')
    expect(first).toContain('Do NOT drink tap water')

    const feed = render(<Providers><FeedCard post={POST} /></Providers>)
    const feedCard = await screen.findByTestId('post-card')
    await waitFor(() => expect(feedCard.querySelector('[data-testid="post-actions"]')).not.toBeNull())
    // The read-only embed is the feed card minus the engagement row (the row and its live
    // region, both PostActions' output).
    const clone = feedCard.cloneNode(true) as HTMLElement
    for (const part of clone.querySelectorAll('[data-testid="post-actions"], [data-testid="post-actions-notice"]')) {
      part.remove()
    }
    expect(clone.outerHTML).toBe(first)
    feed.unmount()
  })
})
