/**
 * features/social/notifications/NotificationsFlow.test.tsx
 * ---------------------------------------------------------------------------
 * Notifications end to end inside the REAL Social channel (demo-polish F7, story 16): the
 * same provider stack `App.tsx` builds (`renderChannel`), mock data, the real engine, the real
 * rail and the real page. Proves the pieces are wired together, not just that each works:
 *
 *   - Derived items: a reply and a mention in the exercise feed become rows and a badge;
 *     nothing is made up (an honest empty state); the engine reads the feed WITH replies.
 *   - Bell and badge: text count + "Notifications, N unread" name; `99+` cap; ABSENT for a
 *     read-only / preview mount (and, in `NotificationsFlow.noPersona.test.tsx`, a
 *     persona-less session).
 *   - Page: newest first, in SCENARIO time, a typed icon AND a text label per row, activation
 *     opens the thread, "Mark all read" clears the badge and persists under the
 *     exercise- and persona-scoped key.
 *   - Live and calm: a reply arriving through the realtime path raises the badge and is
 *     announced politely; a taken-down post drops out; a burst stays bounded.
 *   - Isolation / sign-out: the key carries the exercise and persona ids; the registered
 *     session reset sweeps it.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { runSessionResets } from '@/core/auth/sessionReset'
import { resetExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { personaIdForHandle } from '@/features/personas'
import { RouterProbe } from '../layout/RouterProbe.testUtils'
import { renderChannel } from '../layout/renderChannel.testUtils'
import { postStore } from '../services/postStore'
import { removedPosts } from '../services/removedPosts'
import { resetReplyIntent } from '../services/replyIntent'
import type { Post } from '../types/post'
import { NOTIFICATION_STORAGE_PREFIX, notificationStorageKey } from './notificationStorage'
import { notificationsStore } from './notificationsStore'

const EXERCISE = 'ex-mock-0001'
const ME = personaIdForHandle('dreyes_fh')

interface PostInput {
  readonly id: string
  readonly handle: string
  readonly text: string
  readonly at: string
  readonly replyTo?: { readonly postId: string; readonly authorHandle: string }
  readonly like?: number
}

function fullPost(input: PostInput): Post {
  return {
    id: input.id,
    exerciseId: EXERCISE,
    authorPersonaId: personaIdForHandle(input.handle),
    actingHumanId: 'human-test',
    text: input.text,
    counts: { reply: 0, repost: 0, like: input.like ?? 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: input.at,
    origin: 'controller-as-persona',
    ...(input.replyTo !== undefined ? { inReplyTo: input.replyTo } : {}),
  }
}

/** The channel clock (`renderChannel`) is 2033-09-04T14:30Z, i.e. 10:30 AM in New York. */
const OWN = fullPost({
  id: 'nt-own-a',
  handle: 'dreyes_fh',
  text: 'Standing in line at Elm Street for water.',
  at: '2033-09-04T13:00:00.000Z',
})
const toOwn = { postId: 'nt-own-a', authorHandle: 'dreyes_fh' }
const REPLY_FULCO = fullPost({
  id: 'nt-reply-fulco',
  handle: 'FulcoEM',
  text: 'We are adding a second line at noon.',
  at: '2033-09-04T14:05:00.000Z',
  replyTo: toOwn,
})
const REPLY_MVEGA = fullPost({
  id: 'nt-reply-mvega',
  handle: 'mvega_fh',
  text: 'Thank you for the update!',
  at: '2033-09-04T14:20:00.000Z',
  replyTo: toOwn,
})
const MENTION_KWARD = fullPost({
  id: 'nt-mention-kward',
  handle: 'kwardFH',
  text: '@dreyes_fh did you manage to get water yet?',
  at: '2033-09-04T14:10:00.000Z',
})

function seed(...posts: Post[]) {
  for (const post of posts) postStore.appendPost(post)
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetTelemetryBuffer()
})

