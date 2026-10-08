/**
 * features/controller/runSheet/RunSheetPanel.live.test.tsx
 * ---------------------------------------------------------------------------
 * The run-sheet panel against the LIVE post path (`USE_MOCK_DATA` forced off for the whole
 * file, as `useComposeAsPersona.test.ts` does): the real `publishPost` runs and only
 * `api.post` is mocked, so these tests see the exact request - demo-polish C3 (#438),
 * AC "Fire / Fire next / Skip" and "Reply beats":
 *  - the request carries `origin: 'controller-as-persona'`, the controller's acting human,
 *    `media`, `parentPostId` (the parent's `firedPostId`) and `engagementBaseline`, and NO
 *    `exerciseId`;
 *  - a request in flight DISABLES firing, and a double press (or a double Fire next) sends
 *    ONE request;
 *  - a server refusal is "Failed" with a Retry; an unknown outcome (500, a dropped
 *    connection, an unreadable 2xx) is "Unconfirmed" with NO Retry - re-firing it needs an
 *    explicit confirmation, and Fire next never picks it up (POST /api/posts is not idempotent:
 *    F4 / #455);
 *  - the outcome of a fire is recorded against the exercise and beat it started in, even if
 *    the panel unmounted meanwhile.
 *
 * The exercise scope, personas and media library are mocked at the hook level so no network
 * is needed for them; `usePersonas` returns a fixed cast.
 */
import { AxiosError, type AxiosResponse } from 'axios'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import type { Persona } from '@/features/personas'

const postMock = vi.fn()
const world = vi.hoisted(() => ({
  scope: {
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'live',
  },
  personas: [] as unknown[],
}))

vi.mock('@/core/services/api', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => world.scope,
}))
vi.mock('@/features/personas', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/personas')>()),
  usePersonas: () => ({ personas: world.personas, loading: false, error: undefined }),
}))
vi.mock('@/core/media', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/media')>()),
  useMediaLibrary: () => ({ data: [], isPending: false, isError: false }),
}))

import { RunSheetPanel } from './RunSheetPanel'
import { readStoredSheet } from './runSheetStorage'
import { resetRunSheetStoreForTests } from './runSheetStore'
import { runtimeOf, type RunSheetData } from './runSheetModel'
import {
  beatFixture,
  personaFixture,
  resetRunSheetWorld,
  seedStoredSheet,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

const EX = 'ex-live-0001'
const LIVE_HUMAN = 'human-controller-ex-live-0001'

const cast: Persona[] = [
  personaFixture('tbrandt41', { exerciseId: EX }),
  personaFixture('mvega_fh', { exerciseId: EX }),
  personaFixture('FulcoEM', { exerciseId: EX }),
]

const created = (id: string) => ({
  id,
  authorPersonaId: 'persona-x',
  text: 'ok',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00.0000000+00:00',
})

function httpError(status: number, data: unknown = undefined): AxiosError {
  const response = { status, data, statusText: '', headers: {}, config: {} } as AxiosResponse
  return new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, response)
}

/** A promise the test settles by hand, to hold a request "in flight". */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderLive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <RunSheetPanel />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

async function mountLive(seed: RunSheetData) {
  seedStoredSheet(EX, seed)
  const user = userEvent.setup({ delay: null })
  const utils = renderLive()
  await screen.findByTestId('run-sheet-panel')
  return { user, ...utils }
}

const row = (id: string) => screen.getByTestId(`beat-row-${id}`)
const statusOf = (id: string) => within(row(id)).getByTestId('beat-status')
const liveStatus = () => screen.getByTestId('run-sheet-status')

async function selectRow(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(row(id))
  return row(id)
}

function stored(): RunSheetData {
  const read = readStoredSheet(EX)
  if (read.kind !== 'ok') throw new Error(`expected a stored sheet, got ${read.kind}`)
  return read.data
}

const bodyOf = (call: number): Record<string, unknown> =>
  (postMock.mock.calls[call] as [string, Record<string, unknown>])[1]

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box:
// give each test a generous budget instead of the 10s default.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  resetRunSheetWorld()
  useFixedClock()
  postMock.mockReset()
  world.scope = {
    exerciseId: EX,
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'live',
  }
  world.personas = cast
})
afterEach(() => {
  cleanup()
  resetRunSheetWorld()
})

