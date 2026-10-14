/**
 * features/controller/liveWorld/LiveWorldColumn.mockSeams.test.tsx
 * ---------------------------------------------------------------------------
 * The Live world column over the REAL seams the console mounts it on (demo-polish
 * C2): the real `ExerciseContextProvider`, the real `usePersonas()` mock cast, the
 * real `resolveFeed` mock adapter over `postStore` (rich demo fixtures opted in),
 * and the REAL shared, ref-counted `defaultArrivalSource` (the in-tab `postStore`
 * stream under mock data) — no injected fake source, no mocked feed. This is what
 * `npm run dev` shows, and what proves the column composes with F4's ref-counted
 * transport without a second connection:
 *
 *  - the demo fixtures' replies, media and counts render;
 *  - a post appended to the store AFTER mount arrives live, at the top;
 *  - a REPLY appended after mount arrives live, with its "replying to" marker
 *    (the pill stream drops replies; this column must not);
 *  - mounting beside another consumer of the shared source leaves that consumer's
 *    hold intact when the column unmounts (ref-counted, one transport).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { postStore } from '@/features/social/services/postStore'
import { DEMO_IDS } from '@/features/social/services/mockFixtures'
import { defaultArrivalSource } from '@/features/social/services/feedStreamSource'
import { LiveWorldColumn } from './LiveWorldColumn'
import { post, WATER } from './liveWorldTestKit'

/** Later than every demo fixture (they run 10:40-15:05Z on the Fairhaven day). */
const LATE = '2033-09-04T23:30:00.000Z'
const LATER = '2033-09-04T23:45:00.000Z'

beforeEach(() => {
  postStore.resetForTests({ withDemoFixtures: true })
})

afterEach(() => {
  postStore.resetForTests()
})

function renderColumn() {
  const onReplyAs = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <LiveWorldColumn onReplyAs={onReplyAs} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  return { ...utils, onReplyAs }
}

function rowIds(): string[] {
  return screen.queryAllByTestId('live-world-row').map(row => row.dataset.postId ?? '')
}

function rowFor(id: string): HTMLElement {
  const row = screen.getAllByTestId('live-world-row').find(el => el.dataset.postId === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

describe('Live world column over the real mock seams', () => {
  it('lists the demo fixtures INCLUDING replies, with media and counts', async () => {
    renderColumn()
    await screen.findAllByTestId('live-world-row')

    // Replies are in the mirror (the top-level feed would exclude them).
    expect(rowIds()).toContain(DEMO_IDS.threadReplyConfirm)
    expect(within(rowFor(DEMO_IDS.threadReplyConfirm)).getByTestId('live-world-reply-marker'))
      .toHaveTextContent('↳ replying to @')

    // The video post: poster thumbnail + "VIDEO 0:04" label, compact counts.
    const video = within(rowFor(DEMO_IDS.videoPoster))
    expect(video.getByText('VIDEO 0:04')).toBeInTheDocument()
    expect(video.getByTestId('live-world-count-like')).toHaveTextContent('12.3K')

    // Strictly newest-first by scenario time.
    const times = screen.getAllByTestId('live-world-time').map(el => el.getAttribute('datetime') ?? '')
    expect(times).toEqual([...times].sort().reverse())
    expect(screen.getByTestId('live-world-transport')).toHaveTextContent('REALTIME')
  })

  it('receives a post appended after mount, live, at the top', async () => {
    renderColumn()
    await screen.findAllByTestId('live-world-row')

    postStore.appendPost(post('live-1', {
      authorPersonaId: WATER,
      text: 'Fresh from the store',
      scenarioTime: LATE,
    }))

    await waitFor(() => expect(rowIds()[0]).toBe('live-1'))
    expect(within(rowFor('live-1')).getByText('Fresh from the store')).toBeInTheDocument()
  })

  it('receives a REPLY appended after mount, with its marker (replies are not filtered out)', async () => {
    renderColumn()
    await screen.findAllByTestId('live-world-row')

    postStore.appendPost(post('live-reply', {
      authorPersonaId: WATER,
      text: 'Answering you',
      scenarioTime: LATER,
      parentPostId: DEMO_IDS.threadFocus,
    }))

    await waitFor(() => expect(rowIds()).toContain('live-reply'))
    expect(within(rowFor('live-reply')).getByTestId('live-world-reply-marker'))
      .toHaveTextContent('↳ replying to @')
  })

  it('shares the ref-counted transport: unmounting the column does not stop another consumer', async () => {
    const otherHold = vi.fn()
    const unsubscribe = defaultArrivalSource.subscribe(otherHold)
    await defaultArrivalSource.start() // another consumer's hold (e.g. a thread view)

    const { unmount } = renderColumn()
    await screen.findAllByTestId('live-world-row')
    unmount()

    // The other consumer still receives arrivals: the transport was not stopped.
    postStore.appendPost(post('after-unmount', { scenarioTime: LATE }))
    expect(otherHold).toHaveBeenCalledWith(expect.objectContaining({ id: 'after-unmount' }))

    unsubscribe()
    defaultArrivalSource.stop()
  })
})
