/**
 * features/social/notifications/NotificationsFlow.session.test.tsx
 * ---------------------------------------------------------------------------
 * The SESSION axes of "absent, not inert" (demo-polish F7, story 16 "Bell and badge";
 * D1-011 / COR-015). `NotificationsFlow.test.tsx` covers the shell-variant axis (a read-only,
 * preview or kiosk MOUNT); this file covers the two session-level ones with a `full` mount:
 *
 *   - a PERSONA-LESS session (a shared terminal bound to no persona): no "my posts", so
 *     nothing to derive a notification from;
 *   - a READ-ONLY session (a shared view-only credential) bound to a persona.
 *
 * Neither gets a bell, a badge or a page (a visit to `/notifications` lands on Home), the
 * engine never runs, and nothing is written to storage. A control case proves the same render
 * stack DOES give a bell to an ordinary persona-bound session, so the absences are not
 * vacuous.
 *
 * Its own file because `vi.mock('@/core/auth', ...)` is hoisted to the whole module (the same
 * split rationale as `SocialChannel.feedSwitch.noPersona.test.tsx`).
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { personaIdForHandle } from '@/features/personas'
import { RouterProbe } from '../layout/RouterProbe.testUtils'
import { renderChannel } from '../layout/renderChannel.testUtils'
import { postStore } from '../services/postStore'
import { NOTIFICATION_STORAGE_PREFIX } from './notificationStorage'
import { notificationsStore } from './notificationsStore'

const BASE_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  scope: 'exercise',
  personId: null,
  world: 'participant',
  isLead: false,
  accountId: 'acct-test',
  role: 'participant',
  personaId: personaIdForHandle('dreyes_fh'),
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

const current = vi.hoisted(() => ({ session: undefined as Session | undefined }))
vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  useSession: () => {
    if (current.session === undefined) throw new Error('test did not set a session')
    return current.session
  },
}))

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  resetTelemetryBuffer()
})
afterEach(() => {
  notificationsStore.reset()
  postStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
  window.localStorage.clear()
  window.sessionStorage.clear()
  // `current.session` is deliberately left set: RTL's own cleanup (which unmounts the tree) runs
  // AFTER this hook, and the reset above re-renders the still-mounted tree once.
})

const storedKeys = () =>
  Object.keys(window.localStorage).filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))

describe('control: an ordinary persona-bound session gets the bell', () => {
  it('shows the Notifications link', async () => {
    current.session = BASE_SESSION
    renderChannel({ entries: ['/home'] })
    expect(await screen.findByRole('link', { name: /^Notifications/ })).toBeInTheDocument()
    expect(notificationsStore.getSummary().available).toBe(true)
  })
})

describe.each([
  ['a persona-less session', { ...BASE_SESSION, personaId: undefined } satisfies Session],
  ['a read-only session', { ...BASE_SESSION, isReadOnly: true } satisfies Session],
])('%s', (_label, session) => {
  it('has no bell, no badge and no engine; /notifications lands on Home', async () => {
    current.session = session
    renderChannel({ entries: ['/notifications'], beside: <RouterProbe /> })

    await waitFor(() => expect(screen.getByTestId('router-location')).toHaveTextContent('/home'))
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notifications-page')).not.toBeInTheDocument()
    expect(notificationsStore.getSummary()).toEqual({ available: false, unread: 0 })
    expect(storedKeys()).toEqual([])
  })
})
