/**
 * features/participantAdmin/email/emailTestUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the "Email links" specs: the provider stack the button needs
 * (React Query, the COBRA theme the staff shell mounts, the exercise context), a roster
 * seeded into the SAME cache entry the roster screen fills, and a canned axios response.
 * Never import this from non-test code.
 */
import type { ReactElement, ReactNode } from 'react'
import { render, screen, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosHeaders, type AxiosResponse } from 'axios'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { cobraTheme } from '@/theme/cobraTheme'
import { rosterQueryKey } from '../hooks/useRoster'
import { makeEntry } from '../test/fixtures'
import type { RosterEntryDto, RosterListDto } from '../types'

/** The exercise id the mock exercise-context resolver returns under Vitest. */
export const TEST_EXERCISE_ID = 'ex-mock-0001'

/** A roster with the given rows and email capability. */
export function rosterWith(entries: RosterEntryDto[], emailLinks = true): RosterListDto {
  return { participants: entries, joinLinksAvailable: true, capabilities: { emailLinks } }
}

/** Four people: two emailable, one with no email, one disabled. */
export function sampleEntries(): RosterEntryDto[] {
  return [
    makeEntry({ id: 'p-ann', name: 'Ann Able', email: 'ann@example.org' }),
    makeEntry({ id: 'p-ben', name: 'Ben Baker', email: 'ben@example.org' }),
    makeEntry({ id: 'p-cal', name: 'Cal Cole', email: undefined }),
    makeEntry({ id: 'p-dee', name: 'Dee Dunn', email: 'dee@example.org', access: 'disabled' }),
  ]
}

export interface RenderedWithRoster extends RenderResult {
  queryClient: QueryClient
}

/**
 * Renders `ui` with the providers the staff shell supplies and `roster` already in the
 * roster cache (`undefined` = nothing loaded), once the exercise context has resolved.
 */
export async function renderWithRoster(
  ui: ReactElement,
  roster: RosterListDto | undefined,
): Promise<RenderedWithRoster> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (roster !== undefined) queryClient.setQueryData(rosterQueryKey(TEST_EXERCISE_ID), roster)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>
            <div data-testid="email-test-root">{children}</div>
          </ExerciseContextProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }
  const rendered = render(ui, { wrapper: Wrapper })
  await screen.findByTestId('email-test-root')
  return { ...rendered, queryClient }
}

/** A 200 axios response carrying `data`. */
export function okResponse(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
}
