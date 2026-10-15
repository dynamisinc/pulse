/**
 * features/exerciseLifecycleAdmin/components/ExerciseRowActions.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback story 22 (DF-35): the org exercise table's row actions, driven
 * through the real `ExerciseManagementPage` with the SERVICE mocked (the real
 * error class kept via `importOriginal`), so each state can be dictated.
 *
 * Covered: Rename on every row and its COBRA dialog (submit, server 400 kept in
 * the dialog, the table re-reads on success); Archive only on a completed row,
 * behind a confirm, and on every other live state disabled with the VISIBLE
 * text "End the exercise first"; an archived row reads "Archived" in words,
 * has no Archive button and sorts last. The evaluator case (no actions at all)
 * lives with the route gate in `orgAdminSurfaceFamily.test.tsx`.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseManagementPage } from '../pages/ExerciseManagementPage'
import {
  OrgExerciseError,
  archiveOrgExercise,
  getOrgExercises,
  renameOrgExercise,
} from '../services/orgExercisesService'
import type { OrgExercise } from '../types'
import { sortArchivedLast } from './exerciseRowStatus'

vi.mock('../services/orgExercisesService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/orgExercisesService')>()
  return {
    ...actual,
    getOrgExercises: vi.fn(),
    createOrgExercise: vi.fn(),
    renameOrgExercise: vi.fn(),
    archiveOrgExercise: vi.fn(),
  }
})

const mockList = vi.mocked(getOrgExercises)
const mockRename = vi.mocked(renameOrgExercise)
const mockArchive = vi.mocked(archiveOrgExercise)

const ARCHIVED: OrgExercise = { exerciseId: 'ex-a', name: 'Alpha Old Run', status: 'archived' }
const COMPLETED: OrgExercise = { exerciseId: 'ex-c', name: 'Coastal Surge', status: 'completed' }
const LIVE: OrgExercise = { exerciseId: 'ex-l', name: 'Harbor Live', status: 'live' }
const BUILD: OrgExercise = { exerciseId: 'ex-b', name: 'Zulu Build', status: 'build' }

/** Server order (by name): the archived row first, so "sorted last" is the client's doing. */
const PORTFOLIO: OrgExercise[] = [ARCHIVED, COMPLETED, LIVE, BUILD]

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExerciseManagementPage />, { wrapper: Wrapper })
}

function actionsOf(exerciseId: string): HTMLElement {
  return screen.getByTestId(`org-exercise-actions-${exerciseId}`)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockList.mockResolvedValue(PORTFOLIO)
})

describe('row actions per state', () => {
  it('every row offers Rename; the table has an Actions column', async () => {
    renderPage()
    const table = await screen.findByTestId('org-exercise-table')

    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
    for (const exercise of PORTFOLIO) {
      expect(within(actionsOf(exercise.exerciseId)).getByRole('button', { name: `Rename ${exercise.name}` }))
        .toBeEnabled()
    }
  })

  it('Archive is enabled only on a completed row', async () => {
    renderPage()
    await screen.findByTestId('org-exercise-table')

    expect(within(actionsOf(COMPLETED.exerciseId)).getByRole('button', { name: `Archive ${COMPLETED.name}` }))
      .toBeEnabled()
    expect(screen.queryByTestId(`org-exercise-archive-reason-${COMPLETED.exerciseId}`)).not.toBeInTheDocument()
  })

  it('other states show Archive disabled WITH the visible text "End the exercise first"', async () => {
    renderPage()
    await screen.findByTestId('org-exercise-table')

    for (const exercise of [LIVE, BUILD]) {
      const button = within(actionsOf(exercise.exerciseId)).getByRole('button', { name: `Archive ${exercise.name}` })
      expect(button).toBeDisabled()
      // Visible text, not a tooltip, and tied to the button for a screen reader.
      const reason = screen.getByTestId(`org-exercise-archive-reason-${exercise.exerciseId}`)
      expect(reason).toHaveTextContent('End the exercise first')
      expect(reason).toBeVisible()
      expect(button).toHaveAttribute('aria-describedby', reason.id)
    }
  })

  it('an archived row reads "Archived" in words, has no Archive action, and sorts last', async () => {
    renderPage()
    const table = await screen.findByTestId('org-exercise-table')

    const archivedRow = screen.getByTestId(`org-exercise-row-${ARCHIVED.exerciseId}`)
    expect(within(archivedRow).getByText('Archived')).toBeInTheDocument()
    expect(within(actionsOf(ARCHIVED.exerciseId)).queryByRole('button', { name: /Archive/ }))
      .not.toBeInTheDocument()

    const bodyRows = within(table).getAllByRole('row').slice(1)
    expect(bodyRows.at(-1)).toBe(archivedRow)
    expect(bodyRows.map(row => row.getAttribute('data-testid'))).toEqual([
      `org-exercise-row-${COMPLETED.exerciseId}`,
      `org-exercise-row-${LIVE.exerciseId}`,
      `org-exercise-row-${BUILD.exerciseId}`,
      `org-exercise-row-${ARCHIVED.exerciseId}`,
    ])
  })

  it('sortArchivedLast is a stable partition', () => {
    const second: OrgExercise = { exerciseId: 'ex-a2', name: 'Beta Old', status: 'archived' }
    expect(sortArchivedLast([ARCHIVED, LIVE, second, BUILD]).map(e => e.exerciseId))
      .toEqual(['ex-l', 'ex-b', 'ex-a', 'ex-a2'])
  })
})

