/**
 * features/social/edit/EditPost.test.tsx
 * ---------------------------------------------------------------------------
 * The participant half of edit-own-post (story 20; DF-29/DF-31), end to end in MOCK mode (the
 * Vitest default) over a real `<PostCard>`:
 *
 *  - Edit shows only while `viewer.editableForSeconds > 0`, hides at 0 WITHOUT a reload (fake
 *    timers), and is absent on a read-only card; named "Edit post" with a faPen icon;
 *  - the dialog is labelled, prefilled, has the counter + emoji button + read-only media note,
 *    Esc / Cancel dismiss and focus returns to the Edit button;
 *  - Save updates the card at once (optimistic while the PATCH is in flight), keeps it on
 *    success, rolls it back on failure and shows the 409 messages / generic error, dialog open;
 *  - "Edited" appears after a save, opens "Edit history" newest first with Current / Original and
 *    scenario times (no wall clock), and focus returns to it;
 *  - a `PostEdited` frame updates a feed card AND a thread card of the same post, hashtags in the
 *    new text linkify, a stale frame is dropped;
 *  - structural a11y of both dialogs (role, modal, labelled, focus trapped). There is no axe
 *    dependency in this repo, so these are explicit assertions.
 */
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { personaById, personaIdForHandle } from '@/features/personas'
import { PostCard } from '../components/post/PostCard'
import type { PostView } from '../components/post/types'
import { resetMockReactions } from '../services/reactionService'
import { editedPostsStore } from './editedPostsStore'
import { noteMockPostCreated, resetMockEditsForTests, setMockEditConflict } from './mockEdits'

const ORIGINAL = 'Water looks fine to me'

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('mvega_fh'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-edit-1',
    author,
    text: ORIGINAL,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T13:15:00Z',
    viewer: { liked: false, reposted: false, editableForSeconds: 600 },
    ...overrides,
  }
}

function wrap(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>{node}</SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )
}

