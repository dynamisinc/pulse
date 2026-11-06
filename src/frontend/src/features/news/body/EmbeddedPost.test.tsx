/**
 * news-network 06, "Embedded Pulse post" and "Isolation" (NWS-015, SOC-002/004, XC-001/002,
 * XC-010): Social's read-only card inside the brand reset and Social's own accent scope;
 * a link to the thread, keyboard-operable; a skeleton while loading; the in-fiction
 * "post unavailable" line for an unknown, deleted or foreign post, with the SAME markup
 * whichever it was, read through the exercise-scoped endpoint (no exercise id in the URL).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKIN_CSS_VARS } from '@/features/channels'
import { api } from '@/core/services/api'
import { EmbeddedPost, POST_UNAVAILABLE_TEXT } from './EmbeddedPost'
import { EXERCISE, OUTLET_SKINS, Providers, buildPost, renderInSkin, stubThreadRead } from './bodyTestUtils'

afterEach(() => {
  vi.restoreAllMocks()
})

const [, SCOOP] = OUTLET_SKINS[3] ?? []

async function settled() {
  await waitFor(() => expect(screen.queryByTestId('news-embedded-post-loading')).toBeNull())
}

describe('EmbeddedPost', () => {
  it('renders Social\'s read-only card: no engagement row, the post text, the author', async () => {
    stubThreadRead({ 'p-1': buildPost('p-1') })
    render(<Providers><EmbeddedPost postId="p-1" /></Providers>)
    const card = await screen.findByTestId('post-card')
    expect(card).toHaveAttribute('data-post-id', 'p-1')
    expect(within(card).getByText(/Boil-water notice/)).toBeInTheDocument()
    expect(within(card).queryByTestId('post-actions')).toBeNull()
    expect(within(card).queryByRole('button', { name: /reply|repost|like/i })).toBeNull()
  })

  it('sits inside the skin reset boundary, then Social\'s own accent scope', async () => {
    stubThreadRead({ 'p-1': buildPost('p-1') })
    if (SCOOP === undefined) throw new Error('fixture')
    renderInSkin(<EmbeddedPost postId="p-1" />, SCOOP, 'the-scoop')
    const card = await screen.findByTestId('post-card')
    const reset = card.closest('[data-skin-reset]') as HTMLElement | null
    expect(reset).not.toBeNull()
    // Every outlet variable is unset at the boundary; the outlet accent cannot reach the card.
    expect(reset?.style.getPropertyValue(SKIN_CSS_VARS.accent)).toBe('initial')
    expect(reset?.style.getPropertyValue(SKIN_CSS_VARS.fontBody)).toBe('initial')
    const social = card.closest('[data-testid="social-brand-scope"]') as HTMLElement | null
    expect(social).not.toBeNull()
    expect(reset?.contains(social)).toBe(true)
    expect(social?.style.getPropertyValue('--pulse-ac')).not.toBe('')
  })

  it('is a keyboard-operable link to the post thread, reporting the open', async () => {
    stubThreadRead({ 'p-1': buildPost('p-1') })
    const onOpen = vi.fn()
    render(<Providers><EmbeddedPost postId="p-1" onOpen={onOpen} /></Providers>)
    const open = await screen.findByTestId('post-open-target')
    open.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('p-1')
    expect(screen.getByTestId('location').textContent).toMatch(/\/status\/p-1$/)
  })

  it('shows a skeleton while the post loads', async () => {
    let release: (() => void) | undefined
    const original = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(((url: string, config?: unknown) => {
      if (!url.startsWith('/threads/')) return original(url, config as never)
      return new Promise(resolve => {
        release = () => resolve({ data: { ancestors: [], focused: buildPost('p-1'), replies: [] } } as never)
      })
    }) as typeof api.get)
    render(<Providers><EmbeddedPost postId="p-1" /></Providers>)
    const skeleton = await screen.findByTestId('news-embedded-post-loading')
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('post-card')).toBeNull()
    await waitFor(() => expect(release).toBeDefined())
    release?.()
    expect(await screen.findByTestId('post-card')).toBeInTheDocument()
  })

  it('an unknown post shows the in-fiction tombstone line (icon + words)', async () => {
    stubThreadRead({})
    render(<Providers><EmbeddedPost postId="nope" /></Providers>)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(POST_UNAVAILABLE_TEXT)
    expect(note.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByTestId('post-card')).toBeNull()
  })

  it('a deleted (soft-deleted) post is the same tombstone', async () => {
    stubThreadRead({ gone: { ...buildPost('gone'), status: 'deleted' } as never })
    render(<Providers><EmbeddedPost postId="gone" /></Providers>)
    expect(await screen.findByRole('note')).toHaveTextContent(POST_UNAVAILABLE_TEXT)
  })
})

describe('EmbeddedPost isolation (XC-001/002)', () => {
  /** The embed's markup once settled, for byte comparison. */
  async function tombstoneMarkup(postId: string): Promise<string> {
    const { container, unmount } = render(<Providers><EmbeddedPost postId={postId} /></Providers>)
    await screen.findByRole('note')
    await settled()
    const html = container.querySelector('[data-testid="news-embedded-post"]')?.innerHTML ?? ''
    unmount()
    return html
  }

  it('reads through the exercise-scoped participant endpoint, with no exercise id in the URL', async () => {
    const spy = stubThreadRead({ 'p-1': buildPost('p-1') })
    render(<Providers><EmbeddedPost postId="p-1" /></Providers>)
    await screen.findByTestId('post-card')
    const threadCalls = spy.mock.calls.map(([url]) => url).filter(url => url.startsWith('/threads/'))
    expect(threadCalls).toEqual(['/threads/p-1'])
    for (const url of threadCalls) expect(url).not.toContain(EXERCISE)
  })

  it('a foreign post, an unknown id and a 404 render the identical tombstone (no existence leak)', async () => {
    stubThreadRead({ foreign: buildPost('foreign', { exerciseId: 'ex-other-9999' }) })
    const foreign = await tombstoneMarkup('foreign')
    const unknown = await tombstoneMarkup('unknown-id')
    vi.restoreAllMocks()
    const original = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(((url: string, config?: unknown) => (
      url.startsWith('/threads/')
        ? Promise.reject(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))
        : original(url, config as never)
    )) as typeof api.get)
    const notFound = await tombstoneMarkup('foreign')
    expect(foreign).toContain(POST_UNAVAILABLE_TEXT)
    expect(unknown).toBe(foreign)
    expect(notFound).toBe(foreign)
    // Nothing of the foreign post (text, author, id) reaches the DOM.
    expect(foreign).not.toMatch(/Boil-water|FairhavenWater|data-post-id/)
  })
})