describe('the Rename dialog', () => {
  it('opens on the current name, submits the trimmed new one, closes, and the table re-reads', async () => {
    const user = userEvent.setup()
    mockRename.mockResolvedValue({ ...LIVE, name: 'Harbor Live Two' })
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Rename ${LIVE.name}` }))
    const dialog = await screen.findByTestId('rename-exercise-dialog')
    const input = within(dialog).getByTestId('rename-exercise-input')
    expect(input).toHaveValue(LIVE.name)
    expect(within(dialog).getByTestId('rename-exercise-confirm')).toBeDisabled()

    mockList.mockResolvedValue([ARCHIVED, COMPLETED, { ...LIVE, name: 'Harbor Live Two' }, BUILD])
    await user.clear(input)
    await user.type(input, '  Harbor Live Two ')
    await user.click(within(dialog).getByTestId('rename-exercise-confirm'))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-exercise-dialog')).not.toBeInTheDocument()
    })
    expect(mockRename).toHaveBeenCalledWith(LIVE.exerciseId, 'Harbor Live Two')
    expect(await screen.findByText('Harbor Live Two')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('keeps a server 400 inside the dialog as text, with the typed value kept', async () => {
    const user = userEvent.setup()
    mockRename.mockRejectedValue(new OrgExerciseError('Bad Request', {
      status: 400,
      serverMessage: 'name must be at most 200 characters.',
    }))
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Rename ${BUILD.name}` }))
    const dialog = await screen.findByTestId('rename-exercise-dialog')
    const input = within(dialog).getByTestId('rename-exercise-input')
    await user.clear(input)
    await user.type(input, 'Too long, says the server')
    await user.click(within(dialog).getByTestId('rename-exercise-confirm'))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('The exercise was not renamed.')
    expect(alert).toHaveTextContent('name must be at most 200 characters.')
    expect(input).toHaveValue('Too long, says the server')
  })

  it('Cancel closes without a request', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Rename ${BUILD.name}` }))
    const dialog = await screen.findByTestId('rename-exercise-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-exercise-dialog')).not.toBeInTheDocument()
    })
    expect(mockRename).not.toHaveBeenCalled()
  })
})

describe('the Archive confirm', () => {
  it('names the exercise, archives on confirm, and the table re-reads', async () => {
    const user = userEvent.setup()
    mockArchive.mockResolvedValue({ ...COMPLETED, status: 'archived' })
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Archive ${COMPLETED.name}` }))
    const dialog = await screen.findByTestId('archive-exercise-dialog')
    expect(within(dialog).getByTestId('archive-exercise-name')).toHaveTextContent(COMPLETED.name)
    expect(within(dialog).getByText(/cannot be reopened/)).toBeInTheDocument()

    mockList.mockResolvedValue([ARCHIVED, { ...COMPLETED, status: 'archived' }, LIVE, BUILD])
    await user.click(within(dialog).getByTestId('archive-exercise-confirm'))

    await waitFor(() => {
      expect(screen.queryByTestId('archive-exercise-dialog')).not.toBeInTheDocument()
    })
    expect(mockArchive).toHaveBeenCalledWith(COMPLETED.exerciseId)
    await waitFor(() => {
      expect(within(screen.getByTestId(`org-exercise-row-${COMPLETED.exerciseId}`)).getByText('Archived'))
        .toBeInTheDocument()
    })
  })

  it('Cancel archives nothing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Archive ${COMPLETED.name}` }))
    const dialog = await screen.findByTestId('archive-exercise-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByTestId('archive-exercise-dialog')).not.toBeInTheDocument()
    })
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('a 409 not-completed keeps the dialog open and says why in words', async () => {
    const user = userEvent.setup()
    mockArchive.mockRejectedValue(new OrgExerciseError('Conflict', { status: 409, reason: 'not-completed' }))
    renderPage()
    await screen.findByTestId('org-exercise-table')

    await user.click(screen.getByRole('button', { name: `Archive ${COMPLETED.name}` }))
    const dialog = await screen.findByTestId('archive-exercise-dialog')
    await user.click(within(dialog).getByTestId('archive-exercise-confirm'))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('The exercise was not archived.')
    expect(alert).toHaveTextContent('End the exercise first.')
  })
})
