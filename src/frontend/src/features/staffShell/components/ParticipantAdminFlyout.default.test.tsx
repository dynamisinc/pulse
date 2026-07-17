/**
 * features/staffShell/components/ParticipantAdminFlyout.default.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the SHIPPED default path: `ParticipantAdminFlyout` rendered
 * under the REAL, un-mocked `ExerciseContextProvider` (the Wave-0 DEV mock
 * resolution) AND the real `../participantAdminMocks` seam (not mocked at
 * the module boundary). The sibling `ParticipantAdminFlyout.test.tsx` mocks
 * both to exercise every branch deterministically; this file is the only one
 * that runs what the app actually executes today (WAVE0-REVIEW precedent 19
 * — mirrors `StaffHeader.default.test.tsx` / `exerciseContextResolver.default
 * .test.ts`). Deliberately does NOT mock `@/core/exerciseContext` or
 * `../participantAdminMocks`.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ParticipantAdminFlyout, PARTICIPANT_ADMIN_TOOL_ID } from './ParticipantAdminFlyout'
import { Toolstrip } from './Toolstrip'
import { ToolstripProvider } from '../toolRegistry'
import { ExerciseContextProvider } from '@/core/exerciseContext'

describe('ParticipantAdminFlyout — shipped default (real ExerciseContextProvider + participantAdminMocks)', () => {
  it('registers a pending badge and lists the mock exercise\'s real roster rows once opened', async () => {
    const user = userEvent.setup()

    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <ToolstripProvider>
            <ParticipantAdminFlyout />
            <Toolstrip />
          </ToolstripProvider>
        </ExerciseContextProvider>
      </ThemeProvider>,
    )

    const toolButton = await screen.findByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`)
    expect(screen.getByTestId(`toolstrip-badge-${PARTICIPANT_ADMIN_TOOL_ID}`)).toBeInTheDocument()

    await user.click(toolButton)

    const flyout = await screen.findByTestId('participant-admin-flyout')
    expect(flyout).toHaveTextContent('Morgan Ellis')
    expect(flyout).toHaveTextContent('EOC Liaison')
    expect(flyout.querySelectorAll('input')).toHaveLength(0)
  })
})
