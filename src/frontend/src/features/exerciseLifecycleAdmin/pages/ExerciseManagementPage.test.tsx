/**
 * features/exerciseLifecycleAdmin/pages/ExerciseManagementPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (COR-075) — the org exercise list surface: its four real states, its
 * table semantics, and the create → list round trip that ties story 01 to it.
 *
 * The SERVICE is mocked (keeping the real error class via `importOriginal`) so
 * each state can be driven deliberately and `@/core/services/api` is never
 * touched — no live axios sink, no worker-teardown footgun.
 *
 * The state that matters most is EMPTY. It is the FIRST-RUN case: an
 * organization that has never created an exercise lands here with nothing, and
 * before this surface existed there was no way for them to get anywhere at all.
 * The state that is most dangerous is ERROR — a failed read must never render as
 * an empty portfolio, because an org-admin would read that as "we own nothing".
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseManagementPage } from './ExerciseManagementPage'
import {
  OrgExerciseError,
  createOrgExercise,
  getOrgExercises,
} from '../services/orgExercisesService'
import type { OrgExercise } from '../types'

vi.mock('../services/orgExercisesService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/orgExercisesService')>()
  return { ...actual, getOrgExercises: vi.fn(), createOrgExercise: vi.fn() }
})

const mockList = vi.mocked(getOrgExercises)
const mockCreate = vi.mocked(createOrgExercise)

const PORTFOLIO: OrgExercise[] = [
  {
    exerciseId: 'ex-1',
    name: 'Coastal Surge',
    status: 'live',
    hostname: 'coastal-surge',
    createdAt: '2026-05-11T13:20:00.000Z',
  },
  {
    exerciseId: 'ex-2',
    name: 'Harbor Freeze Tabletop',
    status: 'build',
    hostname: 'harbor-freeze',
    createdAt: '2026-07-19T16:45:00.000Z',
  },
]

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

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ExerciseManagementPage — the four read states', () => {
  it('LOADING says so in words, not just a spinner', async () => {
    let release: (value: OrgExercise[]) => void = () => {}
    mockList.mockReturnValue(new Promise<OrgExercise[]>(resolve => { release = resolve }))
    renderPage()

    expect(screen.getByTestId('org-exercises-loading')).toHaveTextContent(/loading/i)

    release([])
    await waitFor(() => { expect(screen.getByTestId('org-exercises-empty')).toBeInTheDocument() })
  })

  it('EMPTY is the first-run state: it explains the list and points at the form', async () => {
    mockList.mockResolvedValue([])
    renderPage()

    const empty = await screen.findByTestId('org-exercises-empty')
    expect(empty).toHaveTextContent(/no exercises yet/i)
    expect(empty).toHaveTextContent(/create your first one using the form above/i)
    // The way OUT of the empty state has to be on the same screen.
    expect(screen.getByTestId('create-exercise-form')).toBeInTheDocument()
    expect(screen.queryByTestId('org-exercise-table')).not.toBeInTheDocument()
  })

  it('ERROR never renders as an empty portfolio', async () => {
    mockList.mockRejectedValue(new OrgExerciseError('boom', {
      status: 503,
      serverMessage: 'Upstream unavailable.',
    }))
    renderPage()

    const error = await screen.findByTestId('org-exercises-error')
    // The dangerous misreading, closed explicitly: a failed read must not look
    // like "your organization owns nothing".
    expect(screen.queryByTestId('org-exercises-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('org-exercise-table')).not.toBeInTheDocument()
    expect(error).toHaveTextContent(/could not be loaded/i)
    expect(error).toHaveTextContent('Upstream unavailable.')
    // Icon + words, never colour alone (NFR-001).
    expect(error.querySelector('svg')).not.toBeNull()
  })

  it('ERROR offers a retry that actually re-reads', async () => {
    const user = userEvent.setup()
    mockList
      .mockRejectedValueOnce(new OrgExerciseError('boom', { status: 503 }))
      .mockResolvedValueOnce(PORTFOLIO)
    renderPage()

    await screen.findByTestId('org-exercises-error')
    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.getByTestId('org-exercise-table')).toBeInTheDocument()
    })
  })

  it('POPULATED renders one row per exercise with all four AC2 fields', async () => {
    mockList.mockResolvedValue(PORTFOLIO)
    renderPage()

    const row = await screen.findByTestId('org-exercise-row-ex-2')
    expect(within(row).getByText('Harbor Freeze Tabletop')).toBeInTheDocument()
    expect(within(row).getByTestId('exercise-status-build')).toHaveTextContent('Build')
    expect(within(row).getByText('harbor-freeze')).toBeInTheDocument()
    // Asserted on the machine-readable `dateTime` (exact) plus a
    // timezone-insensitive read of the human text: the rendered DAY legitimately
    // shifts with the viewer's locale, and pinning it would make this suite fail
    // on a machine set to the wrong side of UTC rather than on a real bug.
    const created = within(row).getByText(/Jul 2026/)
    expect(created).toHaveAttribute('datetime', '2026-07-19T16:45:00.000Z')
  })
})

describe('ExerciseManagementPage — table semantics (NFR-001)', () => {
  it('is a real, labelled table with column headers', async () => {
    mockList.mockResolvedValue(PORTFOLIO)
    renderPage()

    const table = await screen.findByRole('table')
    expect(table).toHaveAccessibleName(/exercises owned by your organization/i)
    for (const header of ['Exercise', 'Status', 'Hostname', 'Created']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    // The name is the ROW header, so each cell is announced against it.
    expect(within(table).getByRole('rowheader', { name: /Coastal Surge/ })).toBeInTheDocument()
  })

  it('never conveys a lifecycle state by colour alone', async () => {
    mockList.mockResolvedValue(PORTFOLIO)
    renderPage()

    await screen.findByRole('table')
    for (const [testId, word] of [
      ['exercise-status-live', 'Live'],
      ['exercise-status-build', 'Build'],
    ] as const) {
      const badge = screen.getByTestId(testId)
      expect(badge).toHaveTextContent(word)
      expect(badge.querySelector('svg')).not.toBeNull()
    }
  })

  it('renders an unrecognised status as unrecognised — and keeps the other rows', async () => {
    mockList.mockResolvedValue([
      ...PORTFOLIO,
      { exerciseId: 'ex-3', name: 'Odd Run', status: 'quantum-superposition' },
    ])
    renderPage()

    await screen.findByRole('table')
    const odd = screen.getByTestId('exercise-status-unknown')
    expect(odd).toHaveTextContent('Unrecognised status')
    expect(odd).toHaveTextContent('quantum-superposition')
    // The whole portfolio is still readable — one odd literal does not blank it.
    expect(screen.getByTestId('org-exercise-row-ex-1')).toBeInTheDocument()
    expect(screen.getByTestId('org-exercise-row-ex-2')).toBeInTheDocument()
  })

  it('says a missing created date is Unknown rather than inventing one', async () => {
    mockList.mockResolvedValue([{ exerciseId: 'ex-9', name: 'Legacy Run', status: 'archived' }])
    renderPage()

    const row = await screen.findByTestId('org-exercise-row-ex-9')
    expect(within(row).getByText('Unknown')).toBeInTheDocument()
    expect(within(row).getByText('Not set')).toBeInTheDocument()
  })
})

describe('ExerciseManagementPage — create then list (stories 01 → 02)', () => {
  it('the new exercise appears in the list, in Build, after a create', async () => {
    const user = userEvent.setup()
    // First read: the portfolio before. Second read (after the invalidation the
    // creation mutation triggers): the same portfolio plus the new run. This is
    // the SERVER's answer both times — the page never assembles the row itself.
    mockList
      .mockResolvedValueOnce(PORTFOLIO)
      .mockResolvedValue([
        ...PORTFOLIO,
        {
          exerciseId: 'ex-3',
          name: 'Riverbend Flood TTX',
          status: 'build',
          hostname: 'riverbend-flood-ttx',
          createdAt: '2026-08-02T10:00:00.000Z',
        },
      ])
    mockCreate.mockResolvedValue({
      exercise: {
        exerciseId: 'ex-3',
        name: 'Riverbend Flood TTX',
        status: 'build',
        hostname: 'riverbend-flood-ttx',
        createdAt: '2026-08-02T10:00:00.000Z',
      },
      assignedRole: 'planner',
    })
    renderPage()

    await screen.findByTestId('org-exercise-row-ex-2')
    expect(screen.queryByTestId('org-exercise-row-ex-3')).not.toBeInTheDocument()

    await user.type(screen.getByTestId('create-exercise-name'), 'Riverbend Flood TTX')
    await user.click(screen.getByTestId('create-exercise-submit'))

    const created = await screen.findByTestId('org-exercise-row-ex-3')
    expect(within(created).getByText('Riverbend Flood TTX')).toBeInTheDocument()
    expect(within(created).getByTestId('exercise-status-build')).toHaveTextContent('Build')
  })

  it('a rejected create leaves the list exactly as it was', async () => {
    const user = userEvent.setup()
    mockList.mockResolvedValue(PORTFOLIO)
    mockCreate.mockRejectedValue(new OrgExerciseError('conflict', { status: 409 }))
    renderPage()

    await screen.findByRole('table')

    await user.type(screen.getByTestId('create-exercise-name'), 'Clashing')
    await user.type(screen.getByTestId('create-exercise-hostname'), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-hostname'))
        .toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getAllByRole('row')).toHaveLength(PORTFOLIO.length + 1) // + the header row
  })
})

describe('ExerciseManagementPage — the surface itself', () => {
  it('owns the page heading and declares NO second main landmark', async () => {
    mockList.mockResolvedValue(PORTFOLIO)
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: /exercise management/i }))
      .toBeInTheDocument()
    // The staff shell's work area is the page's ONE `<main>` (#382); work-area
    // content owns no landmark of its own.
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('never names the ORGANIZATION as an identifier a caller could supply (XC-002)', async () => {
    mockList.mockResolvedValue(PORTFOLIO)
    renderPage()

    await screen.findByRole('table')
    // "your organization" as prose is fine and correct; an org ID rendered on a
    // staff surface would mean the tenant reached the wire, which the backend
    // asserts it never does.
    expect(screen.queryByText(/organizationId/i)).not.toBeInTheDocument()
  })
})