afterEach(() => {
  notificationsStore.reset()
  postStore.resetForTests()
  removedPosts.resetForTests()
  resetReplyIntent()
  resetExerciseClock()
  resetTelemetryBuffer()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

const bell = () => screen.findByRole('link', { name: /^Notifications/ })
const rows = () => screen.getAllByTestId('notification-row')

describe('derived items', () => {
  it('turns a reply to my post and a mention of me into rows, and counts them on the bell', async () => {
    seed(OWN, REPLY_FULCO, REPLY_MVEGA, MENTION_KWARD)
    renderChannel({ entries: ['/notifications'] })

    await waitFor(() => expect(rows()).toHaveLength(2))
    const [first, second] = rows()
    // The two replies are ONE aggregated row about my post; it is the newest (14:20).
    expect(first).toHaveAttribute('data-type', 'reply')
    expect(first).toHaveTextContent('Marisol Vega and Fulton County EM replied to your post')
    expect(second).toHaveAttribute('data-type', 'mention')
    expect(second).toHaveTextContent('Keisha Ward mentioned you')
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
  })

  it('shows an honest empty state when there is nothing, and fabricates nothing', async () => {
    renderChannel({ entries: ['/notifications'] })
    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent('Nothing here yet')
    expect(screen.queryAllByTestId('notification-row')).toHaveLength(0)
    expect(screen.queryByTestId('notifications-mark-all-read')).not.toBeInTheDocument()
    // The bell is there (the viewer may have notifications) but carries no count.
    expect(await bell()).toHaveAccessibleName('Notifications')
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
  })

  it('does not list replies to someone else\'s post or posts that do not name me', async () => {
    seed(
      OWN,
      fullPost({
        id: 'nt-other-reply',
        handle: 'FulcoEM',
        text: 'Reply to somebody else',
        at: '2033-09-04T14:00:00.000Z',
        replyTo: { postId: 'post-seed-kward-correction', authorHandle: 'kwardFH' },
      }),
      fullPost({ id: 'nt-chatter', handle: 'mvega_fh', text: 'Water is back on Elm', at: '2033-09-04T14:00:00.000Z' }),
    )
    renderChannel({ entries: ['/notifications'] })
    expect(await screen.findByTestId('notifications-empty')).toBeInTheDocument()
  })

  it('reads the exercise\'s feed WITH replies (and only that feed)', async () => {
    const get = vi.spyOn(api, 'get')
    renderChannel({ entries: ['/notifications'] })
    await screen.findByTestId('notifications-empty')
    const reads = get.mock.calls.filter(([url]) => url === '/feed')
    const withReplies = reads.filter(([, config]) => {
      const params = (config as { params?: { includeReplies?: boolean } } | undefined)?.params
      return params?.includeReplies === true
    })
    expect(withReplies.length).toBeGreaterThanOrEqual(1)
    // No client-side exercise id is ever sent: the session binds the exercise (COR-001).
    expect(JSON.stringify(withReplies)).not.toContain('exerciseId')
  })
})

describe('the page', () => {
  it('lists rows newest first with a typed icon AND a text label each', async () => {
    seed(OWN, REPLY_FULCO, MENTION_KWARD)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(2))
    // Mention 14:10 is newer than the reply 14:05.
    expect(rows().map(row => row.getAttribute('data-type'))).toEqual(['mention', 'reply'])
    for (const row of rows()) {
      // a decorative FontAwesome icon (an svg) ...
      expect(row.querySelector('svg[data-icon]')).not.toBeNull()
      // ... AND the text label that carries the meaning
      const type = row.getAttribute('data-type')
      expect(within(row).getByText(type === 'reply' ? 'Reply' : 'Mention')).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
  })

  it('shows times in SCENARIO time, in the exercise zone (never wall-clock)', async () => {
    seed(OWN, REPLY_FULCO)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    const time = within(rows()[0] as HTMLElement).getByText('25m ago') // 14:05Z vs the 14:30Z clock
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2033-09-04T14:05:00.000Z')
    expect(time.getAttribute('title')).toContain('10:05 AM') // America/New_York
    // No calendar year anywhere on the row: the relative stamp is all that is drawn.
    expect(rows()[0]?.textContent ?? '').not.toMatch(/\b20\d\d\b/)
  })

  it('does not turn the likes a post already has at first load into a "new likes" row', async () => {
    // The first load sets the baseline; a rise is detected by the 30 s re-read
    // (see `notificationsStore.test.ts`, which drives it with fake timers).
    seed(fullPost({
      id: 'nt-liked',
      handle: 'dreyes_fh',
      text: 'Water distribution is open.',
      at: '2033-09-04T13:30:00.000Z',
      like: 12,
    }))
    renderChannel({ entries: ['/notifications'] })
    expect(await screen.findByTestId('notifications-empty')).toBeInTheDocument()
  })

  it('activating a row opens the thread it is about (and Back returns)', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO, MENTION_KWARD)
    renderChannel({ entries: ['/notifications'], beside: <RouterProbe /> })
    await waitFor(() => expect(rows()).toHaveLength(2))

    const replyRow = rows().find(row => row.getAttribute('data-type') === 'reply') as HTMLElement
    const link = within(replyRow).getByRole('link')
    expect(link).toHaveAttribute('href', '/dreyes_fh/status/nt-own-a')
    await user.click(link)
    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
    expect(screen.getByTestId('router-location')).toHaveTextContent('/dreyes_fh/status/nt-own-a')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('notifications-page')).toBeInTheDocument()

    // A mention opens the mentioning post's own thread.
    const mentionRow = rows().find(row => row.getAttribute('data-type') === 'mention') as HTMLElement
    await user.click(within(mentionRow).getByRole('link'))
    expect(screen.getByTestId('router-location')).toHaveTextContent('/kwardFH/status/nt-mention-kward')
  })

  it('moves focus to the page heading on arrival from the rail', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO)
    renderChannel({ entries: ['/home'] })
    await user.click(await screen.findByRole('link', { name: /^Notifications/ }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Notifications' })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('emits one page view (XC-004) and no wall-clock in the event\'s scenario time', async () => {
    renderChannel({ entries: ['/notifications'] })
    await screen.findByTestId('notifications-empty')
    const views = getEmittedTelemetryEvents().filter(
      event => event.eventType === 'view' && event.target?.entityType === 'notifications',
    )
    expect(views).toHaveLength(1)
    expect(views[0]?.scenarioTime).toBe('2033-09-04T14:30:00.000Z')
  })
})

