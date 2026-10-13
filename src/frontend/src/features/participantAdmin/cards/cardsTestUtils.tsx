/**
 * features/participantAdmin/cards/cardsTestUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers shared by the card-sheet specs: the provider stack the preview needs
 * (React Query + the COBRA theme the staff shell would mount + the exercise context) and a
 * canned axios response. Never import this from non-test code.
 */

import type { ReactElement, ReactNode } from 'react'
import { render, screen, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { CARDS_ENDPOINT } from './cardsService'
import { cobraTheme } from '@/theme/cobraTheme'

/** The exercise id the mock exercise-context resolver returns under Vitest. */
export const TEST_EXERCISE_ID = 'ex-mock-0001'

export interface RenderedWithProviders extends RenderResult {
  queryClient: QueryClient
}

/**
 * Renders `ui` inside the providers the staff shell would supply and resolves once the
 * exercise context has resolved (until then `ExerciseContextProvider` mounts no children,
 * by design: it fails closed). The query client does NOT override `gcTime`/`staleTime`, so a
 * test sees the hook's own cache settings.
 */
export async function renderWithProviders(ui: ReactElement): Promise<RenderedWithProviders> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>
            <div data-testid="cards-test-root">{children}</div>
          </ExerciseContextProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }
  const rendered = render(ui, { wrapper: Wrapper })
  await screen.findByTestId('cards-test-root')
  return { ...rendered, queryClient }
}

/** A 200 axios response carrying `data`, for `vi.spyOn(api, 'get')`. */
export function okResponse(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
}

/** One request the cards endpoint received. */
export interface CardsCall {
  /** The `id` params sent (empty when none were). */
  ids: string[]
  /** Whether any params were sent at all. */
  hasParams: boolean
}

/**
 * Intercepts ONLY `GET /staff/roster/cards` on the shared client (every other call, such as
 * the exercise-context resolution the providers make, still goes through untouched) and
 * answers it with `respond(call)`. Returns the recorded calls. Restore with
 * `vi.restoreAllMocks()`.
 */
export function spyOnCardsEndpoint(
  respond: (call: CardsCall) => unknown,
): { calls: CardsCall[] } {
  const original = api.get.bind(api)
  const calls: CardsCall[] = []
  vi.spyOn(api, 'get').mockImplementation(((url: string, config?: AxiosRequestConfig) => {
    if (url !== CARDS_ENDPOINT) return original(url, config)
    const params = config?.params as { id?: string[] } | undefined
    const call: CardsCall = { ids: params?.id ?? [], hasParams: params !== undefined }
    calls.push(call)
    return Promise.resolve(respond(call)).then(okResponse)
  }) as typeof api.get)
  return { calls }
}
