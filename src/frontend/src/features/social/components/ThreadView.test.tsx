/**
 * features/social/components/ThreadView.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-01 ACs (SOC-010, D1-006, SOC-005/D1-009, COR-053, XC-004):
 *  - a thread renders FLATTENED - ancestors (oldest first) -> the focused
 *    post (enlarged) -> replies, as one flat sibling list, never nested/
 *    indented, even with a 2-deep ancestor chain (D1-006);
 *  - every reply is labelled "Replying to @handle";
 *  - a taken-down reply renders the interim in-thread tombstone
 *    ("This post is unavailable.") instead of its content;
 *  - every post's relative time renders from the injected exercise clock,
 *    never wall-clock;
 *  - mounting emits exactly one XC-004 'view' telemetry event, carrying the
 *    bound session's participantId and a thread target.
 *
 * Renders through the REAL `ExerciseContextProvider` + `SessionProvider`
 * (mirrors `PostCard.test.tsx`'s pattern) with a fixed exercise clock for
 * deterministic scenario-relative rendering.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { api } from '@/core/services/api'
import { personaIdForHandle } from '@/features/personas'
import { ThreadView } from './ThreadView'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

async function renderThread(focusedPostId: string) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ThreadView focusedPostId={focusedPostId} />
      </SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('thread-view')).toBeInTheDocument())
  await waitFor(() => expect(screen.queryByText('Loading thread…')).not.toBeInTheDocument())
  return utils
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('ThreadView — flattened layout (SOC-010, D1-006)', () => {
  it('renders ancestors -> focused (enlarged) -> replies as one flat list, never nested', async () => {
    await renderThread('post-seed-mvega-question')

    const thread = screen.getByTestId('thread-view')
    const cards = within(thread).getAllByTestId('post-card')
    // 2 ancestors + 1 focused + 1 visible reply; the taken-down reply renders
    // a tombstone instead of a <PostCard>.
    expect(cards.map(c => c.getAttribute('data-post-id'))).toEqual([
      'post-seed-fwupd-rumor',
      'post-seed-fulco-coordination',
      'post-seed-mvega-question',
      'post-reply-kward-1',
    ])

    const focusedWrap = screen.getByTestId('thread-focused')
    expect(within(focusedWrap).getByTestId('post-card')).toHaveAttribute(
      'data-post-id',
      'post-seed-mvega-question',
    )
  })

  it('lays out every reply as a direct sibling of the thread root, never indented inside another post', async () => {
    await renderThread('post-seed-mvega-question')

    const thread = screen.getByTestId('thread-view')
    const replyGroups = within(thread).getAllByTestId('thread-reply')
    expect(replyGroups).toHaveLength(2)
    for (const group of replyGroups) {
      expect(group.parentElement).toBe(thread)
    }
  })

  it('labels every reply "Replying to @handle"', async () => {
    await renderThread('post-seed-mvega-question')

    const labels = screen.getAllByText(/^Replying to @/)
    expect(labels).toHaveLength(2)
    for (const label of labels) {
      expect(label).toHaveTextContent('Replying to @mvega_fh')
    }
  })
})

describe('ThreadView — in-thread tombstone (SOC-005, D1-009)', () => {
  it('renders "This post is unavailable." for a taken-down reply, never its content', async () => {
    await renderThread('post-seed-mvega-question')

    const tombstone = screen.getByTestId('thread-tombstone')
    expect(tombstone).toHaveTextContent('This post is unavailable.')
    expect(screen.queryByText(/screenshot this before it disappears/i)).not.toBeInTheDocument()
  })
})

describe('ThreadView — scenario time only (COR-053)', () => {
  it('renders every post\'s relative time from the injected exercise clock, never wall-clock', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T14:15:00.000Z')))

    await renderThread('post-seed-mvega-question')

    // post-reply-kward-1's scenarioTime is 14:10, 5 minutes before the fixed
    // scenario "now" above - a wall-clock leak would never produce this string.
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })
})

describe('ThreadView — thread-open telemetry (XC-004)', () => {
  it('emits exactly one "view" event on mount, carrying the session participantId and thread target', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T14:15:00.000Z')))

    await renderThread('post-seed-mvega-question')

    const events = getEmittedTelemetryEvents()
    expect(events).toHaveLength(1)
    const event = events[0]
    if (!event) throw new Error('expected exactly one emitted telemetry event')
    expect(event.eventType).toBe('view')
    expect(event.channel).toBe('social')
    expect(event.actor.kind).toBe('participant')
    expect(event.actor.participantId).toBe('acct-dreyes')
    expect(event.target).toEqual({ entityType: 'thread', entityId: 'post-seed-mvega-question' })
    expect(event.exerciseId).toBe('ex-mock-0001')
    expect(event.timeZone).toBe('America/New_York')
    expect(event.scenarioTime).toBe('2033-09-04T14:15:00.000Z')
    expect(Number.isNaN(Date.parse(event.wallClockTime))).toBe(false)
  })
})

describe('ThreadView — no provenance/origin leak into the rendered DOM (XC-002)', () => {
  it('never renders origin/actingHumanId/injectId values from the underlying posts, even though the mock data carries them', async () => {
    const { container } = await renderThread('post-seed-mvega-question')

    // actingHumanId behind the ancestors, the focused post, and the visible
    // reply (the taken-down reply's actingHumanId, 'human-simcell-rumor', is
    // covered too — its content never renders at all, tombstone or not).
    expect(container.textContent).not.toMatch(/human-participant-kward/)
    expect(container.textContent).not.toMatch(/human-participant-mvega/)
    expect(container.textContent).not.toMatch(/human-simcell-rumor/)
    expect(container.textContent).not.toMatch(/system-engine/)
    // PostOrigin enum values (never a participant-visible string).
    expect(container.textContent).not.toMatch(/controller-as-persona/)
    expect(container.textContent).not.toMatch(/\binject\b/i)
    expect(container.textContent).not.toMatch(/\bengine\b/i)
    // injectId of the ancestor rumor post ('042').
    expect(container.textContent).not.toMatch(/\b042\b/)
  })
})

describe('ThreadView — content sanitization (NFR-004)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the focused post's malicious text as inert text, never parsed HTML", async () => {
    const maliciousText = '<img src=x onerror=alert(1)>'
    const realGet = api.get.bind(api)
    // Only the thread lookup is faked here — `ExerciseContextProvider` (a
    // sibling in the same render tree) resolves through this same shared
    // `api.get`, so anything else must fall through to the real mock adapter
    // rather than being swallowed by a blanket mock.
    vi.spyOn(api, 'get').mockImplementation((url: string, config?: Parameters<typeof api.get>[1]) => {
      if (url.startsWith('/threads/')) {
        return Promise.resolve({
          data: {
            ancestors: [],
            focused: {
              id: 'post-xss-focused',
              exerciseId: 'ex-mock-0001',
              authorPersonaId: personaIdForHandle('mvega_fh'),
              actingHumanId: 'human-participant-mvega',
              text: maliciousText,
              counts: { reply: 0, repost: 0, like: 0 },
              createdWallClock: '2026-07-01T00:00:00.000Z',
              scenarioTime: '2033-09-04T14:05:00Z',
              origin: 'participant',
            },
            replies: [],
          },
        } as Awaited<ReturnType<typeof api.get>>)
      }
      return realGet(url, config)
    })

    const { container } = await renderThread('post-xss-focused')

    // A `dangerouslySetInnerHTML` render would parse this into a real (if
    // inert-in-jsdom) <img> element; a plain-text React child never does.
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText(maliciousText)).toBeInTheDocument()
  })
})

describe('ThreadView — accessible thread landmark (NFR-001)', () => {
  it('exposes the thread as a labelled region', async () => {
    await renderThread('post-seed-mvega-question')

    expect(screen.getByRole('region', { name: 'Thread' })).toBeInTheDocument()
  })
})
