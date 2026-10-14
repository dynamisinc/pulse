/**
 * features/staffShell/components/PreviewAsParticipant.errorBoundary.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6, Gate-1 W-3 -- the REAL `PreviewChannelHost` (so its providers, and the
 * telemetry hold it takes) around a channel child that THROWS.
 *
 * A render error inside the participant channel must stay inside the preview:
 *   - "Participant preview unavailable" replaces the channel; the staff strip and Exit remain;
 *   - the error never reaches an outer boundary -- in production that is `RootFailClosedBoundary`,
 *     which treats a throw as an unresolved session and redirects to /login;
 *   - the preview's telemetry hold is RELEASED when its subtree is torn down, whether the
 *     channel failed on its first render (the hold was never taken) or later (it was, and the
 *     unmount cleanup gives it back) -- so participant events flow again and the sink is not
 *     left muted for the rest of the tab.
 *
 * `SocialChannel` is replaced by a probe that throws on demand; everything around it
 * (`ReadOnlySessionScope`, shell context, brand, memory navigation, the mute) is real.
 */
import { Component, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { buildAndEmit, getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { PreviewProvider, usePreview } from '../previewContext'
import { PreviewAsParticipant } from './PreviewAsParticipant'

const channel = vi.hoisted(() => ({ throwOnFirstRender: false }))

vi.mock('@/features/social', async () => {
  const { useState: useStateInFactory } = await import('react')
  return {
    SocialChannel: function ThrowingChannel() {
      const [broken, setBroken] = useStateInFactory(false)
      if (channel.throwOnFirstRender || broken) throw new Error('boom: a post failed to render')
      return (
        <button type="button" data-testid="break-channel" onClick={() => setBroken(true)}>
          break the channel
        </button>
      )
    },
  }
})

/** Stands in for `RootFailClosedBoundary`: reaching it would redirect to /login. */
class OuterBoundary extends Component<{ children: ReactNode }, { hit: boolean }> {
  override state = { hit: false }

  static getDerivedStateFromError() {
    return { hit: true }
  }

  override render() {
    return this.state.hit
      ? <p data-testid="outer-boundary-hit">REDIRECT TO LOGIN</p>
      : this.props.children
  }
}

function WorkArea() {
  const { active, toggle } = usePreview()
  return (
    <div>
      <button type="button" data-testid="staff-header-preview-toggle" onClick={toggle}>toggle</button>
      {active ? <PreviewAsParticipant /> : <p data-testid="work-area">console</p>}
    </div>
  )
}

function renderPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <OuterBoundary>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>
          <SessionProvider>
            <PreviewProvider>
              <WorkArea />
            </PreviewProvider>
          </SessionProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </OuterBoundary>,
  )
}

/** A participant-kind `view`, as the real feed emits one. */
function emitParticipantView(entityId: string) {
  buildAndEmit({
    exerciseId: 'ex-mock-0001',
    eventType: 'view',
    channel: 'social',
    actor: { kind: 'participant', participantId: 'acct-1' },
    wallClockTime: new Date().toISOString(),
    scenarioTime: '2033-09-04T14:30:00.000Z',
    timeZone: 'UTC',
    target: { entityType: 'feed', entityId },
  })
}

beforeEach(() => {
  channel.throwOnFirstRender = false
  resetTelemetryBuffer()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetTelemetryBuffer()
})

async function openPreview() {
  const user = userEvent.setup()
  renderPreview()
  await user.click(await screen.findByTestId('staff-header-preview-toggle'))
  return user
}

describe('a channel that throws on its FIRST render', () => {
  beforeEach(() => {
    channel.throwOnFirstRender = true
  })

  it('shows "Participant preview unavailable" and keeps the strip and Exit', async () => {
    await openPreview()

    expect(await screen.findByTestId('preview-unavailable')).toHaveTextContent(
      'Participant preview unavailable',
    )
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent('PREVIEW AS PARTICIPANT')
    expect(screen.getByTestId('preview-exit')).toBeInTheDocument()
  })

  it('never reaches the outer boundary (no redirect to /login)', async () => {
    await openPreview()
    await screen.findByTestId('preview-unavailable')

    expect(screen.queryByTestId('outer-boundary-hit')).not.toBeInTheDocument()
  })

  it('W-3: the failure panel is the preview\'s ONE main (the channel that would have been it is gone), with the alert inside', async () => {
    await openPreview()
    const alert = await screen.findByTestId('preview-unavailable')

    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toContainElement(alert)
    // The alert role is on a CHILD: on the main itself it would replace the landmark role.
    expect(alert).not.toBe(mains[0])
    expect(screen.getByRole('region', { name: 'Participant preview (read-only)' })).toContainElement(mains[0] ?? null)
  })

  it('leaves telemetry unmuted: the hold was never taken', async () => {
    await openPreview()
    await screen.findByTestId('preview-unavailable')

    emitParticipantView('after-first-render-failure')

    expect(getEmittedTelemetryEvents()).toHaveLength(1)
  })

  it('Exit returns to the console', async () => {
    const user = await openPreview()
    await screen.findByTestId('preview-unavailable')

    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.getByTestId('work-area')).toBeInTheDocument()
  })
})

describe('a channel that throws AFTER it was mounted (the hold is already taken)', () => {
  it('mutes participant events while the channel is up, and RELEASES the hold when it fails', async () => {
    const user = await openPreview()
    await screen.findByTestId('break-channel')

    // Up: the preview holds the mute.
    emitParticipantView('while-up')
    expect(getEmittedTelemetryEvents()).toEqual([])

    await user.click(screen.getByTestId('break-channel'))

    // Failed: the boundary replaced the subtree, React ran the cleanup, the hold is gone.
    expect(await screen.findByTestId('preview-unavailable')).toBeInTheDocument()
    emitParticipantView('after-failure')
    expect(getEmittedTelemetryEvents().map(event => event.target?.entityId))
      .toEqual(['after-failure'])
  })

  it('never reaches the outer boundary, and the strip and Exit survive', async () => {
    const user = await openPreview()
    await user.click(await screen.findByTestId('break-channel'))
    await screen.findByTestId('preview-unavailable')

    expect(screen.queryByTestId('outer-boundary-hit')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-exit')).toBeInTheDocument()
    await user.click(screen.getByTestId('preview-exit'))
    expect(screen.getByTestId('work-area')).toBeInTheDocument()
  })
})
