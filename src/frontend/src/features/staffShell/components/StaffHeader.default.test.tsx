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
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StaffHeader } from './StaffHeader'
import { ExerciseContextProvider } from '@/core/exerciseContext'

describe('StaffHeader — shipped default (real ExerciseContextProvider, DEV mock resolution)', () => {
  it('renders the identity badge and a LIVE state pill for the mock-resolved active exercise', async () => {
    render(
      <ExerciseContextProvider>
        <StaffHeader surfaceName="Controller Console" />
      </ExerciseContextProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('staff-header-identity-badge')).toBeInTheDocument())

    expect(screen.getByText('Coastal Surge (Mock Exercise)')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-state-pill')).toHaveTextContent('LIVE')
    expect(screen.getByTestId('staff-header-state-pill-dot')).toBeInTheDocument()
  })
})
