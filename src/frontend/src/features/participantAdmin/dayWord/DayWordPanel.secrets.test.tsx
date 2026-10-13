/**
 * features/participantAdmin/dayWord/DayWordPanel.secrets.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 11, cross-cutting AC "Secrets": the server keeps only a hash
 * of the day word (EL-9), so the plaintext is shown to staff ONCE and must live
 * nowhere else. Specifically it must not be in:
 *   - the React Query QUERY cache (the status query never contains a word);
 *   - the React Query MUTATION cache (which holds a mutation's `variables` and
 *     `data` for `gcTime` after it settles - the typed word is in the former and
 *     the generated / returned word is in the latter);
 *   - `localStorage` / `sessionStorage`;
 *   - the document title or the URL;
 *   - any console output (the nearest thing to "a log" in the browser);
 * and it must be gone from the page when the result view closes, when the panel
 * unmounts, and when the active exercise changes.
 *
 * Driven through the shipped mock seam, as in `DayWordPanel.test.tsx`.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import { DayWordPanel } from './DayWordPanel'
import { dayWordMockControls } from './dayWordMocks'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockContext = vi.mocked(useExerciseContext)

// These tests mount the full MUI/Emotion panel and drive several async round trips
// through the mock adapter; on a loaded CI box the 10 s default is too tight.
vi.setConfig({ testTimeout: 30_000 })
const NOW = new Date('2026-10-13T16:00:00.000Z')
const TYPED = 'Granite Harbor 4417'

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPanel(queryClient: QueryClient) {
  mockContext.mockReturnValue({
    exerciseId: 'ex-A',
    exerciseName: 'Coastal Surge',
    timeZone: 'America/New_York',
    status: 'live',
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<DayWordPanel />, { wrapper: Wrapper })
}

/** Everything React Query holds, serialised: queries (key, state) and mutations. */
function dumpQueryClient(client: QueryClient): string {
  const queries = client.getQueryCache().getAll().map(q => ({ key: q.queryKey, state: q.state }))
  const mutations = client.getMutationCache().getAll().map(m => ({
    key: m.options.mutationKey,
    state: m.state,
  }))
  return JSON.stringify({ queries, mutations })
}

function dumpStorage(storage: Storage): string {
  const entries: Record<string, string | null> = {}
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null) entries[key] = storage.getItem(key)
  }
  return JSON.stringify(entries)
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/** Every argument list passed to a console method during the current test. */
let consoleCalls: unknown[][] = []

function consoleOutput(): string {
  return consoleCalls
    .map(args => args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    .join('\n')
}

beforeEach(() => {
  dayWordMockControls.reset()
  dayWordMockControls.setNow(NOW)
  localStorage.clear()
  sessionStorage.clear()
  consoleCalls = []
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args)
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Asserts `secret` appears nowhere it must not, for the current moment. */
function expectNoLeak(client: QueryClient, secret: string) {
  expect(dumpQueryClient(client)).not.toContain(secret)
  expect(dumpStorage(localStorage)).not.toContain(secret)
  expect(dumpStorage(sessionStorage)).not.toContain(secret)
  expect(document.title).not.toContain(secret)
  expect(window.location.href).not.toContain(secret)
  expect(consoleOutput()).not.toContain(secret)
}

describe('a generated word', () => {
  it('is not in the query cache, the mutation cache, storage, the title, the URL or the console', async () => {
    const user = userEvent.setup()
    const queryClient = newClient()
    renderPanel(queryClient)
    await user.click(await screen.findByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = screen.getByTestId('day-word-value').textContent ?? ''
    expect(word).not.toBe('')

    // The mutation is evicted once it settles (gcTime: 0 + reset), so wait for it.
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    // And let the status refetch finish so the cache is at rest.
    await screen.findByTestId('day-word-status-set')

    expectNoLeak(queryClient, word)
    // Positive control: the word really is on screen right now (the view is live).
    expect(screen.getByTestId('day-word-value')).toHaveTextContent(word)
  })

  it('is gone from the page and every store after the result view closes', async () => {
    const user = userEvent.setup()
    const queryClient = newClient()
    renderPanel(queryClient)
    await user.click(await screen.findByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = screen.getByTestId('day-word-value').textContent ?? ''

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(word)
    expect(document.body.innerHTML).not.toContain(word)
    await screen.findByTestId('day-word-status-set')
    expectNoLeak(queryClient, word)
  })

  it('is gone when the panel unmounts with the result still open', async () => {
    const user = userEvent.setup()
    const queryClient = newClient()
    const { unmount } = renderPanel(queryClient)
    await user.click(await screen.findByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = screen.getByTestId('day-word-value').textContent ?? ''

    unmount()

    expect(document.body.innerHTML).not.toContain(word)
    expectNoLeak(queryClient, word)
  })
})

describe('a typed word', () => {
  it('is not left in the mutation cache (as `variables`) or any store, success or failure', async () => {
    const user = userEvent.setup()
    const queryClient = newClient()
    renderPanel(queryClient)
    const field = await screen.findByLabelText('Or type your own word')

    // First a rejected submit: the failed mutation's variables must be released too.
    await user.click(field)
    await user.paste(TYPED)
    dayWordMockControls.failNext(400, 'Rejected for the test.')
    await user.click(screen.getByRole('button', { name: 'Set my own word' }))
    await screen.findByTestId('day-word-action-error')
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    expectNoLeak(queryClient, TYPED)

    // Then an accepted one.
    await user.click(screen.getByRole('button', { name: 'Set my own word' }))
    await screen.findByTestId('day-word-result')
    expect(screen.getByTestId('day-word-value')).toHaveTextContent(TYPED)
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    await screen.findByTestId('day-word-status-set')
    expectNoLeak(queryClient, TYPED)

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.body.innerHTML).not.toContain(TYPED)
    expectNoLeak(queryClient, TYPED)
  })
})

describe('the status query', () => {
  it('holds only the contract fields - never a word - even when a word has been set', async () => {
    const user = userEvent.setup()
    const queryClient = newClient()
    renderPanel(queryClient)
    await user.click(await screen.findByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-status-set')

    const queries = queryClient.getQueryCache().getAll()
    expect(queries).toHaveLength(1)
    const data = queries[0]?.state.data as Record<string, unknown>
    expect(Object.keys(data).sort()).toEqual([
      'replacedCount',
      'setAt',
      'setByName',
      'timeZone',
      'today',
      'todayEndsAt',
      'todaySet',
      'upcoming',
    ])
    expect(data).not.toHaveProperty('word')
  })
})
