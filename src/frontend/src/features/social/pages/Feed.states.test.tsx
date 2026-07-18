/**
 * features/social/pages/Feed.states.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 01's calm in-fiction loading / empty / error states (AC8) in
 * isolation, by mocking `useFeed` so each branch is deterministic (the real
 * mock adapter always resolves the full seed, so these branches are otherwise
 * untriggerable). The states must carry NO exercise/admin language.
 *
 * The provider stack is still real — `<Feed>` reads exercise context, session,
 * and shell variant, and emits its mount telemetry — only the data hook is
 * swapped.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { UseFeedResult } from '../hooks/useFeed'
import { Feed } from './Feed'

const useFeedMock = vi.hoisted(() => vi.fn<() => UseFeedResult>())

vi.mock('../hooks/useFeed', () => ({ useFeed: useFeedMock }))

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

afterEach(() => {
  resetTelemetryBuffer()
  useFeedMock.mockReset()
})

/** Words that would break fiction if they leaked into a participant state message. */
const OUT_OF_FICTION = /exercise|admin|scenario|controller|inject|mock|COR-/i

describe('Feed — loading state (AC8)', () => {
  it('shows a calm loading message while the feed resolves, with no out-of-fiction language', async () => {
    useFeedMock.mockReturnValue({ posts: [], loading: true, error: undefined })
    renderFeed()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/loading/i)
    expect(status.textContent ?? '').not.toMatch(OUT_OF_FICTION)
  })
})

describe('Feed — empty state (AC8)', () => {
  it('shows a calm empty message when there are no posts and no error', async () => {
    useFeedMock.mockReturnValue({ posts: [], loading: false, error: undefined })
    renderFeed()

    const empty = await screen.findByText(/no posts yet/i)
    expect(empty).toBeInTheDocument()
    expect(empty.textContent ?? '').not.toMatch(OUT_OF_FICTION)
  })
})

describe('Feed — error state (AC8)', () => {
  it('shows a calm unavailable message on error, never a raw/technical error', async () => {
    useFeedMock.mockReturnValue({ posts: [], loading: false, error: new Error('boom /feed 500') })
    renderFeed()

    const status = await screen.findByRole('status')
    expect(status.textContent ?? '').not.toMatch(/boom|500|Error/)
    expect(status.textContent ?? '').not.toMatch(OUT_OF_FICTION)
  })
})
