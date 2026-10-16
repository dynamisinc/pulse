/**
 * features/controller/liveWorld/LiveWorldRow.edited.test.tsx
 * ---------------------------------------------------------------------------
 * The staff half of edit-own-post (story 20; DF-31): a Live world row shows an "Edited" chip
 * (COBRA link-button, pen icon AND the word) when its post was edited, opens the history in the
 * COBRA-skinned dialog (newest first, "Current" / "Original", scenario times), and a `PostEdited`
 * frame updates a mounted row (text and chip) without a reload. A never-edited row has no chip.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { personaById } from '@/features/personas'
import { cobraTheme } from '@/theme/cobraTheme'
import { editedPostsStore } from '@/features/social/edit/editedPostsStore'
import { editPost } from '@/features/social/edit/editPostService'
import { noteMockPostCreated, resetMockEditsForTests } from '@/features/social/edit/mockEdits'
import { LiveWorldRow } from './LiveWorldRow'
import type { LiveWorldEntry } from './liveWorldModel'
import { MVEGA, view } from './liveWorldTestKit'

function entryFor(overrides: Parameters<typeof view>[1] = {}): LiveWorldEntry {
  const postView = view('post-lw-1', { authorPersonaId: MVEGA, text: 'Original text', ...overrides })
  return { view: postView, ts: 1, seq: 1, tags: [], live: false, pinnedForAll: false }
}

function renderRow(entry: LiveWorldEntry) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={cobraTheme}>
        <LiveWorldRow
          entry={entry}
          persona={personaById(MVEGA)}
          timeZone="America/New_York"
          active
          onReply={vi.fn()}
          unread={false}
          onPinnedChange={vi.fn()}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetMockEditsForTests()
  editedPostsStore.resetForTests()
})

afterEach(() => {
  resetMockEditsForTests()
  editedPostsStore.resetForTests()
})

describe('LiveWorldRow - Edited chip (story 20)', () => {
  it('has no chip on a never-edited post', () => {
    renderRow(entryFor())

    expect(screen.queryByTestId('live-world-edited')).toBeNull()
  })

  it('shows the chip (icon and word) when the view carries an edit summary', () => {
    renderRow(entryFor({ edited: { count: 1, scenarioTime: '2033-09-04T10:05:00.000Z' } }))

    const chip = screen.getByTestId('live-world-edited')
    expect(chip).toHaveTextContent('Edited')
    expect(chip.querySelector('svg[data-icon="pen"]')).not.toBeNull()
    expect(screen.getByTestId('live-world-row')).toHaveAccessibleName(/Edited/)
  })

  it('opens the COBRA history dialog, newest first, with Current and Original', async () => {
    const user = userEvent.setup()
    noteMockPostCreated('post-lw-1', 'Original text', '2033-09-04T10:00:00.000Z')
    await editPost('post-lw-1', 'Edited text')
    renderRow(entryFor({ edited: { count: 1, scenarioTime: '2033-09-04T10:05:00.000Z' } }))

    await user.click(screen.getByTestId('live-world-edited'))

    const dialog = await screen.findByRole('dialog', { name: 'Edit history' })
    const rows = await within(dialog).findAllByTestId('live-world-edit-version')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Current')
    expect(rows[0]).toHaveTextContent('Edited text')
    expect(rows[1]).toHaveTextContent('Original')
    expect(rows[1]).toHaveTextContent('Original text')
    // The staff dialog is not the participant one (no brand-skinned backdrop / test ids).
    expect(screen.queryByTestId('edit-history-dialog')).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('updates a mounted row from a PostEdited frame', () => {
    renderRow(entryFor())

    act(() => {
      editedPostsStore.apply({
        postId: 'post-lw-1',
        text: 'Changed by the author',
        edited: { count: 1, scenarioTime: '2033-09-04T10:09:00.000Z' },
        version: 1,
      })
    })

    expect(screen.getByTestId('live-world-text')).toHaveTextContent('Changed by the author')
    expect(screen.getByTestId('live-world-edited')).toBeInTheDocument()
  })
})