describe('"Mark all read"', () => {
  it('clears the badge, keeps the rows, and persists under the exercise- and persona-scoped key', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO, MENTION_KWARD)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
    expect(rows().every(row => row.getAttribute('data-unread') === 'true')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Mark all read' }))

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument())
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    expect(rows().every(row => row.getAttribute('data-unread') === 'false')).toBe(true)
    expect(screen.getByTestId('notifications-live')).toHaveTextContent('All notifications marked as read')

    const stored = window.sessionStorage.getItem(notificationStorageKey(EXERCISE, ME))
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored ?? '{}').readIds.sort()).toEqual(['nt-mention-kward', 'nt-reply-fulco'])
    // The key names BOTH ids.
    expect(notificationStorageKey(EXERCISE, ME)).toContain(EXERCISE)
    expect(notificationStorageKey(EXERCISE, ME)).toContain(ME)
  })

  it('stays marked after the channel is remounted (a reload of the same persona)', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO)
    const first = renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument())
    first.unmount()

    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveAttribute('data-unread', 'false')
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
  })

  it('keeps focus on the button once nothing is left to mark (aria-disabled, not removed)', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    const button = screen.getByRole('button', { name: 'Mark all read' })
    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBe(button)
    expect(button).toHaveFocus()
  })
})

describe('live and calm', () => {
  it('a reply arriving in real time raises the badge and is announced politely', async () => {
    seed(OWN)
    renderChannel({ entries: ['/home'] })
    expect(await bell()).toHaveAccessibleName('Notifications')

    act(() => {
      postStore.appendPost(REPLY_FULCO)
    })

    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
    const live = screen.getByTestId('notifications-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveAttribute('role', 'status')
    await waitFor(() => expect(live).toHaveTextContent('1 new reply'))
  })

  it('a taken-down post drops out of the list', async () => {
    seed(OWN, REPLY_FULCO, MENTION_KWARD)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(2))

    act(() => {
      removedPosts.add('nt-mention-kward')
    })

    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveAttribute('data-type', 'reply')
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('stays bounded under a burst: 120 mentions cap the badge at 99+ and the page at 100 rows', async () => {
    const burst = Array.from({ length: 120 }, (_, index) => fullPost({
      id: `nt-burst-${index}`,
      handle: 'mvega_fh',
      text: `@dreyes_fh burst ${index}`,
      at: '2033-09-04T14:00:00.000Z',
    }))
    seed(OWN, ...burst)
    renderChannel({ entries: ['/notifications'] })

    await waitFor(() => expect(rows()).toHaveLength(100))
    // (`getByLabelText` rather than a role query: with 100 rows on the page, computing the
    // accessible name of every link is what makes this test slow under a loaded machine.)
    expect(await screen.findByLabelText('Notifications, 99+ unread')).toBeInTheDocument()
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+')
    expect(screen.getByTestId('notifications-hidden')).toHaveTextContent(
      '20 older notifications are not shown.',
    )
  }, 30_000)

  it('aggregates a burst of replies to one post into one row', async () => {
    const replies = Array.from({ length: 60 }, (_, index) => fullPost({
      id: `nt-r-${index}`,
      handle: index % 2 === 0 ? 'FulcoEM' : 'mvega_fh',
      text: `reply ${index}`,
      at: '2033-09-04T14:00:00.000Z',
      replyTo: toOwn,
    }))
    seed(OWN, ...replies)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveTextContent(/replied to your post/)
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })
})

describe('absent, not inert (D1-011)', () => {
  it.each(['readOnly', 'preview', 'kiosk'] as const)(
    'a %s mount has no bell and /notifications lands on Home',
    async variant => {
      seed(OWN, REPLY_FULCO)
      renderChannel({ entries: ['/notifications'], variant, beside: <RouterProbe /> })
      await waitFor(() => expect(screen.getByTestId('router-location')).toHaveTextContent('/home'))
      expect(screen.queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('notifications-page')).not.toBeInTheDocument()
      // And nothing ran: no storage was touched for a viewer who has no notifications.
      const keys = Object.keys(window.sessionStorage)
      expect(keys.filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))).toEqual([])
      expect(notificationsStore.getSummary().available).toBe(false)
    },
  )
})

describe('sign-out', () => {
  it('the registered session reset sweeps the storage and removes the bell', async () => {
    const user = userEvent.setup()
    seed(OWN, REPLY_FULCO)
    renderChannel({ entries: ['/notifications'] })
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() =>
      expect(window.sessionStorage.getItem(notificationStorageKey(EXERCISE, ME))).not.toBeNull())

    act(() => {
      runSessionResets() // what `endSession` runs on sign-out
    })

    expect(window.sessionStorage.getItem(notificationStorageKey(EXERCISE, ME))).toBeNull()
    expect(notificationsStore.getSnapshot().items).toEqual([])
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /^Notifications/ })).not.toBeInTheDocument())
  })
})
