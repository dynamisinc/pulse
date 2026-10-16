/**
 * features/social/components/ThreadView.pinnedMarker.test.tsx
 * ---------------------------------------------------------------------------
 * Story 21 (DF-34) through a REAL surface: a thread whose read marks posts pinned for
 * everyone shows the "Pinned" marker on exactly those cards, above their author rows (the
 * focused root and a reply), and none on the rest. `useThread` is replaced by a fixed read
 * so the fixture can carry `pinnedForAll`; everything else (the directory, `toPostView`,
 * `<PostCard>`) is real. Own file: `vi.mock` is module-wide.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaIdForHandle } from '@/features/personas'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { ParticipantPostView } from '@/features/social'
import type { ThreadReplyView, UseThreadResult } from '../hooks/useThread'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { ThreadView } from './ThreadView'

const ROOT = 'post-pin-thread-root'

const fixture = vi.hoisted(() => ({ result: null as unknown }))

vi.mock('../hooks/useThread', () => ({
  useThread: () => fixture.result,
}))

function post(id: string, handle: string, extra: Partial<ParticipantPostView> = {}) {
  return {
    id,
    authorPersonaId: personaIdForHandle(handle),
    text: `text of ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T14:00:00Z',
    ...extra,
  } satisfies ParticipantPostView
}

function reply(id: string, extra: Partial<ParticipantPostView> = {}): ThreadReplyView {
  return {
    ...post(id, 'dreyes_fh', extra),
    inReplyTo: { postId: ROOT, authorHandle: 'FulcoEM' },
    replyToPersonaId: personaIdForHandle('FulcoEM'),
    status: 'visible',
  }
}

const result: UseThreadResult = {
  ancestors: [],
  focused: post(ROOT, 'FulcoEM', { pinnedForAll: true, counts: { reply: 2, repost: 0, like: 0 } }),
  replies: [reply('post-pin-thread-r1', { pinnedForAll: true }), reply('post-pin-thread-r2')],
  loading: false,
  error: null,
  newReplyCount: 0,
  appendReply: () => {},
}
fixture.result = result

function cardOf(postId: string): HTMLElement {
  const card = screen
    .getAllByTestId('post-card')
    .find(element => element.getAttribute('data-post-id') === postId)
  if (card === undefined) throw new Error(`no card for ${postId}`)
  return card
}

describe('ThreadView — "Pinned" marker on pinned-for-everyone cards (story 21)', () => {
  it('marks the pinned root and the pinned reply above their author rows, and nothing else', async () => {
    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <SocialDirectoryProvider>
              <ThreadView focusedPostId={ROOT} />
            </SocialDirectoryProvider>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(3))

    for (const id of [ROOT, 'post-pin-thread-r1']) {
      const card = cardOf(id)
      const marker = within(card).getByTestId('pinned-for-all-label')
      expect(marker).toHaveTextContent(/^Pinned$/)
      const header = card.querySelector('header')
      if (header === null) throw new Error('card has no header')
      expect(marker.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy()
    }
    expect(within(cardOf('post-pin-thread-r2')).queryByTestId('pinned-for-all-label')).toBeNull()
  })
})