const SINGLE = () => sheetFixture([
  beatFixture({ id: 'a', order: 1, title: 'Photo drop', persona: { handle: 'tbrandt41' } }),
  beatFixture({ id: 'b', order: 2, title: 'Second beat', persona: { handle: 'mvega_fh' } }),
])

describe('the request a fire sends', () => {
  it('is controller-as-persona by the acting human, with media / baseline, and no exerciseId', async () => {
    postMock.mockResolvedValue({ data: created('post-live-1') })
    const { user } = await mountLive(sheetFixture([
      beatFixture({
        id: 'a',
        order: 1,
        title: 'Photo drop',
        persona: { handle: 'tbrandt41' },
        text: 'Look at the colour of my tap water!',
        media: [{ mediaId: 'media-guid-1', alt: 'Brown water in a glass' }],
        engagementBaseline: { like: 120, repost: 40, reply: 5 },
      }),
    ]))
    await selectRow(user, 'a')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Fired'))

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0]?.[0]).toBe('/posts')
    const body = bodyOf(0)
    expect(body).toMatchObject({
      origin: 'controller-as-persona',
      authorPersonaId: 'persona-tbrandt41',
      actingHumanId: LIVE_HUMAN,
      text: 'Look at the colour of my tap water!',
      timeZone: 'America/New_York',
      scenarioTime: '2033-09-04T14:00:00.000Z',
      media: [{ mediaId: 'media-guid-1', alt: 'Brown water in a glass' }],
      engagementBaseline: { like: 120, repost: 40, reply: 5 },
    })
    expect(Object.keys(body).sort()).toEqual([
      'actingHumanId',
      'authorPersonaId',
      'engagementBaseline',
      'media',
      'origin',
      'scenarioTime',
      'text',
      'timeZone',
    ])

    expect(runtimeOf(stored(), 'a')).toEqual({
      status: 'fired',
      firedPostId: 'post-live-1',
      firedAtScenario: '2033-09-04T14:00:00.0000000+00:00',
    })
  })

  it('replies with parentPostId set to the parent beat\'s firedPostId', async () => {
    postMock.mockResolvedValueOnce({ data: created('post-parent-9') })
    postMock.mockResolvedValueOnce({ data: created('post-child-9') })
    const { user } = await mountLive(sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Parent', persona: { handle: 'tbrandt41' } }),
      beatFixture({
        id: 'c',
        order: 2,
        title: 'Child',
        persona: { handle: 'mvega_fh' },
        replyTo: { beatId: 'p' },
      }),
    ]))
    await selectRow(user, 'c')
    expect(within(row('c')).getByTestId('beat-blocked')).toHaveTextContent('Fire the parent first')
    await user.keyboard('f')
    expect(postMock).not.toHaveBeenCalled()

    await selectRow(user, 'p')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('p')).toHaveTextContent('Fired'))
    await selectRow(user, 'c')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('c')).toHaveTextContent('Fired'))

    expect(postMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(1)).toMatchObject({
      origin: 'controller-as-persona',
      authorPersonaId: 'persona-mvega_fh',
      parentPostId: 'post-parent-9',
    })
    expect(bodyOf(1)).not.toHaveProperty('exerciseId')
  })

  it('replies to an existing post id for replyTo.postId', async () => {
    postMock.mockResolvedValue({ data: created('post-new') })
    const { user } = await mountLive(sheetFixture([
      beatFixture({ id: 'r', order: 1, persona: { handle: 'FulcoEM' }, replyTo: { postId: 'existing-guid' } }),
    ]))
    await selectRow(user, 'r')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('r')).toHaveTextContent('Fired'))
    expect(bodyOf(0).parentPostId).toBe('existing-guid')
  })

  it('does not post for an unknown persona handle', async () => {
    const { user } = await mountLive(sheetFixture([
      beatFixture({ id: 'g', order: 1, persona: { handle: 'nobody_here' } }),
    ]))
    await selectRow(user, 'g')
    await user.keyboard('f')
    expect(postMock).not.toHaveBeenCalled()
    expect(liveStatus()).toHaveTextContent('Unknown persona @nobody_here')
  })
})

