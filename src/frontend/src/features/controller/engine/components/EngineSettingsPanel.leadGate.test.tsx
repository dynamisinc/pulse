/**
 * features/controller/engine/components/EngineSettingsPanel.leadGate.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573), lead-controller gate, raise-only (Tom's Option A).
 * In the settings flyout, RAISING is lead-only: autonomy default up (Suggest -> Delayed-auto),
 * tier policy up (ambient < standard < auto) and the generation-provider Restore. A non-lead
 * controller sees those controls DISABLED with the visible text "Only the lead controller can
 * raise this" (icon + words, tied by aria-describedby); LOWERING stays enabled for every
 * controller. The session is the role-selectable stub (`isLead` is the server's flag).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import {
  engineSettingsStore,
  MOCK_ENGINE_SETTINGS,
  type EngineSettingsDto,
} from '../hooks/useEngineSettings'
import { EngineSettingsPanel } from './EngineSettingsPanel'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
// Conduct gate (controller): this suite is about the lead gate on top of it.
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

const EXERCISE_ID = 'ex-mock-0001'
const REASON = 'Only the lead controller can raise this'

function dto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
    ...MOCK_ENGINE_SETTINGS,
    provider: 'Fake',
    effectiveProvider: 'Fake',
    providerCutToFake: false,
    alreadyFake: true,
    autonomy: {
      swampedMode: false,
      generationStopped: false,
      safetyClampActive: false,
      degradedReason: null,
      exerciseDefaultLevel: 'suggest',
      effectiveLevel: 'suggest',
    },
    tierPolicyMode: 'ambient',
    ...overrides,
  }
}

beforeEach(() => {
  resetStubSession()
  engineSettingsStore.resetForTests()
})
afterEach(() => engineSettingsStore.resetForTests())

async function renderPanel() {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineSettingsPanel open onClose={vi.fn()} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  await screen.findByTestId('engine-settings-panel')
}

describe('non-lead controller: raises are disabled with a text reason', () => {
  beforeEach(() => setStubSession({ role: 'controller', isLead: false }))

  it('autonomy: Delayed-auto (a raise) is disabled and explained; Suggest (current) is not', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    await renderPanel()

    const raise = screen.getByTestId('autonomy-default-delayed-auto')
    expect(raise).toBeDisabled()
    expect(raise).toHaveAttribute('aria-describedby', 'autonomy-default-lead-reason')
    const reason = screen.getByTestId('autonomy-default-lead-reason')
    expect(reason).toHaveTextContent(REASON)
    expect(reason.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('autonomy-default-suggest')).toBeEnabled()
  })

  it('autonomy: LOWERING Delayed-auto to Suggest stays available', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: false,
          degradedReason: null,
          exerciseDefaultLevel: 'delayed-auto',
          effectiveLevel: 'delayed-auto',
        },
      }),
    )
    await renderPanel()

    expect(screen.getByTestId('autonomy-default-suggest')).toBeEnabled()
    await user.click(screen.getByTestId('autonomy-default-suggest'))
    expect(screen.getByTestId('autonomy-default-suggest')).toHaveAttribute('aria-pressed', 'true')
  })

  it('tier policy: from ambient, standard and auto (raises) are disabled; ambient is not', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto({ tierPolicyMode: 'ambient' }))
    await renderPanel()

    expect(screen.getByTestId('tier-policy-standard')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-auto')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-ambient')).toBeEnabled()
    expect(screen.getByTestId('tier-policy-lead-reason')).toHaveTextContent(REASON)
  })

  it('tier policy: from auto every lower position is enabled (ranking ambient < standard < auto)', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto({ tierPolicyMode: 'auto' }))
    await renderPanel()

    expect(screen.getByTestId('tier-policy-standard')).toBeEnabled()
    expect(screen.getByTestId('tier-policy-ambient')).toBeEnabled()
    await user.click(screen.getByTestId('tier-policy-ambient'))
    expect(screen.getByTestId('tier-policy-ambient')).toHaveAttribute('aria-pressed', 'true')
    // ...and now that it sits at the bottom, going back up is a raise.
    expect(screen.getByTestId('tier-policy-auto')).toBeDisabled()
  })

  it('tier policy: from standard, auto is a raise (disabled) and ambient a lowering (enabled)', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto({ tierPolicyMode: 'standard' }))
    await renderPanel()

    expect(screen.getByTestId('tier-policy-auto')).toBeDisabled()
    expect(screen.getByTestId('tier-policy-ambient')).toBeEnabled()
  })

  it('generation-provider Restore is disabled and explained; Cut to Fake is not offered while cut', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAi', effectiveProvider: 'Fake', providerCutToFake: true, alreadyFake: false }),
    )
    await renderPanel()

    const restore = screen.getByTestId('provider-lever-restore')
    expect(restore).toBeDisabled()
    expect(restore).toHaveAttribute('aria-describedby', 'provider-lever-lead-reason')
    expect(screen.getByTestId('provider-lever-lead-reason')).toHaveTextContent(REASON)
  })

  it('generation-provider Cut to Fake (a lowering) stays enabled', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAi', effectiveProvider: 'AzureOpenAi', providerCutToFake: false, alreadyFake: false }),
    )
    await renderPanel()

    expect(screen.getByTestId('provider-lever-cut')).toBeEnabled()
  })
})

describe('lead controller: nothing is disabled for lack of the lead', () => {
  beforeEach(() => setStubSession({ role: 'controller', isLead: true }))

  it('raises are enabled and no lead reason is shown', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto({ tierPolicyMode: 'ambient' }))
    await renderPanel()

    expect(screen.getByTestId('autonomy-default-delayed-auto')).toBeEnabled()
    expect(screen.getByTestId('tier-policy-auto')).toBeEnabled()
    expect(screen.queryByTestId('autonomy-default-lead-reason')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tier-policy-lead-reason')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('autonomy-default-delayed-auto'))
    expect(screen.getByTestId('autonomy-default-delayed-auto')).toHaveAttribute('aria-pressed', 'true')
  })

  it('Restore is enabled', async () => {
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto({ provider: 'AzureOpenAi', effectiveProvider: 'Fake', providerCutToFake: true, alreadyFake: false }),
    )
    await renderPanel()

    expect(screen.getByTestId('provider-lever-restore')).toBeEnabled()
    expect(screen.queryByTestId('provider-lever-lead-reason')).not.toBeInTheDocument()
  })
})
