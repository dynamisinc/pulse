/**
 * features/exerciseLifecycleAdmin/components/CreateExerciseForm.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (COR-074) — the creation form, with the SERVICE mocked (keeping the
 * real `OrgExerciseError` / `isHostnameTakenError` via `importOriginal`) so each
 * outcome can be driven deliberately and `@/core/services/api` is never touched.
 *
 * The centrepiece is the 409: hostname uniqueness is global and enforced by the
 * database, so "that host is taken" is a NORMAL outcome of a well-formed
 * submission that arrives after the user has typed everything. These cases pin
 * that it lands as a recoverable FIELD error with the input intact — not as a
 * toast, and above all not as a cleared form.
 *
 * Rendered inside the COBRA `ThemeProvider` + a React Query client, exactly as
 * the page mounts it. STAFF surface, so COBRA is correct here.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { CreateExerciseForm } from './CreateExerciseForm'
import { OrgExerciseError, createOrgExercise } from '../services/orgExercisesService'
import type { CreateExerciseResult } from '../types'

vi.mock('../services/orgExercisesService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/orgExercisesService')>()
  return { ...actual, createOrgExercise: vi.fn(), getOrgExercises: vi.fn() }
})

const mockCreate = vi.mocked(createOrgExercise)

const CREATED: CreateExerciseResult = {
  exercise: {
    exerciseId: 'ex-new-0001',
    name: 'Riverbend Flood TTX',
    status: 'build',
    hostname: 'riverbend-flood-ttx',
    createdAt: '2026-08-02T10:00:00.000Z',
  },
  assignedRole: 'planner',
}

function renderForm() {
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
  return render(<CreateExerciseForm />, { wrapper: Wrapper })
}

function nameField(): HTMLInputElement {
  return screen.getByTestId('create-exercise-name')
}

function hostnameField(): HTMLInputElement {
  return screen.getByTestId('create-exercise-hostname')
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('CreateExerciseForm — the happy path (COR-074 AC1/AC3)', () => {
  it('submits the typed name and reports the exercise the SERVER created', async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.click(screen.getByTestId('create-exercise-submit'))

    // Asserted on the FIRST argument only: React Query 5 passes the mutation
    // context (client / meta / mutationKey) as a second argument to the
    // mutation function, which `toHaveBeenCalledWith` would demand a matcher
    // for and which has nothing to do with this contract.
    await waitFor(() => { expect(mockCreate).toHaveBeenCalled() })
    expect(mockCreate.mock.calls[0]?.[0]).toEqual({
      name: 'Riverbend Flood TTX',
      hostname: '',
    })

    // NOTE: the success region is ALWAYS in the DOM (empty until there is
    // something to announce), so `findByTestId` would resolve instantly against
    // an empty node. Wait on the CONTENT, not on the element's existence.
    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-success'))
        .toHaveTextContent('Riverbend Flood TTX')
    })
    const success = screen.getByTestId('create-exercise-success')
    expect(success).toHaveTextContent('riverbend-flood-ttx')
    expect(success).toHaveTextContent('planner')
  })

  it('reports the status the server returned, and it is Build — icon + word, not colour', async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.click(screen.getByTestId('create-exercise-submit'))

    const badge = await screen.findByTestId('exercise-status-build')
    // NFR-001: the WORD carries the state. A test that only checked a colour
    // token would pass on a colour-only badge, which is exactly what is banned.
    expect(badge).toHaveTextContent('Build')
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('clears the fields after a SUCCESS (and only after a success)', async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.type(hostnameField(), 'riverbend-flood-ttx')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-success')).not.toBeEmptyDOMElement()
    })
    expect(nameField().value).toBe('')
    expect(hostnameField().value).toBe('')
  })

  it('announces the result in a live region, not a transient toast', async () => {
    const user = userEvent.setup()
    mockCreate.mockResolvedValue(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Riverbend Flood TTX')
    })
  })
})

describe('CreateExerciseForm — 409 hostname taken is RECOVERABLE (the whole point)', () => {
  const conflict = new OrgExerciseError('Request failed with status code 409', {
    status: 409,
    serverMessage: 'Hostname already in use.',
  })

  it('renders a field error on the hostname and PRESERVES everything typed', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(conflict)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.type(hostnameField(), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(hostnameField()).toHaveAttribute('aria-invalid', 'true')
    })

    // THE assertion. A toast-and-reset implementation loses both of these.
    expect(nameField().value).toBe('Riverbend Flood TTX')
    expect(hostnameField().value).toBe('coastal-surge')
  })

  it('attaches the explanation to the hostname field, so a screen reader reads it', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(conflict)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.type(hostnameField(), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(hostnameField()).toHaveAttribute('aria-invalid', 'true')
    })

    const describedBy = hostnameField().getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    const description = describedBy === null ? null : document.getElementById(describedBy)
    expect(description?.textContent).toContain('already uses this hostname')
    // Never colour-only (NFR-001): the message carries an icon AND words.
    expect(description?.querySelector('svg')).not.toBeNull()
  })

  it('moves focus to the field that has to change', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(conflict)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.type(hostnameField(), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(hostnameField()).toHaveFocus()
    })
  })

  it('is immediately re-submittable: clearing the hostname succeeds', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValueOnce(conflict).mockResolvedValueOnce(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend Flood TTX')
    await user.type(hostnameField(), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))
    await waitFor(() => { expect(hostnameField()).toHaveAttribute('aria-invalid', 'true') })

    await user.clear(hostnameField())
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-success')).not.toBeEmptyDOMElement()
    })
    expect(mockCreate.mock.calls.at(-1)?.[0]).toEqual({
      name: 'Riverbend Flood TTX',
      hostname: '',
    })
  })

  it('shows NO success notice while the conflict is unresolved', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(conflict)
    renderForm()

    await user.type(nameField(), 'X')
    await user.type(hostnameField(), 'coastal-surge')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => { expect(hostnameField()).toHaveAttribute('aria-invalid', 'true') })
    expect(screen.getByTestId('create-exercise-success')).toBeEmptyDOMElement()
  })
})

describe('CreateExerciseForm — the other failures', () => {
  it('refuses an empty name client-side without costing a round trip', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => { expect(nameField()).toHaveAttribute('aria-invalid', 'true') })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(nameField()).toHaveFocus()
  })

  it('puts a server 400 on the NAME field with the server’s own reason', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(new OrgExerciseError('bad request', {
      status: 400,
      serverMessage: 'name must be 200 characters or fewer.',
    }))
    renderForm()

    await user.type(nameField(), 'Riverbend')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => { expect(nameField()).toHaveAttribute('aria-invalid', 'true') })
    expect(screen.getByText(/200 characters or fewer/)).toBeInTheDocument()
    // Still recoverable: nothing typed is thrown away.
    expect(nameField().value).toBe('Riverbend')
  })

  it('puts a 403 in the FORM-level alert, because no field edit can fix it', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue(new OrgExerciseError('forbidden', { status: 403 }))
    renderForm()

    await user.type(nameField(), 'Riverbend')
    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-error'))
        .toHaveTextContent(/planner or an organization administrator/)
    })
    expect(nameField()).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('does not leave a stale error on screen after a later success', async () => {
    const user = userEvent.setup()
    mockCreate
      .mockRejectedValueOnce(new OrgExerciseError('forbidden', { status: 403 }))
      .mockResolvedValueOnce(CREATED)
    renderForm()

    await user.type(nameField(), 'Riverbend')
    await user.click(screen.getByTestId('create-exercise-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-error')).not.toBeEmptyDOMElement()
    })

    await user.click(screen.getByTestId('create-exercise-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-success')).not.toBeEmptyDOMElement()
    })
    expect(screen.getByTestId('create-exercise-error')).toBeEmptyDOMElement()
  })
})
