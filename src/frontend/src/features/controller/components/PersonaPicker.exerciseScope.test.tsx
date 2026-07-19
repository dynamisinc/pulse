/**
 * features/controller/components/PersonaPicker.exerciseScope.test.tsx
 * ---------------------------------------------------------------------------
 * QA addendum to PersonaPicker.test.tsx (story 02, "Fast persona switching").
 *
 * The story's own AC (COR-001/XC-001 — exercise isolation) is: "The picker
 * lists only personas in the controller's active exercise ... read via
 * usePersonas() ... never SEEDED_PERSONAS/personaById". PersonaPicker.test.tsx
 * always supplies its own `personas` prop, which proves the picker CAN be
 * scoped externally but never exercises the component's own DEFAULT data
 * source. This file mocks `@/features/personas`'s `usePersonas()` and renders
 * `<PersonaPicker />` with no `personas` prop, to prove the default path is
 * actually wired to the exercise-scoped hook — not a fixture/seed import that
 * would fail open across an exercise boundary on a shipped path.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import type { Persona, UsePersonasResult } from '@/features/personas'

/** A persona that exists ONLY in this mocked usePersonas() result — never in
 * any mock-fixture/seed export — so its presence proves the component read
 * the hook rather than falling back to a fixture. */
const EXERCISE_SCOPED_ONLY_PERSONA: Persona = {
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

const usePersonasMock = vi.fn<() => UsePersonasResult>(() => ({
  personas: [EXERCISE_SCOPED_ONLY_PERSONA],
  loading: false,
  error: undefined,
}))

vi.mock('@/features/personas', () => ({
  usePersonas: () => usePersonasMock(),
}))

describe('PersonaPicker — default data source is usePersonas() (COR-001)', () => {
  it('with no personas prop, renders exactly what usePersonas() resolves', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <ActivePersonaProvider>
          <PersonaPicker />
        </ActivePersonaProvider>
      </ThemeProvider>,
    )

    expect(usePersonasMock).toHaveBeenCalled()
    expect(
      screen.getByTestId('persona-picker-option-persona-exercise-scoped-only'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]'),
    ).toHaveLength(1)
  })
})
