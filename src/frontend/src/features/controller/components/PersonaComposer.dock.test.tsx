/**
 * features/controller/components/PersonaComposer.dock.test.tsx
 * ---------------------------------------------------------------------------
 * The composer INSIDE the real persona-dock host (demo-polish C1, story 17 "Staff
 * world only" keyboard AC; NFR-001): `Esc` closes the dock, Ctrl/Cmd+Enter fires, and
 * the library picker - a nested surface - takes the FIRST Esc for itself (so one
 * stray Esc never discards the media tray along with the dock), the second reaches
 * the dock. `ControllerConsole.personaDraftDiscard.test.tsx` covers what the dock's
 * Esc does to the persisted draft; this file covers what Esc does FROM the composer.
 */
import { useState, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffPersona } from '@/features/personas'
import type { Post } from '@/features/social'
import { PersonaDockHost } from '../console/personaDockHost.tsx'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer } from './PersonaComposer'

/** The text field is named by its visible label: "Post as X" / "Reply as X". */
const POST_FIELD = /^(Post|Reply) as Fairhaven Water$/

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

async function renderDock(onClose: () => void, onPublished?: (post: Post) => void) {
  render(
    <Providers>
      <PersonaDockHost
        open
        onClose={onClose}
        slots={{
          composer: (
            <PersonaComposer
              activePersona={PERSONA}
              actingHumanId="human-ctl-7"
              callSign="SIMCELL-3"
              {...(onPublished !== undefined ? { onPublished } : {})}
            />
          ),
        }}
      />
    </Providers>,
  )
  await waitFor(() => expect(screen.getByTestId('persona-composer')).toBeInTheDocument())
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockMediaRegistry()
  composeAsPersonaDraftStore.resetForTests()
})

describe('PersonaComposer inside the persona dock', () => {
  it('Esc from the text field closes the dock', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    await renderDock(onClose)

    await user.click(screen.getByLabelText(POST_FIELD))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc from an attachment or baseline control closes the dock too', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    await renderDock(onClose)

    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with the picker open the first Esc closes only the picker; the second closes the dock', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    await renderDock(onClose)
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('library-panel')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'From library' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter fires the post from inside the dock without closing it', async () => {
    const onClose = vi.fn()
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderDock(onClose, onPublished)

    await user.type(screen.getByLabelText(POST_FIELD), 'Fired from the keyboard.')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished.mock.calls[0]?.[0]?.text).toBe('Fired from the keyboard.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
