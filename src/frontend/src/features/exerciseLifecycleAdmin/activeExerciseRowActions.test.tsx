/**
 * features/exerciseLifecycleAdmin/activeExerciseRowActions.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback story 22 (#553 review): what a row action on the ACTIVE
 * exercise does to the rest of the staff app, measured through the REAL
 * `ExerciseContextProvider` (only the server resolution is mocked) rather than
 * a stubbed refresh, so each test fails if the hook stops asking.
 *
 *  1. ARCHIVE → HEADER. `StaffHeader`'s state pill reads the scope, which
 *     re-reads only when explicitly refreshed. Archiving the active exercise
 *     must turn ENDEX into ARCHIVED without a reload.
 *  2. RENAME → SETTINGS. The planner's settings save is a FULL REPLACE that
 *     sends `name`. A planner who opened Settings, renamed the active exercise
 *     here, and went back inside the 60-second cache window used to get the
 *     old name in the form, and an unrelated save wrote it back over the
 *     rename. The round trip below drives exactly that path and checks the
 *     body the save sends.
 *
 * Both services are mocked at the module boundary (real error classes kept via
 * `importOriginal`) with a tiny stateful "server", so the second read answers
 * what the write changed.
 */
import { useState, type ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resolveExerciseContext, type ExerciseScope } from '@/core/exerciseContext/exerciseContextResolver'
import { ExerciseSettingsPanel } from '@/features/planner/components/ExerciseSettingsPanel'
import {
  getExerciseSettings,
  updateExerciseSettings,
  type ExerciseSettings,
} from '@/features/planner/services/exerciseSettingsService'
import { ExerciseManagementRoute } from './ExerciseManagementRoute'
import { ExerciseManagementPage } from './pages/ExerciseManagementPage'
import {
  archiveOrgExercise,
  getOrgExercises,
  renameOrgExercise,
} from './services/orgExercisesService'
import type { OrgExercise } from './types'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'

// Story 17: role-gated controls read the session; stand in the session this suite signs in as.
vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))

vi.mock('@/core/exerciseContext/exerciseContextResolver', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext/exerciseContextResolver')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})
vi.mock('./services/orgExercisesService', async importOriginal => {
  const actual = await importOriginal<typeof import('./services/orgExercisesService')>()
  return {
    ...actual,
    getOrgExercises: vi.fn(),
    createOrgExercise: vi.fn(),
    renameOrgExercise: vi.fn(),
    archiveOrgExercise: vi.fn(),
  }
})
vi.mock('@/features/planner/services/exerciseSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/planner/services/exerciseSettingsService')>()
  return { ...actual, getExerciseSettings: vi.fn(), updateExerciseSettings: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)
const mockList = vi.mocked(getOrgExercises)
const mockRename = vi.mocked(renameOrgExercise)
const mockArchive = vi.mocked(archiveOrgExercise)
const mockGetSettings = vi.mocked(getExerciseSettings)
const mockUpdateSettings = vi.mocked(updateExerciseSettings)

/** The ACTIVE exercise: completed, so it can be archived. */
const ACTIVE_ID = 'ex-c'
const OTHER: OrgExercise = { exerciseId: 'ex-b', name: 'Zulu Build', status: 'build' }

/** The stateful "server": what the next read of each endpoint answers. */
const server = { name: 'Coastal Surge', status: 'completed' as OrgExercise['status'] }

function serverRow(): OrgExercise {
  return { exerciseId: ACTIVE_ID, name: server.name, status: server.status }
}

function serverScope(): ExerciseScope {
  return {
    exerciseId: ACTIVE_ID,
    exerciseName: server.name,
    timeZone: 'UTC',
    status: server.status === 'archived' ? 'archived' : 'completed',
  }
}

function serverSettings(): ExerciseSettings {
  return {
    exerciseId: ACTIVE_ID,
    name: server.name,
    worldName: 'Metro Coast',
    participantName: 'Coast Exercise',
    locale: null,
    timeZone: 'UTC',
    scheduledStartAt: null,
    scheduledEndAt: null,
    channels: [{ id: 'social', label: 'Social', enabled: true }],
    brandName: null,
    brandPrimary: null,
    brandAccent: null,
    brandSurface: null,
    brandOnSurface: null,
    outletNames: {},
  }
}

/** The app's shared client keeps reads fresh for 60 seconds; so does this one. */
function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/staff/exercises']}>
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>{ui}</ExerciseContextProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetStubSession()
  setStubSession({ role: 'orgAdmin', isLead: false })
  vi.resetAllMocks()
  server.name = 'Coastal Surge'
  server.status = 'completed'
  mockResolve.mockImplementation(async () => serverScope())
  mockList.mockImplementation(async () => [serverRow(), OTHER])
  mockGetSettings.mockImplementation(async () => serverSettings())
  mockUpdateSettings.mockImplementation(async () => serverSettings())
})

