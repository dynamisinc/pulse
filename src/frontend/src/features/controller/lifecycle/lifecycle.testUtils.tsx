/**
 * features/controller/lifecycle/lifecycle.testUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY render harness for the StartEx / EndEx control (demo-polish C6). Never imported by
 * app code. It mounts the REAL providers the console supplies -- the COBRA theme (the Cobra
 * buttons read `theme.palette.buttonPrimary`), a fresh React Query client, the real
 * `ExerciseContextProvider` -- plus the real `StaffHeader`, so a test can watch the header's
 * state pill move when the control changes the exercise's state, and a `MemoryRouter` (the
 * header's sign-out calls `useNavigate`).
 *
 * The mock exercise scope starts `live`; `status` pre-sets the status the mock scope reports
 * (`setMockExerciseStatus`), and `resetLifecycleMock()` puts it back -- call it in `afterEach`.
 */

import { render, screen, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { cobraTheme } from '@/theme/cobraTheme'
import {
  ExerciseContextProvider,
  resetMockExerciseStatus,
  setMockExerciseStatus,
  type ExerciseStatus,
} from '@/core/exerciseContext'
import type { ExerciseRole } from '@/core/auth'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { ExerciseLifecycleControl } from './ExerciseLifecycleControl'

export interface RenderControlOptions {
  /** The status the MOCK exercise scope reports at mount. Defaults to the mock's own `live`. */
  readonly status?: ExerciseStatus
  /** Overrides the operating role (the console's identity is `controller`). */
  readonly role?: ExerciseRole
  /** Render the real staff header beside the control, to read the state pill. */
  readonly withHeader?: boolean
}

/** Renders the control (and optionally the header) under the real providers. */
export function renderControl(options: RenderControlOptions = {}): RenderResult {
  const { status, role, withHeader = false } = options
  if (status !== undefined) setMockExerciseStatus(status)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>
            {withHeader && <StaffHeader surfaceName="Controller Console" />}
            <ExerciseLifecycleControl {...(role !== undefined ? { role } : {})} />
          </ExerciseContextProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Restores the mock exercise scope to its canned status. */
export function resetLifecycleMock(): void {
  resetMockExerciseStatus()
}

/** Waits for the exercise scope to resolve, i.e. for the header (or anything under it) to mount. */
export async function scopeResolved(): Promise<void> {
  await screen.findByTestId('staff-header')
}

/** The header's state pill TEXT (LIVE, STAGED, ENDEX, ...). */
export function pillLabel(): string {
  return screen.getByTestId('staff-header-state-pill-label').textContent ?? ''
}
