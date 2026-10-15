/**
 * features/social/components/media/ExerciseBands.live.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06, Gate-1 M-3: the REAL hooks end to end, nothing about the chrome
 * config mocked except the server's answer.
 *
 *  - Under the real providers (React Query + the real `ExerciseContextProvider`), a
 *    `/chrome-config` body with `watermark: false, enabled: true` (the one unmarked
 *    state) removes the bands once the query SUCCEEDS. (While it is pending the safe
 *    default marks media; that is the fail-toward-marking design.)
 *  - The same body with the field missing (an older API) keeps them.
 *  - With no providers at all, the real `useChromeConfigAvailable()` reports "not
 *    available" and the bands are drawn (fail toward marking, never a crash).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { AxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { ExerciseBands } from './ExerciseBands'

const BANNER = { text: 'LIVE BANNER', fg: '#ffffff', bg: '#000000' }

/** Answers `/chrome-config` with `body`; every other read goes to the real client. */
function serveChromeConfig(body: Record<string, unknown>) {
  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation(((url: string, config?: AxiosRequestConfig) =>
    url === '/chrome-config'
      ? Promise.resolve({ data: body, status: 200, statusText: 'OK', headers: {}, config: {} })
      : realGet(url, config)
  ) as typeof api.get)
}

function renderUnderProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <p data-testid="scope-ready">ready</p>
        <ExerciseBands />
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

/** Waits until the chrome-config query has settled successfully. */
async function chromeConfigSucceeded(queryClient: QueryClient) {
  await waitFor(() => {
    const query = queryClient.getQueryCache().findAll({ queryKey: ['participant-shell', 'chrome-config'] })[0]
    expect(query?.state.status).toBe('success')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ExerciseBands — real hooks under the real providers', () => {
  it('removes the bands once the server says watermark: false with the chrome on', async () => {
    serveChromeConfig({ enabled: true, watermark: false, top: BANNER, bottom: BANNER })
    const queryClient = renderUnderProviders()

    await screen.findByTestId('scope-ready')
    await chromeConfigSucceeded(queryClient)

    await waitFor(() => expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument())
  })

  it('keeps them when the body has no watermark field (an older API fails toward marking)', async () => {
    serveChromeConfig({ enabled: true, top: BANNER, bottom: BANNER })
    const queryClient = renderUnderProviders()

    await screen.findByTestId('scope-ready')
    await chromeConfigSucceeded(queryClient)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('keeps them with the chrome OFF even when watermark is false', async () => {
    serveChromeConfig({ enabled: false, watermark: false, top: BANNER, bottom: BANNER })
    const queryClient = renderUnderProviders()

    await screen.findByTestId('scope-ready')
    await chromeConfigSucceeded(queryClient)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })
})

describe('ExerciseBands — real hooks outside the providers', () => {
  it('draws the bands (fail toward marking) and does not throw', () => {
    render(<ExerciseBands />)

    expect(screen.getByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    expect(screen.getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
  })
})
