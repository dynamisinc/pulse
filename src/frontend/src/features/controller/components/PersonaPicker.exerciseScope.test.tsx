/**
 * features/controller/components/PersonaPicker.exerciseScope.test.tsx
 * ---------------------------------------------------------------------------
 * QA addendum to PersonaPicker.test.tsx (story 02, "Fast persona switching").
 *
 * The story's own AC (COR-001/XC-001 — exercise isolation) is: "The picker
 * lists only personas in the controller's active exercise ... read via the
 * exercise-scoped hook ... never SEEDED_PERSONAS/personaById".
 * PersonaPicker.test.tsx always supplies its own `personas` prop, which proves
 * the picker CAN be scoped externally but never exercises the component's own
 * DEFAULT data source. This file mocks `@/features/personas`'s
 * `useStaffPersonas()` and renders `<PersonaPicker />` with no `personas`
 * prop, to prove the default path is actually wired to the exercise-scoped
 * hook — not a fixture/seed import that would fail open across an exercise
 * boundary on a shipped path.
 *
 * The default is the STAFF read (`useStaffPersonas`), not the participant
 * `usePersonas`: the picker filters on `personaType`, which exists only on the
 * staff projection (SOC-052/D1-008, profiles-social-graph backend story 06).
 * Asserting on the staff hook here is what keeps that wiring from silently
 * regressing back to the participant read.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import type { StaffPersona, UseStaffPersonasResult } from '@/features/personas'

/** A persona that exists ONLY in this mocked useStaffPersonas() result —
 * never in any mock-fixture/seed export — so its presence proves the component
 * read the hook rather than falling back to a fixture. */
const EXERCISE_SCOPED_ONLY_PERSONA: StaffPersona = {
  id: 'persona-exercise-scoped-only',
  exerciseId: 'ex-under-test',
  templateId: 'tmpl-exercise-scoped-only',
  displayName: 'Exercise-Scoped Only',
  handle: 'exeronly',
  kind: 'human',
  personaType: 'citizen',
  verified: false,
  avatarColor: '#112233',
  initials: 'EO',
  audienceBand: 'micro',
  followerCount: 42,
  joinedAt: '2026-01-01T00:00:00.000Z',
}

const useStaffPersonasMock = vi.fn<() => UseStaffPersonasResult>(() => ({
  personas: [EXERCISE_SCOPED_ONLY_PERSONA],
  loading: false,
  error: undefined,
}))

vi.mock('@/features/personas', () => ({
  useStaffPersonas: () => useStaffPersonasMock(),
}))

describe('PersonaPicker — default data source is useStaffPersonas() (COR-001)', () => {
  it('with no personas prop, renders exactly what useStaffPersonas() resolves', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <ActivePersonaProvider>
          <PersonaPicker />
        </ActivePersonaProvider>
      </ThemeProvider>,
    )

    expect(useStaffPersonasMock).toHaveBeenCalled()
    expect(
      screen.getByTestId('persona-picker-option-persona-exercise-scoped-only'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]'),
    ).toHaveLength(1)
  })
})
