/**
 * features/controller/components/PersonaPicker.exerciseSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * The picker across an in-place exercise switch (demo-feedback 24, #542; #450
 * F-1; COR-001).
 *
 * The console does not remount on a switch, so the picker stays mounted while
 * the active exercise changes under it. Asserted:
 *
 *  - with its DEFAULT data source (`useStaffPersonas()`, keyed by exercise) the
 *    picker shows B's list after a switch, and no persona of A is ever on
 *    screen once B is active;
 *  - a persona selected in A is no longer shown as selected (no ACTIVE badge)
 *    under B, and the keyboard highlight is on B's first row;
 *  - the selection check is by persona AND exercise: a same-id persona served
 *    for another exercise (the mock cast is identical in every exercise) is not
 *    badged as the selection either.
 *
 * `useExerciseContext` is mocked with a mutable scope; `api.get` answers with
 * the cast of whichever exercise is active when the read is issued.
 */
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import type { StaffPersona } from '@/features/personas'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import { PersonaPicker } from './PersonaPicker'

const scope = vi.hoisted(() => ({ exerciseId: 'ex-a' }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: scope.exerciseId,
    exerciseName: 'Ex',
    timeZone: 'UTC',
    status: 'live',
  }),
}))

function staffPersona(id: string, exerciseId: string, displayName: string): StaffPersona {
  return {
    id,
    exerciseId,
    templateId: `tmpl-${id}`,
    displayName,
    handle: id.replace(/[^a-z0-9]/gi, ''),
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#334455',
    initials: 'PP',
    audienceBand: 'micro',
    followerCount: 1,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

const CASTS: Record<string, StaffPersona[]> = {
  'ex-a': [staffPersona('a-1', 'ex-a', 'Alpha One'), staffPersona('a-2', 'ex-a', 'Alpha Two')],
  'ex-b': [staffPersona('b-1', 'ex-b', 'Bravo One'), staffPersona('b-2', 'ex-b', 'Bravo Two')],
}

type GetResult = Awaited<ReturnType<typeof api.get>>

beforeEach(() => {
  scope.exerciseId = 'ex-a'
  vi.spyOn(api, 'get').mockImplementation(() =>
    Promise.resolve({ data: CASTS[scope.exerciseId] ?? [] } as GetResult),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Frame({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>{children}</ActivePersonaProvider>
    </ThemeProvider>
  )
}

function optionIds(): string[] {
  return within(screen.getByTestId('persona-picker-list'))
    .queryAllByRole('option')
    .map(option => option.id.replace('persona-picker-option-', ''))
}

describe('PersonaPicker — exercise switch (default data source)', () => {
  it('shows B\'s list after a switch and clears the selection made in A', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Frame><PersonaPicker autoFocus={false} /></Frame>)

    await screen.findByTestId('persona-picker-option-a-1')
    await user.click(screen.getByTestId('persona-picker-option-a-2'))
    expect(screen.getByTestId('persona-picker-active-badge-a-2')).toBeInTheDocument()

    scope.exerciseId = 'ex-b'
    rerender(<Frame><PersonaPicker autoFocus={false} /></Frame>)

    // Not one of A's personas is on screen from the switch onwards.
    expect(optionIds().filter(id => id.startsWith('a-'))).toEqual([])

    await screen.findByTestId('persona-picker-option-b-1')
    expect(optionIds()).toEqual(['b-1', 'b-2'])
    // The selection made in A is gone from view: no ACTIVE badge anywhere.
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument()
    // The keyboard highlight is on B's first row.
    expect(screen.getByTestId('persona-picker-search')).toHaveAttribute(
      'aria-activedescendant',
      'persona-picker-option-b-1',
    )
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('Enter after a switch selects B\'s first persona, not a row carried over from A', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { rerender } = render(<Frame><PersonaPicker onSelect={onSelect} /></Frame>)
    await screen.findByTestId('persona-picker-option-a-1')
    await user.keyboard('{ArrowDown}')

    scope.exerciseId = 'ex-b'
    rerender(<Frame><PersonaPicker onSelect={onSelect} /></Frame>)
    await screen.findByTestId('persona-picker-option-b-1')

    await act(async () => {
      await user.type(screen.getByTestId('persona-picker-search'), '{Enter}')
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'b-1', exerciseId: 'ex-b' })
  })
})

describe('PersonaPicker — the selection belongs to one exercise', () => {
  it('does not badge a same-id persona served for another exercise', async () => {
    const user = userEvent.setup()
    const inA = [staffPersona('shared-1', 'ex-a', 'Shared One')]
    const inB = [staffPersona('shared-1', 'ex-b', 'Shared One')]
    const { rerender } = render(<Frame><PersonaPicker personas={inA} autoFocus={false} /></Frame>)

    await user.click(screen.getByTestId('persona-picker-option-shared-1'))
    expect(screen.getByTestId('persona-picker-active-badge-shared-1')).toBeInTheDocument()

    rerender(<Frame><PersonaPicker personas={inB} autoFocus={false} /></Frame>)
    await waitFor(() =>
      expect(screen.queryByTestId('persona-picker-active-badge-shared-1')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('persona-picker-option-shared-1')).toBeInTheDocument()
  })
})
