/**
 * features/staffShell/components/PreviewChannelHost.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6 (docs/features/demo-polish/23-preview-and-startex.md) -- the
 * COMPOSITION `PreviewChannelHost` hands the Social channel, proven from the
 * channel's side: `SocialChannel` is replaced by a probe that reads every seam the
 * real channel reads (the shell mount, the session, the navigation adapter, the
 * brand), so each assertion is about what a channel would actually SEE.
 *
 *  - AC1 "Real channel": `variant: 'preview'` and the selected moment's instant arrive
 *    through the shell mount contract; the navigation adapter is the IN-MEMORY one,
 *    starting at `/home`; a brand is in scope.
 *  - AC2 "Read-only": `affordancesAvailable('preview')` is false, AND the session the
 *    channel reads is a read-only observer with no persona (same account, same
 *    exercise, same role -- narrowed, not replaced); the participant telemetry the
 *    channel emits on its own is muted while the host is mounted and live again after.
 *
 * The REAL channel, end to end, is `PreviewAsParticipant.channel.test.tsx`.
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider, useSession } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import {
  buildAndEmit,
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
} from '@/core/telemetry'
import { useBrand } from '@/features/participant-shell/brandTokens'
import {
  affordancesAvailable,
  useShellContext,
} from '@/features/participant-shell/mountContract'
import { useSocialNavigation } from '@/features/social/layout/socialNavigation'
import { PreviewChannelHost } from './PreviewChannelHost'

const MOMENT = new Date('2033-09-04T12:30:00.000Z')

/** Stands in for `SocialChannel`: reads the seams the real one reads and prints them. */
function ChannelProbe() {
  const { variant, scenarioNow } = useShellContext()
  const session = useSession()
  const navigation = useSocialNavigation()
  const brand = useBrand()

  // What the real feed does on its own on mount: a participant-kind `view`.
  useEffect(() => {
    buildAndEmit({
      exerciseId: session.exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: new Date().toISOString(),
      scenarioTime: scenarioNow.toISOString(),
      timeZone: 'UTC',
      target: { entityType: 'feed', entityId: 'all-posts' },
    })
  }, [session.exerciseId, session.accountId, scenarioNow])

  return (
    <dl data-testid="probe">
      <dt>variant</dt>
      <dd data-testid="variant">{variant}</dd>
      <dt>affordances</dt>
      <dd data-testid="affordances">{String(affordancesAvailable(variant))}</dd>
      <dt>scenarioNow</dt>
      <dd data-testid="scenario-now">{scenarioNow.toISOString()}</dd>
      <dt>isReadOnly</dt>
      <dd data-testid="is-read-only">{String(session.isReadOnly)}</dd>
      <dt>personaId</dt>
      <dd data-testid="persona-id">{session.personaId ?? 'none'}</dd>
      <dt>accountId</dt>
      <dd data-testid="account-id">{session.accountId}</dd>
      <dt>role</dt>
      <dd data-testid="role">{session.role}</dd>
      <dt>navigation</dt>
      <dd data-testid="nav-kind">{navigation.kind}</dd>
      <dd data-testid="nav-path">{navigation.location.pathname}</dd>
      <dt>brand</dt>
      <dd data-testid="brand-name">{brand.name}</dd>
    </dl>
  )
}

vi.mock('@/features/social', () => ({
  SocialChannel: ChannelProbe,
}))

afterEach(() => {
  resetTelemetryBuffer()
})

function mount(scenarioNow: Date = MOMENT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (instant: Date) => (
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <PreviewChannelHost scenarioNow={instant} />
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )
  const view = render(tree(scenarioNow))
  return { ...view, rerenderWith: (instant: Date) => view.rerender(tree(instant)) }
}

describe('PreviewChannelHost -- what the channel sees (AC1)', () => {
  it('mounts the channel under variant "preview" with the chosen moment as scenario time', async () => {
    mount()

    expect(await screen.findByTestId('variant')).toHaveTextContent('preview')
    expect(screen.getByTestId('scenario-now')).toHaveTextContent(MOMENT.toISOString())
  })

  it('follows the moment: a new instant reaches the channel through the shell mount', async () => {
    const view = mount()
    expect(await screen.findByTestId('scenario-now')).toHaveTextContent(MOMENT.toISOString())

    const later = new Date('2033-09-04T14:00:00.000Z')
    view.rerenderWith(later)

    expect(screen.getByTestId('scenario-now')).toHaveTextContent(later.toISOString())
  })

  it('gives the channel the IN-MEMORY navigation adapter, starting at /home', async () => {
    mount()

    expect(await screen.findByTestId('nav-kind')).toHaveTextContent('memory')
    expect(screen.getByTestId('nav-path')).toHaveTextContent('/home')
  })

  it('has the exercise brand in scope (the participant providers, in the app\'s order)', async () => {
    mount()

    expect((await screen.findByTestId('brand-name')).textContent).not.toBe('')
    expect(screen.getByTestId('social-brand-scope')).toContainElement(screen.getByTestId('probe'))
    expect(screen.getByTestId('pulse-brand-theme-scope')).toContainElement(
      screen.getByTestId('social-brand-scope'),
    )
  })
})

describe('PreviewChannelHost -- nothing it mounts can write (AC2)', () => {
  it('reports affordances unavailable for the preview variant', async () => {
    mount()

    expect(await screen.findByTestId('affordances')).toHaveTextContent('false')
  })

  it('narrows the session to a read-only observer with no persona -- same account, same role', async () => {
    mount()

    expect(await screen.findByTestId('is-read-only')).toHaveTextContent('true')
    expect(screen.getByTestId('persona-id')).toHaveTextContent('none')
    // Narrowed, not replaced: identity and role are the surrounding session's own.
    expect(screen.getByTestId('account-id')).toHaveTextContent('acct-dreyes')
    expect(screen.getByTestId('role')).toHaveTextContent('participant')
  })

  it('mutes the participant telemetry the channel emits on its own while mounted, and restores it after', async () => {
    const view = mount()
    await screen.findByTestId('probe')

    // The probe's mount effect emitted a participant `view` -- the sink dropped it.
    expect(getEmittedTelemetryEvents()).toEqual([])

    view.unmount()

    buildAndEmit({
      exerciseId: 'ex-after',
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: 'acct-after' },
      wallClockTime: new Date().toISOString(),
      scenarioTime: MOMENT.toISOString(),
      timeZone: 'UTC',
      target: { entityType: 'feed', entityId: 'all-posts' },
    })
    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })

  it('CR-001: a staff audit record emitted WHILE the preview is mounted is still recorded', async () => {
    mount()
    await screen.findByTestId('probe')

    // What a takedown does when its DELETE resolves after the preview was opened.
    buildAndEmit({
      exerciseId: 'ex-mock-0001',
      eventType: 'steering_action',
      channel: 'system',
      actor: { kind: 'system', actingHumanId: 'human-controller-01', role: 'controller' },
      wallClockTime: new Date().toISOString(),
      scenarioTime: MOMENT.toISOString(),
      timeZone: 'UTC',
      target: { entityType: 'post', entityId: 'post-9' },
      payload: { action: 'takedown', category: 'pii' },
    })

    expect(getEmittedTelemetryEvents().map(event => event.eventType)).toEqual(['steering_action'])
  })
})
