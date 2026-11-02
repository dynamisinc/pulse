/**
 * Story 07 (#772) AC "Click telemetry" (PC-6, XC-004): one
 * `portal_module_click` per activation, from the frame (never the module),
 * with scenario time; Enter on a link never double-fires. Drives the REAL
 * environment (`LivePortalFrameEnvironment`, mounted by `PortalLayout`) and
 * the real emitter; only the session, exercise and enablement sources are
 * mocked.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ModuleFrame } from './ModuleFrame'
import { ModuleLink } from './ModuleLink'
import { PortalLayout } from './PortalLayout'
import { createPortalModuleRegistry } from './registry'
import type { PortalModuleProps } from './types'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-portal-07', timeZone: 'America/Chicago' }),
}))
vi.mock('@/core/auth', () => ({
  useSession: () => ({ accountId: 'acct-portal-07' }),
}))
vi.mock('@/features/channels/routing', () => ({
  useEnabledChannels: () => ({
    status: 'ready',
    enabledIds: new Set(['news', 'social']),
    isEnabled: (id: string) => id === 'news' || id === 'social',
    isRefreshing: false,
  }),
}))

const SCENARIO = '2026-12-05T14:30:00.000Z'

function TopStories({ moduleId, trackClick }: PortalModuleProps) {
  return (
    <ModuleFrame moduleId={moduleId} title="Top Stories" status="ready">
      <ModuleLink moduleId={moduleId} to="/news/daily/flood-1" target={{ contentId: 'content-1' }}>
        Flood closes Main Street
      </ModuleLink>
      <button type="button" onClick={() => trackClick()}>Play</button>
    </ModuleFrame>
  )
}

function renderPortal() {
  const registry = createPortalModuleRegistry()
  registry.register({ id: 'topStories', channelId: 'news', region: 'lead', order: 1, Component: TopStories })
  return render(
    <MemoryRouter>
      <PortalLayout layoutKey="anchor" registry={registry} modules={[{ id: 'topStories', channelId: 'news' }]} />
    </MemoryRouter>,
  )
}

const clicks = () => getEmittedTelemetryEvents().filter(event => event.eventType === 'portal_module_click')

beforeEach(() => {
  resetTelemetryBuffer()
  setExerciseClock({ scenarioNow: () => new Date(SCENARIO) })
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('portal_module_click', () => {
  it('emits one event for a content link, with the PC-6 target and contentId', async () => {
    renderPortal()
    await userEvent.setup().click(screen.getByRole('link', { name: 'Flood closes Main Street' }))
    const events = clicks()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      exerciseId: 'ex-portal-07',
      channel: 'portal',
      actor: { kind: 'participant', participantId: 'acct-portal-07' },
      scenarioTime: SCENARIO,
      timeZone: 'America/Chicago',
      target: { entityType: 'portal_module', entityId: 'topStories' },
      payload: { contentId: 'content-1' },
    })
  })

  it('emits one event for "See all", with no payload', async () => {
    renderPortal()
    await userEvent.setup().click(screen.getByRole('link', { name: 'See all Top Stories' }))
    const events = clicks()
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'portal_module', entityId: 'topStories' })
    expect(events[0]?.payload).toBeUndefined()
  })

  it('keyboard Enter on a link fires exactly once', async () => {
    renderPortal()
    const user = userEvent.setup()
    screen.getByRole('link', { name: 'Flood closes Main Street' }).focus()
    await user.keyboard('{Enter}')
    expect(clicks()).toHaveLength(1)
  })

  it('a module\'s own control reports through the bound trackClick', async () => {
    renderPortal()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Play' }))
    expect(clicks()).toHaveLength(1)
    expect(clicks()[0]?.target?.entityId).toBe('topStories')
  })
})
