/**
 * features/controller/components/PersonaPicker.staffContract.test.tsx
 * ---------------------------------------------------------------------------
 * The picker's half of the persona WORLD SPLIT (SOC-052 / D1-008;
 * profiles-social-graph backend story 06). `GET /personas` returns
 * `personaType` only to a live staff-kind session; the participant projection
 * structurally omits it. `PersonaPicker` filters and labels on that field, so
 * it reads the STAFF seam (`useStaffPersonas`) — and this file pins the two
 * behaviours that split creates:
 *
 *   1. STAFF STILL GETS THE ARCHETYPE. With staff-shaped personas the type
 *      filter chips actually partition the list and each row shows its
 *      archetype — i.e. `personaType` survives the split for staff.
 *
 *   2. A FAILED STAFF READ IS VISIBLE, NOT SILENT. This is the specific risk
 *      the split was built to kill: a staff path hitting the endpoint without
 *      a staff session used to yield `personaType: undefined`, which would
 *      show EVERY persona under an unfiltered "all" and render an unlabeled
 *      category chip downstream. `resolveStaffPersonas` now rejects such a
 *      body, and the picker must render an explicit error row (icon + text,
 *      never color-alone — NFR-001) rather than the "No personas match this
 *      search" empty state, which would misattribute the failure to the query.
 *
 * Staff world (COBRA): rendered under `cobraTheme`, exactly like the sibling
 * picker tests.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import type { StaffPersona, UseStaffPersonasResult } from '@/features/personas'

const useStaffPersonasMock = vi.fn<() => UseStaffPersonasResult>()

vi.mock('@/features/personas', () => ({
  useStaffPersonas: () => useStaffPersonasMock(),
}))

function buildStaffPersona(
  overrides: Pick<StaffPersona, 'id' | 'displayName' | 'handle' | 'personaType'>,
): StaffPersona {
  return {
    exerciseId: 'ex-mock-0001',
    templateId: `tmpl-${overrides.id}`,
    kind: 'human',
    verified: false,
    avatarColor: '#334455',
    initials: 'XX',
    audienceBand: 'micro',
    followerCount: 120,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const AGENCY = buildStaffPersona({
  id: 'persona-agency',
  displayName: 'County EM',
  handle: 'countyem',
  personaType: 'agency',
})
const BAD_ACTOR = buildStaffPersona({
  id: 'persona-bad-actor',
  displayName: 'County EM Updates',
  handle: 'countyemupd',
  personaType: 'bad-actor',
})

function renderPicker() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>
        <PersonaPicker autoFocus={false} />
      </ActivePersonaProvider>
    </ThemeProvider>,
  )
}

describe('PersonaPicker — staff personas keep their archetype', () => {
  it('filters by personaType and labels each row with it', async () => {
    useStaffPersonasMock.mockReturnValue({
      personas: [AGENCY, BAD_ACTOR],
      loading: false,
      error: undefined,
    })
    const user = userEvent.setup()
    renderPicker()

    // Both archetypes render as row text (never color-only, NFR-001).
    expect(screen.getByTestId('persona-picker-option-persona-agency')).toHaveTextContent('agency')
    expect(screen.getByTestId('persona-picker-option-persona-bad-actor'))
      .toHaveTextContent('bad-actor')

    // The type filter actually partitions on `personaType` — the behaviour
    // that silently breaks if the archetype ever arrives `undefined`.
    await user.click(screen.getByTestId('persona-picker-type-filter-agency'))

    expect(screen.getByTestId('persona-picker-option-persona-agency')).toBeInTheDocument()
    expect(screen.queryByTestId('persona-picker-option-persona-bad-actor')).toBeNull()
  })
})

describe('PersonaPicker — a failed staff read fails closed AND visibly', () => {
  it('renders an explicit error row, no selectable options, and no empty-search text', () => {
    useStaffPersonasMock.mockReturnValue({
      personas: [],
      loading: false,
      error: new Error(
        'resolveStaffPersonas: resolution returned a malformed or participant-shaped ' +
        'persona set (no personaType).',
      ),
    })
    renderPicker()

    const errorRow = screen.getByTestId('persona-picker-error')
    expect(errorRow).toBeInTheDocument()
    // Announced, and text-carried rather than color-carried (NFR-001).
    expect(errorRow).toHaveAttribute('role', 'alert')
    expect(errorRow.textContent).toMatch(/persona list unavailable/i)

    // Fail-CLOSED: nothing is selectable.
    expect(
      screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]'),
    ).toHaveLength(0)

    // …and the failure is never disguised as "your search matched nothing".
    expect(screen.queryByTestId('persona-picker-empty')).toBeNull()
  })
})
