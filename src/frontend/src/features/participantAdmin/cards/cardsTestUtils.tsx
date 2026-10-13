/**
 * features/participantAdmin/cards/cardsTestUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers shared by the card-sheet specs: the provider stack the preview needs
 * (React Query + the COBRA theme the staff shell would mount + the exercise context) and a
 * canned axios response, plus two ways to observe the cards request (the arguments handed to
 * `api.post`, or the real serialized request). Never import this from non-test code.
 */

import type { ReactElement, ReactNode } from 'react'
import { render, screen, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosHeaders, type AxiosAdapter, type AxiosRequestConfig, type AxiosResponse } from 'axios'
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

/** A 200 axios response carrying `data`, for a spied `api.post`. */
export function okResponse(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
}

/** One request the cards endpoint received, as the service handed it to axios. */
export interface CardsCall {
  /** The raw request body object. */
  body: unknown
  /** `body.participantIds` when it is an array, else empty. */
  ids: string[]
  /** Whether the body asked for everyone (`{ all: true }`). */
  all: boolean
}

/**
 * Intercepts ONLY `POST /staff/roster/cards` on the shared client (every other call still
 * goes through untouched) and answers it with `respond(call)`. Returns the recorded calls.
 * Restore with `vi.restoreAllMocks()`. The abort signal is NOT acted on here, so a held
 * request still resolves after an abort (what the service does next is what is tested).
 */
export function spyOnCardsEndpoint(
  respond: (call: CardsCall) => unknown,
): { calls: CardsCall[] } {
  const original = api.post.bind(api)
  const calls: CardsCall[] = []
  vi.spyOn(api, 'post').mockImplementation(
    ((url: string, data?: unknown, config?: AxiosRequestConfig) => {
      if (url !== CARDS_ENDPOINT) return original(url, data, config)
      const body = data as { participantIds?: unknown; all?: unknown } | undefined
      const call: CardsCall = {
        body: data,
        ids: Array.isArray(body?.participantIds) ? (body.participantIds as string[]) : [],
        all: body?.all === true,
      }
      calls.push(call)
      return Promise.resolve(respond(call)).then(okResponse)
    }) as typeof api.post,
  )
  return { calls }
}

/** One cards request as it would leave the browser: the REAL serialized form. */
export interface WireRequest {
  method: string
  /** The full request URL, including any query string. */
  url: string
  contentType: string
  /** The serialized body text. */
  rawBody: string
  /** The body parsed back from `rawBody`. */
  body: unknown
}

/**
 * Lets the service's `api.post` run through the REAL axios pipeline (URL building, body
 * serialization, headers) and records what would go on the wire, answering 200 with
 * `respond(body)` (an empty valid sheet by default). Unlike `spyOnCardsEndpoint`, this
 * proves the serialized request, not the arguments handed to `api.post`.
 */
export function captureCardsWire(
  respond: (body: unknown) => unknown = () => ({ exerciseName: 'X', cards: [], skipped: [] }),
): { requests: WireRequest[] } {
  const original = api.post.bind(api)
  const requests: WireRequest[] = []
  const capture: AxiosAdapter = config => {
    const rawBody = typeof config.data === 'string' ? config.data : ''
    const body: unknown = rawBody === '' ? undefined : JSON.parse(rawBody)
    requests.push({
      method: config.method ?? '',
      url: api.getUri(config),
      contentType: String(config.headers.get('Content-Type') ?? ''),
      rawBody,
      body,
    })
    return Promise.resolve({
      data: respond(body),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
  }
  vi.spyOn(api, 'post').mockImplementation(
    ((url: string, data?: unknown, config?: AxiosRequestConfig) =>
      url === CARDS_ENDPOINT
        ? original(url, data, { ...config, adapter: capture })
        : original(url, data, config)) as typeof api.post,
  )
  return { requests }
}
