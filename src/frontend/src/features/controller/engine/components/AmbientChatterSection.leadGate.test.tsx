/**
 * features/controller/engine/components/AmbientChatterSection.leadGate.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (#573): the ambient-policy lead gate. The backend 403s a
 * NON-LEAD controller RAISING the ambient policy (to autonomous, or while autonomous a
 * higher cap / added topic or persona). The section mirrors it: a non-lead sees the
 * Autonomous choice and any raising save disabled with the visible text reason tied by
 * aria-describedby; LOWERING stays open to every controller; a lead sees everything
 * enabled; a 403 response surfaces as an inline message in the same words.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import {
  engineSettingsStore,
  MOCK_ENGINE_SETTINGS,
  type EngineSettingsDto,
} from '../hooks/useEngineSettings'
import type { AmbientPolicyDto } from '../models/ambientPolicyContract'
import { EngineSettingsPanel } from './EngineSettingsPanel'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))
vi.mock('@/features/personas', () => ({
  useStaffPersonas: () => ({
    personas: [{ id: 'p-1', displayName: 'Dana Reyes', handle: '@dana' }],
    loading: false,
    error: null,
  }),
}))

const postMock = vi.fn()
const getMock = vi.fn()
vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Test Exercise',
    timeZone: 'America/New_York',
    status: 'active',
  }),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: () => ({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
  }),
}))

const EXERCISE_ID = 'ex-mock-0001'
const REASON = 'Only the lead controller can raise this'

function policy(overrides: Partial<AmbientPolicyDto> = {}): AmbientPolicyDto {
  return {
    mode: 'review',
    maxPerMinute: 2,
    maxPerHour: 30,
    topicAllowList: ['food'],
    personaAllowList: [],
    autonomousAuthorized: true,
    ...overrides,
  }
}

function seed(p: AmbientPolicyDto): EngineSettingsDto {
  const dto = { ...MOCK_ENGINE_SETTINGS, ambientPolicy: p }
  engineSettingsStore.setForTests(EXERCISE_ID, dto)
  return dto
}

function renderPanel() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <EngineSettingsPanel open onClose={vi.fn()} />
    </ThemeProvider>,
  )
}

function axios403(): AxiosError {
  const error = new AxiosError('Forbidden', '403')
  error.response = {
    status: 403,
    statusText: 'Forbidden',
    data: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
  return error
}

beforeEach(() => {
  resetStubSession()
  postMock.mockReset()
  getMock.mockReset()
  engineSettingsStore.resetForTests()
})
afterEach(() => engineSettingsStore.resetForTests())

describe('ambient policy lead gate: non-lead controller', () => {
  beforeEach(() => setStubSession({ role: 'controller', isLead: false }))

  it('disables Autonomous with the visible reason + aria-describedby; Off/Review stay enabled', async () => {
    seed(policy())
    renderPanel()
    await screen.findByTestId('ambient-chatter-section')

    const autonomous = screen.getByTestId('ambient-mode-autonomous')
    expect(autonomous).toBeDisabled()
    expect(autonomous.getAttribute('aria-describedby')).toContain('ambient-lead-reason')
    const reason = screen.getByTestId('ambient-lead-reason')
    expect(reason).toHaveTextContent(REASON)
    expect(reason.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('ambient-mode-off')).toBeEnabled()
    expect(screen.getByTestId('ambient-mode-review')).toBeEnabled()
  })

  it('a LOWERING save (review -> off) is allowed and POSTs', async () => {
    const user = userEvent.setup()
    const lowered = policy({ mode: 'off' })
    seed(policy())
    postMock.mockResolvedValue({ data: { ...MOCK_ENGINE_SETTINGS, ambientPolicy: lowered } })
    renderPanel()
    await screen.findByTestId('ambient-chatter-section')

    await user.click(screen.getByTestId('ambient-mode-off'))
    expect(screen.getByTestId('ambient-save')).toBeEnabled()
    await user.click(screen.getByTestId('ambient-save'))
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
  })

  it('while already autonomous: a raising edit disables Save with the reason; a lowering edit does not', async () => {
    const user = userEvent.setup()
    seed(policy({ mode: 'autonomous', topicAllowList: ['food'] }))
    renderPanel()
    await screen.findByTestId('ambient-chatter-section')

    // Adding a topic is a raise.
    await user.click(screen.getByTestId('ambient-topic-sports'))
    const save = screen.getByTestId('ambient-save')
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('aria-describedby', 'ambient-lead-reason')

    // Undo it, then lower instead (remove a topic): allowed.
    await user.click(screen.getByTestId('ambient-topic-sports'))
    await user.click(screen.getByTestId('ambient-topic-food'))
    expect(screen.getByTestId('ambient-save')).toBeEnabled()
  })

  it('a 403 from the server shows the reason inline and does not make the panel read-only', async () => {
    const user = userEvent.setup()
    seed(policy())
    postMock.mockRejectedValue(axios403())
    renderPanel()
    await screen.findByTestId('ambient-chatter-section')

    await user.click(screen.getByTestId('ambient-mode-off'))
    await user.click(screen.getByTestId('ambient-save'))

    const error = await screen.findByTestId('ambient-error')
    expect(error).toHaveTextContent(REASON)
    expect(screen.getByTestId('ambient-save')).toBeInTheDocument()
  })
})

describe('ambient policy lead gate: lead controller', () => {
  beforeEach(() => setStubSession({ role: 'controller', isLead: true }))

  it('everything is enabled and no lead reason is shown', async () => {
    const user = userEvent.setup()
    seed(policy())
    postMock.mockResolvedValue({
      data: { ...MOCK_ENGINE_SETTINGS, ambientPolicy: policy({ mode: 'autonomous' }) },
    })
    renderPanel()
    await screen.findByTestId('ambient-chatter-section')

    expect(screen.getByTestId('ambient-mode-autonomous')).toBeEnabled()
    expect(screen.queryByTestId('ambient-lead-reason')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('ambient-mode-autonomous'))
    expect(screen.getByTestId('ambient-save')).toBeEnabled()
  })
})