describe('a request in flight', () => {
  it('disables firing, and a double press (or double Fire next) sends ONE request', async () => {
    const pending = deferred<{ data: unknown }>()
    postMock.mockReturnValue(pending.promise)
    const { user } = await mountLive(SINGLE())
    const r = await selectRow(user, 'a')

    fireEvent.keyDown(r, { key: 'f' })
    fireEvent.keyDown(r, { key: 'f' })
    fireEvent.keyDown(r, { key: 'n' })
    expect(postMock).toHaveBeenCalledTimes(1)

    // While it is in flight: a "Firing" chip, a disabled Fire next, no second fire.
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Firing'))
    expect(within(row('a')).getByText(/Firing\.\.\. waiting for the server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Fire next/ })).toBeDisabled()
    expect(within(row('a')).getByRole('button', { name: 'Firing...' })).toBeDisabled()
    expect(within(row('a')).queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(within(row('a')).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(within(row('a')).getByRole('button', { name: 'Delete' })).toBeDisabled()

    // Another beat cannot fire meanwhile (one at a time).
    await selectRow(user, 'b')
    expect(within(row('b')).getByRole('button', { name: 'Fire' })).toBeDisabled()
    await user.keyboard('f')
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(liveStatus()).toHaveTextContent('Another beat is still firing')

    // And the in-flight marker is already persisted (a reload now must not look pending).
    expect(stored().runtime.a?.inFlight).toBe(true)

    pending.resolve({ data: created('post-1') })
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Fired'))
    expect(stored().runtime.a?.inFlight).toBeUndefined()
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('records the outcome against the exercise it started in when the console switches exercise', async () => {
    const pending = deferred<{ data: unknown }>()
    postMock.mockReturnValue(pending.promise)
    const { user, rerender } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))

    // The console moves to another exercise while the request is out; it does not remount.
    world.scope = { ...world.scope, exerciseId: 'ex-live-0002' }
    rerender(
      <ThemeProvider theme={cobraTheme}>
        <QueryClientProvider client={new QueryClient()}>
          <RunSheetPanel />
        </QueryClientProvider>
      </ThemeProvider>,
    )
    await screen.findByTestId('run-sheet-empty')
    expect(screen.queryByTestId('beat-row-a')).toBeNull()

    pending.resolve({ data: created('post-in-a') })
    await waitFor(() => expect(runtimeOf(stored(), 'a').status).toBe('fired'))
    expect(runtimeOf(stored(), 'a').firedPostId).toBe('post-in-a')
    // The other exercise's sheet was never touched.
    expect(readStoredSheet('ex-live-0002').kind).toBe('empty')
    expect(screen.queryByTestId('beat-row-a')).toBeNull()
  })

  it('still records the outcome against the right beat if the panel unmounts first', async () => {
    const pending = deferred<{ data: unknown }>()
    postMock.mockReturnValue(pending.promise)
    const { user, unmount } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))

    unmount()
    pending.resolve({ data: created('post-late') })
    await waitFor(() => expect(runtimeOf(stored(), 'a').status).toBe('fired'))
    expect(runtimeOf(stored(), 'a').firedPostId).toBe('post-late')
    resetRunSheetStoreForTests()
  })
})

