/**
 * features/controller/components/steering/PausePill.register.live.test.tsx
 * ---------------------------------------------------------------------------
 * The CLICK-TO-WIRE proof for world-steering story 08 (AC1/AC5): a controller
 * picking the participant pause page in `<PausePill>` and freezing the world
 * actually sends that register on `POST /api/steering/pause-tier`.
 *
 * Deliberately does NOT mock `usePauseState` (its sibling `PausePill.test.tsx`
 * does, to drive render branches) — the whole point here is the real chain
 * click → the shared pause store → the live POST body. Only the edges are
 * mocked: `USE_MOCK_DATA` is forced false to select the live branch, the
 * pause-tier/kill-switch actions are stubbed so no network is touched, and the
 * exercise/identity seams are stubbed as their own suites do.
 *
 * The remaining two legs of AC5 are covered where they live: the server carries
 * the register through to the participant read
 * (`PauseTierEndpointsTests.Post_FreezeWithInFictionSelected_…`) and the pushed
 * register renders the matching copy on an UNMODIFIED `OverlayLayer`
 * (`OverlayLayer.live.test.tsx`).
 *
 * STAFF world — COBRA theme, no participant surface is rendered here.
 */
import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import * as livePauseTierActions from '../../services/livePauseTierActions'
import { resetPauseStateForTest } from '../../hooks/usePauseState'
import { PausePill } from './PausePill'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))

vi.mock('../../services/livePauseTierActions', () => ({
  setPauseTier: vi.fn(),
  fetchPauseTier: vi.fn(),
}))
vi.mock('../../engine/services/liveEngineControlActions', () => ({
  setMode: vi.fn().mockResolvedValue(undefined),
}))
// The telemetry sink fire-and-forgets a POST through the shared axios client;
// resolve it so emission stays synchronous (mirrors usePauseState.test.tsx).
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

const mockedSetPauseTier = vi.mocked(livePauseTierActions.setPauseTier)
const mockedFetchPauseTier = vi.mocked(livePauseTierActions.fetchPauseTier)

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-live-register-0001',
    exerciseName: 'Register Live Test Exercise',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
  })
  mockedSetPauseTier.mockResolvedValue({ tier: 'freeze', clockFrozen: true })
  mockedFetchPauseTier.mockRejectedValue(new Error('no resync in this test'))
  resetTelemetryBuffer()
})

afterEach(() => {
  resetPauseStateForTest()
  vi.clearAllMocks()
})

/** Picks a register in the popover, then drives the guarded Freeze to completion. */
async function freezeWithRegister(user: ReturnType<typeof userEvent.setup>, register: string) {
  await user.click(screen.getByTestId('pause-pill'))
  await user.click(within(screen.getByTestId(`pause-register-option-${register}`)).getByRole('radio'))
  await user.click(within(screen.getByTestId('pause-tier-option-freeze')).getByRole('radio'))
  await user.click(screen.getByTestId('pause-apply'))
  await user.click(screen.getByTestId('pause-freeze-confirm-button'))
}

describe('PausePill → live pause-tier POST carries the selected participant pause page', () => {
  it('sends overlayRegister: in-fiction when the controller picks the in-fiction page', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PausePill />)

    await freezeWithRegister(user, 'in-fiction')

    expect(mockedSetPauseTier).toHaveBeenCalledWith('freeze', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      overlayRegister: 'in-fiction',
    })
  })

  it('sends overlayRegister: out-of-fiction (the default) when that page is selected', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PausePill />)

    await freezeWithRegister(user, 'out-of-fiction')

    expect(mockedSetPauseTier).toHaveBeenCalledWith('freeze', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      overlayRegister: 'out-of-fiction',
    })
  })

  it('carries the last selection when the controller changes their mind before freezing', async () => {
    const user = userEvent.setup()
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(within(screen.getByTestId('pause-register-option-in-fiction')).getByRole('radio'))
    await user.click(
      within(screen.getByTestId('pause-register-option-out-of-fiction')).getByRole('radio'),
    )
    await user.click(within(screen.getByTestId('pause-tier-option-freeze')).getByRole('radio'))
    await user.click(screen.getByTestId('pause-apply'))
    await user.click(screen.getByTestId('pause-freeze-confirm-button'))

    expect(mockedSetPauseTier).toHaveBeenLastCalledWith('freeze', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
      overlayRegister: 'out-of-fiction',
    })
  })
})