describe('archiving the ACTIVE exercise', () => {
  it('turns the staff header’s ENDEX pill into ARCHIVED without a reload', async () => {
    const user = userEvent.setup()
    mockArchive.mockImplementation(async () => {
      server.status = 'archived'
      return serverRow()
    })
    renderWithProviders(<ExerciseManagementRoute />)

    await screen.findByTestId('org-exercise-table')
    const pill = screen.getByTestId('staff-header-state-pill-label')
    expect(pill).toHaveTextContent('ENDEX')

    await user.click(screen.getByRole('button', { name: 'Archive Coastal Surge' }))
    const dialog = await screen.findByTestId('archive-exercise-dialog')
    await user.click(within(dialog).getByTestId('archive-exercise-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('staff-header-state-pill-label')).toHaveTextContent('ARCHIVED')
    })
    expect(within(screen.getByTestId(`org-exercise-row-${ACTIVE_ID}`)).getByText('Archived'))
      .toBeInTheDocument()
  })
})

/** Settings and Exercise Management, one at a time, as the staff navigation swaps them. */
function SettingsThenManagement() {
  const [view, setView] = useState<'settings' | 'manage'>('settings')
  return (
    <>
      <button type="button" onClick={() => setView('settings')}>Go to settings</button>
      <button type="button" onClick={() => setView('manage')}>Go to exercise management</button>
      {view === 'settings'
        ? <ExerciseSettingsPanel section="identity" />
        : <ExerciseManagementPage />}
    </>
  )
}

describe('renaming the ACTIVE exercise', () => {
  it('Settings → rename → Settings shows the new name, and an unrelated save keeps it', async () => {
    const user = userEvent.setup()
    mockRename.mockImplementation(async (_exerciseId, name) => {
      server.name = name
      return serverRow()
    })
    renderWithProviders(<SettingsThenManagement />)

    // 1. The planner opens Settings: the block is cached (fresh for 60 s).
    await screen.findByTestId('exercise-settings-form')
    expect(screen.getByLabelText(/^exercise name/i)).toHaveValue('Coastal Surge')

    // 2. ...renames the active exercise in Exercise Management...
    await user.click(screen.getByRole('button', { name: 'Go to exercise management' }))
    await screen.findByTestId('org-exercise-table')
    await user.click(screen.getByRole('button', { name: 'Rename Coastal Surge' }))
    const dialog = await screen.findByTestId('rename-exercise-dialog')
    const input = within(dialog).getByTestId('rename-exercise-input')
    await user.clear(input)
    await user.type(input, 'Coastal Surge Two')
    await user.click(within(dialog).getByTestId('rename-exercise-confirm'))
    await waitFor(() => {
      expect(screen.queryByTestId('rename-exercise-dialog')).not.toBeInTheDocument()
    })

    // 3. ...and goes straight back, well inside the cache window.
    await user.click(screen.getByRole('button', { name: 'Go to settings' }))
    await screen.findByTestId('exercise-settings-form')
    expect(screen.getByLabelText(/^exercise name/i)).toHaveValue('Coastal Surge Two')

    // 4. Saving an UNRELATED field sends the full block, with the new name in it.
    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Metro Coast North')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    })
    expect(mockUpdateSettings.mock.calls[0]?.[0]).toMatchObject({
      name: 'Coastal Surge Two',
      worldName: 'Metro Coast North',
    })
  })
})