async function renderCards(...posts: PostView[]) {
  const utils = render(
    wrap(posts.map(post => <PostCard key={post.id + Math.random()} post={post} />)),
  )
  await screen.findAllByTestId('post-actions')
  return utils
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function frame(version: number, text: string, postId = 'post-edit-1') {
  return {
    postId,
    text,
    edited: { count: version, scenarioTime: `2033-09-04T13:3${version}:00Z` },
    version,
  }
}

beforeEach(() => {
  resetMockReactions()
  resetMockEditsForTests()
  editedPostsStore.resetForTests()
  noteMockPostCreated('post-edit-1', ORIGINAL, '2033-09-04T13:15:00Z')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetMockEditsForTests()
  editedPostsStore.resetForTests()
})

describe('Edit action (DF-29)', () => {
  it('shows "Edit post" with a pen icon when seconds are left', async () => {
    await renderCards(buildPost())

    const edit = screen.getByRole('button', { name: 'Edit post' })
    expect(edit).toHaveAttribute('title', 'Edit post')
    expect(edit.querySelector('svg[data-icon="pen"]')).not.toBeNull()
  })

  it.each([
    ['no viewer state', { viewer: undefined }],
    ['no editableForSeconds (someone else\'s post)', { viewer: { liked: false, reposted: false } }],
    ['0 seconds (window closed or limit)', {
      viewer: { liked: false, reposted: false, editableForSeconds: 0 },
    }],
  ])('is absent with %s', async (_name, overrides) => {
    await renderCards(buildPost(overrides))

    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull()
  })

  it('is absent on a read-only card', async () => {
    render(wrap(<PostCard post={buildPost()} variant="readOnly" />))
    await screen.findAllByTestId('post-actions')

    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull()
  })

  it('hides at 0 without a reload, counting down from when the post was read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(wrap(<PostCard
      post={buildPost({
        viewer: { liked: false, reposted: false, editableForSeconds: 30 },
      })}
    />))
    await act(() => Promise.resolve())
    expect(screen.getByRole('button', { name: 'Edit post' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(29_000)
    })
    expect(screen.getByRole('button', { name: 'Edit post' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull()
  })

  it('renders no wall-clock or countdown text', async () => {
    await renderCards(buildPost())

    expect(screen.getByTestId('post-actions').textContent).not.toMatch(/\d+\s*(s|sec|min)\b/i)
  })
})

describe('Edit dialog', () => {
  it('opens labelled, prefilled, with counter, emoji button and the media note', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost({
      media: [{ id: 'm1', kind: 'image', url: '/mock-media/photos/water-plant.svg', alt: 'Plant' }],
    }))

    await user.click(screen.getByRole('button', { name: 'Edit post' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit post' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('textbox', { name: 'Post text' })).toHaveValue(ORIGINAL)
    expect(within(dialog).getByTestId('edit-counter')).toHaveTextContent(
      `${280 - [...ORIGINAL].length} characters remaining`,
    )
    expect(within(dialog).getByTestId('emoji-button')).toBeInTheDocument()
    expect(within(dialog).getByTestId('edit-post-media-note')).toHaveTextContent(
      "Media can't be changed",
    )
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('traps focus inside, closes on Esc and returns focus to the Edit button', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    const edit = screen.getByRole('button', { name: 'Edit post' })

    await user.click(edit)
    const dialog = screen.getByRole('dialog', { name: 'Edit post' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 8; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(edit).toHaveFocus()
    expect(screen.getByText(ORIGINAL)).toBeInTheDocument()
  })

  it('Cancel closes without a change', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    await user.type(screen.getByRole('textbox', { name: 'Post text' }), ' more')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(ORIGINAL)).toBeInTheDocument()
    expect(screen.queryByTestId('post-edited')).toBeNull()
  })

  it('disables Save for empty and over-limit text, with words on the counter', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const box = screen.getByRole('textbox', { name: 'Post text' })

    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(box, { target: { value: 'x'.repeat(285) } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByTestId('edit-counter')).toHaveTextContent('5 characters over the limit')
  })
})

describe('Save (DF-29)', () => {
  it('updates the card at once, keeps it on success, then shows Edited', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const box = screen.getByRole('textbox', { name: 'Post text' })
    await user.clear(box)
    await user.type(box, 'Corrected: boil water #FairhavenWater')

    const held = deferred<unknown>()
    const real = api.patch.bind(api)
    const patch = vi.spyOn(api, 'patch').mockImplementation((...args) => {
      return held.promise.then(() => real(...(args as Parameters<typeof real>)))
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Optimistic: the card behind the dialog already shows the new text.
    expect(patch).toHaveBeenCalledWith(
      '/posts/post-edit-1',
      { text: 'Corrected: boil water #FairhavenWater' },
      expect.anything(),
    )
    expect(screen.getByText(/Corrected: boil water/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      held.resolve(undefined)
      await held.promise
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(/Corrected: boil water/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByTestId('post-edited')).toHaveTextContent('Edited')
  })

  it('rolls the card back and keeps the dialog open with a message on a generic failure', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const box = screen.getByRole('textbox', { name: 'Post text' })
    await user.clear(box)
    await user.type(box, 'Will fail')
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('network'))

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByTestId('edit-post-error')).toHaveTextContent(
      "Couldn't save your edit. Try again",
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(ORIGINAL, { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('Will fail', { selector: 'p' })).toBeNull()
    expect(screen.queryByTestId('post-edited')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it.each([
    ['window-closed', 'The 15-minute edit window has closed'],
    ['edit-limit', "You've reached the edit limit"],
    ['frozen', 'Posting is paused right now'],
  ] as const)('maps the 409 "%s" to a plain message and rolls back', async (reason, message) => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const box = screen.getByRole('textbox', { name: 'Post text' })
    await user.clear(box)
    await user.type(box, 'Refused')
    setMockEditConflict(reason)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByTestId('edit-post-error')).toHaveTextContent(message)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(ORIGINAL, { selector: 'p' })).toBeInTheDocument()
  })

  it('hides Edit on the card after a window-closed refusal', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    await user.click(screen.getByRole('button', { name: 'Edit post' }))
    const box = screen.getByRole('textbox', { name: 'Post text' })
    await user.type(box, '!')
    setMockEditConflict('window-closed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('edit-post-error')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull()
  })
})

describe('Edited label and history (DF-31)', () => {
  it('opens "Edit history" newest first with Current / Original and scenario times', async () => {
    const user = userEvent.setup()
    await renderCards(buildPost())
    for (const text of ['Second version', 'Third version']) {
      await user.click(screen.getByRole('button', { name: 'Edit post' }))
      const box = screen.getByRole('textbox', { name: 'Post text' })
      await user.clear(box)
      await user.type(box, text)
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }

    const edited = screen.getByTestId('post-edited')
    expect(edited).toHaveAccessibleName('Edited, view edit history')
    await user.click(edited)

    const dialog = await screen.findByRole('dialog', { name: 'Edit history' })
    const rows = await within(dialog).findAllByTestId('edit-history-version')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Current')
    expect(rows[0]).toHaveTextContent('Third version')
    expect(rows[1]).toHaveTextContent('Second version')
    expect(rows[1]).not.toHaveTextContent(/Current|Original/)
    expect(rows[2]).toHaveTextContent('Original')
    expect(rows[2]).toHaveTextContent(ORIGINAL)
    for (const row of rows) {
      const time = row.querySelector('time')
      expect(time?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(time?.textContent ?? '').not.toBe('')
    }
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(edited).toHaveFocus()
  })
})

describe('Live PostEdited (DF-33)', () => {
  it('updates a feed card and a thread card of the same post without a reload', async () => {
    await renderCards(buildPost({ viewer: undefined }), buildPost({ viewer: undefined }))
    expect(screen.getAllByText(ORIGINAL, { selector: 'p' })).toHaveLength(2)
    expect(screen.queryByTestId('post-edited')).toBeNull()

    act(() => {
      editedPostsStore.apply(frame(1, 'New text with #boilwater'))
    })

    const bodies = screen.getAllByText(/New text with/, { selector: 'p' })
    expect(bodies).toHaveLength(2)
    expect(screen.getAllByTestId('post-edited')).toHaveLength(2)
    for (const body of bodies) {
      expect(body.querySelector('[data-hashtag="boilwater"]')).not.toBeNull()
    }
  })

  it('shows "Edited" from the card\'s own data and drops a stale frame', async () => {
    await renderCards(buildPost({
      viewer: undefined,
      edited: { count: 2, scenarioTime: '2033-09-04T13:30:00Z' },
    }))
    expect(screen.getByTestId('post-edited')).toBeInTheDocument()

    act(() => {
      editedPostsStore.apply(frame(3, 'Third'))
    })
    expect(screen.getByText('Third', { selector: 'p' })).toBeInTheDocument()

    act(() => {
      editedPostsStore.apply(frame(2, 'Stale second'))
      editedPostsStore.apply(frame(3, 'Replayed third'))
    })
    expect(screen.getByText('Third', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('Stale second')).toBeNull()
  })

  it('forgets edits on sign-out (reset)', async () => {
    await renderCards(buildPost({ viewer: undefined }))
    act(() => {
      editedPostsStore.apply(frame(1, 'Edited live'))
    })
    expect(screen.getByText('Edited live', { selector: 'p' })).toBeInTheDocument()

    act(() => {
      editedPostsStore.reset()
    })

    expect(screen.getByText(ORIGINAL, { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByTestId('post-edited')).toBeNull()
  })
})
