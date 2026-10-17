/**
 * features/controller/liveWorld/LiveWorldColumn.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the live world on a tablet. J / K are scrolling / tapping a row; R is the
 * row's "Reply as…" button; N is the "N new" pill. Each is >= 44x44 inside `@media (pointer:
 * coarse)` as real layout space (no ::before / ::after hit-slop), and the row's actions are >= 8px
 * apart. Nothing is hover-only: "Reply as…" is a visible labelled button on every row.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveFeed } from '@/features/social/services/feedService'
import { LiveWorldColumn } from './LiveWorldColumn'
import { at, createFakeSource, MVEGA, post, view, WATER, type FakeSource } from './liveWorldTestKit'
import { hasPseudoHitSlop, mediaRuleDeclarations } from '@/features/staffShell/tabletTestUtils'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    useExerciseContext: () => ({
      exerciseId: 'ex-1',
      exerciseName: 'Exercise One',
      timeZone: 'America/New_York',
    }),
  }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
let source: FakeSource

beforeEach(() => {
  source = createFakeSource()
  window.localStorage.clear()
  mockedResolveFeed.mockReset()
})
afterEach(() => vi.useRealTimers())

function expect44(el: HTMLElement) {
  const coarse = mediaRuleDeclarations(el, 'pointer: coarse')
  expect(coarse['min-width']).toBe('44px')
  expect(coarse['min-height']).toBe('44px')
  expect(hasPseudoHitSlop(el)).toBe(false)
}

describe('Live world — touch parity (story 14)', () => {
  it('"Reply as…" (the R key) is a visible labelled 44px button on every row; row actions are 8px apart', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p1', { authorPersonaId: MVEGA, scenarioTime: at(40) }),
      post('p2', { authorPersonaId: WATER, scenarioTime: at(30) }),
    ])
    render(
      <ThemeProvider theme={cobraTheme}>
        <LiveWorldColumn onReplyAs={vi.fn()} source={source} />
      </ThemeProvider>,
    )
    const replies = await screen.findAllByTestId('live-world-reply-as')
    expect(replies).toHaveLength(2)
    for (const reply of replies) {
      expect(reply).toHaveTextContent('Reply as…')
      expect44(reply)
    }
    const [firstReply] = replies
    if (firstReply === undefined) throw new Error('no Reply as button')
    const actionRow = firstReply.parentElement as HTMLElement
    expect(mediaRuleDeclarations(actionRow, 'pointer: coarse').gap).toBe('8px')
  })

  it('the "N new" pill (the N key) and Mark all read are 44px', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p1', { authorPersonaId: MVEGA, scenarioTime: at(40) }),
      post('p2', { authorPersonaId: WATER, scenarioTime: at(30) }),
    ])
    render(
      <ThemeProvider theme={cobraTheme}>
        <LiveWorldColumn onReplyAs={vi.fn()} source={source} />
      </ThemeProvider>,
    )
    await screen.findAllByTestId('live-world-row')
    const list = screen.getByTestId('live-world-list')
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 90 })
    fireEvent.scroll(list)
    act(() => source.emit(view('u1', { authorPersonaId: MVEGA, scenarioTime: at(55) })))

    const pill = await screen.findByTestId('live-world-new')
    expect(pill).toHaveTextContent('1 new')
    expect44(pill)
    expect44(screen.getByTestId('live-world-mark-all-read'))
  })
})
