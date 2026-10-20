/**
 * features/staffShell/components/StaffHeader.default.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the SHIPPED default path: `StaffHeader` rendered under the
 * REAL, un-mocked `ExerciseContextProvider` (the Wave-0 DEV mock resolution
 * — see `core/exerciseContext/exerciseContextResolver.ts`'s
 * `MOCK_EXERCISE_CONTEXT`). The sibling `StaffHeader.test.tsx` mocks
 * `@/core/exerciseContext` at the module boundary to exercise every
 * status/branch deterministically and synchronously; this file is the only
 * one that runs what the app actually executes today (WAVE0-REVIEW
 * precedent 19 — mirrors `exerciseContextResolver.default.test.ts` beside
 * `exerciseContextResolver.test.ts`). Deliberately does NOT mock
 * `@/core/exerciseContext` or `@/core/services/api`.
 *
 * `StaffHeader` also calls `useNavigate()` for its sign-out control (feature:
 * login, story 04) — wrapped in a real `MemoryRouter` here too, so this
 * remains a genuinely un-mocked shipped path (no `react-router-dom` mock).
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { StaffHeader } from './StaffHeader'
import { ExerciseContextProvider } from '@/core/exerciseContext'

// The header's identity badge reads the staff assignments (React Query) to decide
// whether it is a switcher, so every render needs a QueryClientProvider.
function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('StaffHeader — shipped default (real ExerciseContextProvider, DEV mock resolution)', () => {
  it('renders the identity badge and a LIVE state pill for the mock-resolved active exercise', async () => {
    render(
      <QueryClientProvider client={newQueryClient()}>
        <MemoryRouter>
          <ExerciseContextProvider>
            <StaffHeader surfaceName="Controller Console" />
          </ExerciseContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('staff-header-identity-badge')).toBeInTheDocument())

    // The internal name arrives with the (mock) staff assignments, after the badge mounts.
    expect(await screen.findByText('Coastal Surge (Mock Exercise)')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-state-pill')).toHaveTextContent('LIVE')
    expect(screen.getByTestId('staff-header-state-pill-dot')).toBeInTheDocument()
  })

  it('shows the controller call sign as the cell (one source, demo-polish C4) and no faked presence', async () => {
    render(
      <QueryClientProvider client={newQueryClient()}>
        <MemoryRouter>
          <ExerciseContextProvider>
            <StaffHeader surfaceName="Controller Console" />
          </ExerciseContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const badge = await screen.findByTestId('staff-header-identity-badge')
    expect(badge).toHaveTextContent('CONTROLLER · SIMCELL-1')
    expect(screen.queryByTestId('staff-header-presence')).not.toBeInTheDocument()
  })
})
