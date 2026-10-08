/**
 * features/controller/runSheet/runSheetTestKit.tsx
 * ---------------------------------------------------------------------------
 * Shared TEST helpers for the run-sheet suites (demo-polish C3). Not a test file and
 * never imported by app code. Exports functions only (no components), so the
 * react-refresh lint rule is satisfied.
 */
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetRunSheetStoreForTests } from './runSheetStore'
import { writeStoredSheet } from './runSheetStorage'
import { emptySheet, type RunSheetData } from './runSheetModel'
import type { RunSheetBeat } from './runSheetSchema'
import type { Persona } from '@/features/personas'

/** The exercise the real (mock-mode) `ExerciseContextProvider` resolves to. */
export const MOCK_EXERCISE_ID = 'ex-mock-0001'
/** The controller the mock identity returns for that exercise. */
export const MOCK_ACTING_HUMAN_ID = 'human-controller-01'
/** The instant the fixed test clock reports. */
export const FIXED_SCENARIO_NOW = '2033-09-04T14:00:00.000Z'

/** A valid beat, overridable. Posts as `FulcoEM` (a persona in the mock cast). */
export function beatFixture(overrides: Partial<RunSheetBeat> = {}): RunSheetBeat {
  return {
    id: 'b1',
    order: 1,
    title: 'Boil notice',
    scenarioMinute: 14,
    persona: { handle: 'FulcoEM' },
    text: 'Boil-water advisory is in effect for Zones 2-4.',
    ...overrides,
  }
}

/** Sheet data with the given beats (and optional status records). */
export function sheetFixture(
  beats: readonly RunSheetBeat[],
  runtime: RunSheetData['runtime'] = {},
  name = 'Water crisis',
): RunSheetData {
  return { ...emptySheet(name), beats, runtime }
}

/** Writes a sheet straight into `localStorage` (what a previous page session would have left). */
export function seedStoredSheet(exerciseId: string, data: RunSheetData): void {
  const written = writeStoredSheet(exerciseId, data)
  if (!written.ok) throw new Error('could not seed the stored sheet')
  resetRunSheetStoreForTests()
}

/** Clears storage, the store cache and the test clock. Call in `beforeEach` / `afterEach`. */
export function resetRunSheetWorld(): void {
  window.localStorage.clear()
  resetRunSheetStoreForTests()
  resetExerciseClock()
}

/** Installs a clock fixed at `iso`. */
export function useFixedClock(iso = FIXED_SCENARIO_NOW): void {
  setExerciseClock({ scenarioNow: () => new Date(iso) })
}

/** Renders `ui` inside the staff providers: COBRA theme, React Query, the real exercise context. */
export function renderStaff(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{ui}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

/** A participant-projection persona fixture (what `usePersonas()` returns). */
export function personaFixture(handle: string, overrides: Partial<Persona> = {}): Persona {
  return {
    id: `persona-${handle.toLowerCase()}`,
    exerciseId: MOCK_EXERCISE_ID,
    templateId: `tmpl-${handle.toLowerCase()}`,
    displayName: `${handle} Display`,
    handle,
    kind: 'org',
    verified: true,
    avatarColor: '#1d4ed8',
    initials: handle.slice(0, 2).toUpperCase(),
    audienceBand: 'mid',
    followerCount: 1000,
    joinedAt: '2030-01-01T00:00:00Z',
    ...overrides,
  }
}
