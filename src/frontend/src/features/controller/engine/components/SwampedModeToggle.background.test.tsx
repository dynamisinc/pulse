/**
 * features/controller/engine/components/SwampedModeToggle.background.test.tsx
 * ---------------------------------------------------------------------------
 * REAL hooks (live mode) under the toggle: a BACKGROUND settings GET must not disable the
 * switch or drop keyboard focus (NFR-001), must not make the settings panel flash "Loading",
 * and an OFF confirmed during it must still POST and keep the confirm open until it settles.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import * as actions from '../services/engineSettingsActions'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { MOCK_ENGINE_SETTINGS, engineSettingsStore, useEngineSettings } from '../hooks/useEngineSettings'
import { EngineSettingsPanel } from './EngineSettingsPanel'
import { SwampedModeToggle } from './SwampedModeToggle'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))
vi.mock('../services/engineSettingsActions', async () => ({
  ...(await vi.importActual<typeof import('../services/engineSettingsActions')>(
    '../services/engineSettingsActions',
  )),
  getSettings: vi.fn(),
  setSwampedMode: vi.fn(),
}))

const getSettings = vi.mocked(actions.getSettings)
const postSwamped = vi.mocked(actions.setSwampedMode)

function dto(swampedMode: boolean): EngineSettingsDto {
  return { ...MOCK_ENGINE_SETTINGS, autonomy: { ...MOCK_ENGINE_SETTINGS.autonomy, swampedMode } }
}

function Harness() {
  const settings = useEngineSettings()
  return (
    <ThemeProvider theme={cobraTheme}>
      <SwampedModeToggle />
      <EngineSettingsPanel open onClose={vi.fn()} />
      <button type="button" data-testid="bg" onClick={settings.refreshInBackground} />
      <span data-testid="loading">{String(settings.loading)}</span>
    </ThemeProvider>
  )
}

async function mount(initial: boolean) {
  getSettings.mockResolvedValue(dto(initial))
  render(<Harness />)
  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
  await waitFor(() => expect(getSettings).toHaveBeenCalled())
}

beforeEach(() => {
  resetStubSession()
  engineSettingsStore.resetForTests()
  vi.clearAllMocks()
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-bg',
    exerciseName: 'BG',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'h1',
    callSign: 'S1',
    role: 'controller',
  })
})

describe('SwampedModeToggle with a background GET in flight (CR-001)', () => {
  it('keeps the switch enabled and focused, and never shows loading', async () => {
    setStubSession({ role: 'controller', isLead: true })
    await mount(false)
    const toggle = await screen.findByTestId('swamped-mode-enable-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    toggle.focus()

    let land: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { land = r }))
    fireEvent.click(screen.getByTestId('bg'))
    toggle.focus()

    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(toggle).toBeEnabled()
    expect(document.activeElement).toBe(toggle)

    await act(async () => land(dto(false)))
    expect(toggle).toBeEnabled()
    expect(document.activeElement).toBe(toggle)
  })

  it('a non-lead OFF confirmed during it still POSTs, and the confirm stays open until it lands', async () => {
    setStubSession({ role: 'controller', isLead: false })
    await mount(true)
    fireEvent.click(await screen.findByTestId('swamped-mode-turn-off-button'))

    let land: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { land = r }))
    fireEvent.click(screen.getByTestId('bg'))

    postSwamped.mockResolvedValue(false)
    getSettings.mockResolvedValue(dto(false))
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-confirm'))

    expect(postSwamped).not.toHaveBeenCalled() // queued behind the background GET
    expect(screen.getByTestId('swamped-mode-turn-off-confirm')).toBeDisabled() // still open, honest

    await act(async () => land(dto(true)))
    await waitFor(() => expect(postSwamped).toHaveBeenCalledWith(false, { actingHumanId: 'person-stub' }))
    await waitFor(() => expect(screen.queryByTestId('swamped-mode-turn-off')).not.toBeInTheDocument())
  })

  it('the settings panel shows no "Loading" on a background refresh', async () => {
    setStubSession({ role: 'controller', isLead: true })
    await mount(false)
    await screen.findByTestId('engine-settings-panel')
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(() => {}))
    fireEvent.click(screen.getByTestId('bg'))
    expect(screen.queryByTestId('engine-settings-loading')).not.toBeInTheDocument()
  })
})