describe('FAILED: the server refused it (nothing was created)', () => {
  it('shows the error and a Retry, never a false "Fired"; Retry sends one new request', async () => {
    postMock.mockRejectedValueOnce(httpError(400, 'Each media item needs a description.'))
    postMock.mockResolvedValueOnce({ data: created('post-retry') })
    const { user } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')

    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Failed'))
    expect(statusOf('a')).not.toHaveTextContent('Fired')
    expect(within(row('a')).getByTestId('beat-failure')).toHaveTextContent(
      'Failed - The server refused this post (HTTP 400): Each media item needs a description.',
    )
    const alert = screen.getByTestId('run-sheet-alert')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Failed: "Photo drop"')
    expect(runtimeOf(stored(), 'a').status).toBe('failed')
    expect(runtimeOf(stored(), 'a').firedPostId).toBeUndefined()

    await user.click(within(row('a')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Fired'))
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('run-sheet-alert')).toBeNull()
  })

  it('keeps a failed beat out of Fire next', async () => {
    postMock.mockRejectedValueOnce(httpError(400, 'nope'))
    postMock.mockResolvedValueOnce({ data: created('post-b') })
    const { user } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Failed'))

    await user.keyboard('n')
    await waitFor(() => expect(statusOf('b')).toHaveTextContent('Fired'))
    expect(statusOf('a')).toHaveTextContent('Failed')
    expect(postMock).toHaveBeenCalledTimes(2)
  })
})

describe('UNCONFIRMED: the outcome is unknown, so the post may be live', () => {
  it.each([
    ['a 500', () => postMock.mockRejectedValueOnce(httpError(500))],
    ['a 504 gateway timeout', () => postMock.mockRejectedValueOnce(httpError(504))],
    ['a dropped connection', () => postMock.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))],
    ['a malformed 2xx body', () => postMock.mockResolvedValueOnce({ data: { not: 'a post' } })],
  ])('%s is Unconfirmed: no Retry, a warning to check the live world', async (_name, arrange) => {
    arrange()
    const { user } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')

    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Unconfirmed'))
    expect(statusOf('a')).not.toHaveTextContent('Fired')
    expect(within(row('a')).getByTestId('beat-failure')).toHaveTextContent(
      /^Unconfirmed - .*check the Live world before firing it again/,
    )
    expect(screen.getByTestId('run-sheet-alert')).toHaveTextContent('Unconfirmed: "Photo drop"')
    expect(within(row('a')).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(within(row('a')).getByRole('button', { name: 'Fire again...' })).toBeEnabled()
    expect(screen.getByTestId('run-sheet-counts')).toHaveTextContent('1 unconfirmed')
    expect(runtimeOf(stored(), 'a').failure?.kind).toBe('unconfirmed')
  })

  it('is never retried by Fire next, and re-firing needs an explicit confirmation', async () => {
    postMock.mockRejectedValueOnce(httpError(504))
    postMock.mockResolvedValueOnce({ data: created('post-b') })
    postMock.mockResolvedValueOnce({ data: created('post-a-again') })
    const { user } = await mountLive(SINGLE())
    await selectRow(user, 'a')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Unconfirmed'))

    // Fire next moves on to the next PENDING beat; the unconfirmed one is left alone.
    await user.keyboard('n')
    await waitFor(() => expect(statusOf('b')).toHaveTextContent('Fired'))
    expect(statusOf('a')).toHaveTextContent('Unconfirmed')
    expect(postMock).toHaveBeenCalledTimes(2)

    // F on it asks first.
    await selectRow(user, 'a')
    await user.keyboard('f')
    const dialog = await screen.findByRole('dialog', { name: 'Fire again?' })
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Fire again' }))
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Fired'))
    expect(postMock).toHaveBeenCalledTimes(3)
    expect(runtimeOf(stored(), 'a').firedPostId).toBe('post-a-again')
  })

  it('holds back a reply whose parent is unconfirmed, naming why', async () => {
    postMock.mockRejectedValueOnce(httpError(500))
    const { user } = await mountLive(sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Parent', persona: { handle: 'tbrandt41' } }),
      beatFixture({
        id: 'c',
        order: 2,
        title: 'Child',
        persona: { handle: 'mvega_fh' },
        replyTo: { beatId: 'p' },
      }),
    ]))
    await selectRow(user, 'p')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('p')).toHaveTextContent('Unconfirmed'))
    await selectRow(user, 'c')
    expect(within(row('c')).getByTestId('beat-blocked')).toHaveTextContent(
      /^Fire the parent first \("Parent" may already be live/,
    )
    expect(within(row('c')).getByRole('button', { name: 'Fire' })).toBeDisabled()
  })

  it('treats a beat left in flight by a closed page as Unconfirmed after a reload', async () => {
    seedStoredSheet(EX, sheetFixture([beatFixture({ id: 'a', order: 1, persona: { handle: 'tbrandt41' } })], {
      a: { status: 'pending', inFlight: true },
    }))
    renderLive()
    await screen.findByTestId('run-sheet-panel')
    expect(statusOf('a')).toHaveTextContent('Unconfirmed')
    expect(within(row('a')).getByTestId('beat-failure')).toHaveTextContent(
      'was firing when the page was closed or reloaded',
    )
    expect(postMock).not.toHaveBeenCalled()
  })
})
