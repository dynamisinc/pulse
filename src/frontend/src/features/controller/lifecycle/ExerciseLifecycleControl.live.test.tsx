/**
 * features/controller/lifecycle/ExerciseLifecycleControl.live.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6 -- the control against the LIVE endpoints (`USE_MOCK_DATA` off), with a small
 * stateful FAKE SERVER behind the shared axios client:
 *
 *   GET  /exercise-context                     -> the scope (its `status` is what the pill shows)
 *   GET  /staff/exercise-lifecycle             -> { exerciseId, state, storedStatus,
 *                                                   allowedTransitions, behaviour }
 *   POST /staff/exercise-lifecycle/transition  -> the same body for the new state,
 *                                                 or 400 / 401 / 403 / 404 / 409
 *
 * The shapes and status codes are the backend's (`LifecycleEndpoints.cs`, `LifecycleDtos.cs`,
 * `ExerciseLifecycleStates.cs`). The fake enforces the real machine, so a "stale" Start
 * (another controller got there first) produces the server's own 409 sentence.
 *
 * Covers: the request shapes (body is exactly `{ to }`, no exercise id anywhere), the header
 * pill following the server through the scope refresh, every error rendered as TEXT, the 409
 * re-read, in-flight behaviour, the failed read + Retry, fail-closed on an unknown state, and
 * "absent for non-controllers issues no request".
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { api } from '@/core/services/api'
import { pillLabel, renderControl, scopeResolved } from './lifecycle.testUtils'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))

const LIFECYCLE_PATH = '/staff/exercise-lifecycle'
const TRANSITION_PATH = '/staff/exercise-lifecycle/transition'

/** The backend's table (`ExerciseLifecycleStates.Allowed`). */
const MACHINE: Record<string, readonly string[]> = {
  build: ['staged'],
  staged: ['live'],
  live: ['paused', 'completed'],
  paused: ['live', 'completed'],
  completed: ['archived'],
  archived: [],
}

let serverState = 'staged'
let lifecycleBodyOverride: unknown
let postFailure: AxiosError | undefined
let getLifecycleFailure: AxiosError | undefined
/** When set, a POST waits for this promise (to hold a request in flight). */
let postGate: Promise<void> | undefined

function lifecycleBody() {
  return lifecycleBodyOverride ?? {
    exerciseId: 'ex-live-0001',
    state: serverState,
    storedStatus: serverState,
    allowedTransitions: MACHINE[serverState] ?? [],
    behaviour: {
      participantAccessOpen: true,
      participantWritesAccepted: true,
      ambientWorldRuns: true,
      clockRuns: true,
      scenarioContentFires: true,
      isTerminal: false,
    },
  }
}

function httpError(status: number, data: unknown): AxiosError {
  const config = { headers: {} } as never
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config,
  })
}

let getSpy: MockInstance<typeof api.get>
let postSpy: MockInstance<typeof api.post>

beforeEach(() => {
  serverState = 'staged'
  lifecycleBodyOverride = undefined
  postFailure = undefined
  getLifecycleFailure = undefined
  postGate = undefined

  getSpy = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/exercise-context') {
      return {
        data: {
          exerciseId: 'ex-live-0001',
          exerciseName: 'Coastal Surge (live)',
          timeZone: 'America/New_York',
          status: serverState,
        },
      }
    }
    if (url === LIFECYCLE_PATH) {
      if (getLifecycleFailure !== undefined) throw getLifecycleFailure
      return { data: lifecycleBody() }
    }
    throw new Error(`unexpected GET ${url}`)
  })

  postSpy = vi.spyOn(api, 'post').mockImplementation(async (url: string, body: unknown) => {
    if (url !== TRANSITION_PATH) throw new Error(`unexpected POST ${url}`)
    if (postGate !== undefined) await postGate
    if (postFailure !== undefined) throw postFailure
    const to = (body as { to?: string }).to ?? ''
    // The machine, as the server enforces it.
    if (!(MACHINE[serverState] ?? []).includes(to)) {
      const allowed = MACHINE[serverState] ?? []
      throw httpError(
        409,
        `'${serverState}' -> '${to}' is not an allowed lifecycle transition (${allowed.length === 0
          ? `'${serverState}' is a terminal state`
          : `allowed from '${serverState}': ${allowed.join(', ')}`}).`,
      )
    }
    serverState = to
    return { data: lifecycleBody() }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const lifecycleReads = () => getSpy.mock.calls.filter(call => call[0] === LIFECYCLE_PATH)

describe('ExerciseLifecycleControl (live) -- the requests', () => {
  it('reads the lifecycle on mount, with no exercise id anywhere in the request', async () => {
    renderControl({ withHeader: true })
    await scopeResolved()
    await screen.findByRole('button', { name: /start exercise/i })

    const read = lifecycleReads()[0]
    expect(read?.[0]).toBe(LIFECYCLE_PATH)
    const options = read?.[1] as { params?: unknown } | undefined
    expect(options?.params).toBeUndefined()
    expect(JSON.stringify(read)).not.toMatch(/ex-live-0001/)
  })

  it('Start sends POST { to: "live" } and nothing else, then the header pill follows the server', async () => {
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    expect(pillLabel()).toBe('STAGED')

    await user.click(await screen.findByRole('button', { name: /start exercise/i }))

    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    expect(postSpy).toHaveBeenCalledTimes(1)
    const [url, body] = postSpy.mock.calls[0] ?? []
    expect(url).toBe(TRANSITION_PATH)
    expect(body).toStrictEqual({ to: 'live' })
    expect(JSON.stringify(body)).not.toMatch(/exercise/i)
    // The buttons now follow the SERVER's table for `live`.
    expect(await screen.findByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
  })

  it('End sends POST { to: "completed" } only after END is typed, and the pill follows', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    expect(pillLabel()).toBe('LIVE')

    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    expect(postSpy).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    expect(postSpy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0]?.[1]).toStrictEqual({ to: 'completed' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('offers exactly the targets the server lists, ignoring any it does not know', async () => {
    lifecycleBodyOverride = {
      exerciseId: 'ex-live-0001',
      state: 'paused',
      storedStatus: 'paused',
      allowedTransitions: ['live', 'teleported'],
    }
    renderControl({ withHeader: true })
    await scopeResolved()

    expect(await screen.findByRole('button', { name: /start exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /end exercise/i })).not.toBeInTheDocument()
  })
})

describe('ExerciseLifecycleControl (live) -- failures are visible text', () => {
  it('a refused Start shows the server\'s own sentence, and re-reads the lifecycle so the buttons stop lying', async () => {
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    const start = await screen.findByRole('button', { name: /start exercise/i })
    const readsBefore = lifecycleReads().length
    // Another controller starts the exercise first: our Start is now a live -> live request.
    serverState = 'live'

    await user.click(start)

    const alert = await screen.findByTestId('lifecycle-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('The exercise state was not changed.')
    expect(alert).toHaveTextContent(
      "'live' -> 'live' is not an allowed lifecycle transition (allowed from 'live': paused, completed).",
    )
    // The lifecycle was re-read, so the control now offers what is actually possible.
    await waitFor(() => expect(lifecycleReads().length).toBeGreaterThan(readsBefore))
    expect(await screen.findByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument())
  })

  it.each([
    [401, 'Your console session has expired or has no exercise. Sign in again.'],
    [403, 'Only a controller assigned to this exercise can change its state.'],
    [404, 'This exercise no longer exists.'],
    [503, 'The server is busy right now. Try again in a moment.'],
    [500, 'The exercise state was not changed (the server answered 500).'],
  ])('a %i is explained in a sentence, never a bare status', async (status, sentence) => {
    const user = userEvent.setup()
    postFailure = httpError(status, undefined)
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /start exercise/i }))

    expect(await screen.findByTestId('lifecycle-error')).toHaveTextContent(sentence)
    // Nothing changed: the pill and the buttons are as they were.
    expect(pillLabel()).toBe('STAGED')
    expect(screen.getByRole('button', { name: /start exercise/i })).toBeInTheDocument()
  })

  it('a network failure says the server could not be reached', async () => {
    const user = userEvent.setup()
    postFailure = new AxiosError('Network Error', 'ERR_NETWORK')
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /start exercise/i }))

    expect(await screen.findByTestId('lifecycle-error')).toHaveTextContent(
      'The server could not be reached. Check the connection and try again.',
    )
  })

  it('never shows markup or a wall of text from the server: an HTML 409 falls back to the fixed sentence', async () => {
    const user = userEvent.setup()
    postFailure = httpError(409, '<html><body><h1>Conflict</h1><pre>stack trace</pre></body></html>')
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /start exercise/i }))

    const alert = await screen.findByTestId('lifecycle-error')
    expect(alert).toHaveTextContent('The exercise is not in a state that allows that change.')
    expect(alert.textContent).not.toMatch(/<html|stack trace/i)
  })

  it('a failed End explains itself INSIDE the dialog, keeps it open with END still typed, and a retry can succeed', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    postFailure = httpError(503, undefined)
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('Type END to confirm')
    await user.type(field, 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    const error = await within(dialog).findByTestId('end-exercise-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent('The exercise was not ended.')
    expect(error).toHaveTextContent('The server is busy right now. Try again in a moment.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(field).toHaveValue('END')
    expect(pillLabel()).toBe('LIVE')
    // Not duplicated outside the dialog while the dialog is explaining it.
    expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()

    postFailure = undefined
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))
    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
  })
})

describe('ExerciseLifecycleControl (live) -- in flight', () => {
  it('shows Starting…, keeps the button focusable, and ignores a second press (one POST)', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    postGate = new Promise<void>(resolve => { release = resolve })
    renderControl({ withHeader: true })
    await scopeResolved()

    const start = await screen.findByRole('button', { name: /start exercise/i })
    await user.click(start)

    const pendingButton = await screen.findByRole('button', { name: /starting/i })
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(pendingButton).not.toBeDisabled() // focus is never dropped mid-request
    await user.click(pendingButton)
    expect(postSpy).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it('cannot dismiss the End dialog while the request is in flight, and says so: "Ending…"', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    let release: () => void = () => undefined
    postGate = new Promise<void>(resolve => { release = resolve })
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(within(dialog).getByTestId('end-exercise-confirm')).toHaveTextContent('Ending…'))
    expect(within(dialog).getByTestId('end-exercise-confirm')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pillLabel()).toBe('ENDEX')
  })
})

describe('ExerciseLifecycleControl (live) -- when the state cannot be read', () => {
  it('says so in text with a Retry, then recovers when the read works', async () => {
    const user = userEvent.setup()
    getLifecycleFailure = httpError(500, undefined)
    renderControl({ withHeader: true })
    await scopeResolved()

    const alert = await screen.findByTestId('lifecycle-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Exercise state unavailable.')
    // Offers nothing to press on an unknown state.
    expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()

    getLifecycleFailure = undefined
    await user.click(screen.getByTestId('lifecycle-retry'))

    expect(await screen.findByRole('button', { name: /start exercise/i })).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-load-error')).not.toBeInTheDocument()
  })

  it('fails closed on a state it does not recognise: nothing to press, and the reason is shown', async () => {
    lifecycleBodyOverride = {
      exerciseId: 'ex-live-0001',
      state: 'warp-speed',
      storedStatus: 'warp-speed',
      allowedTransitions: ['live', 'completed'],
    }
    renderControl({ withHeader: true })
    await scopeResolved()

    expect(await screen.findByTestId('lifecycle-load-error')).toHaveTextContent('does not recognise')
    expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
  })
})

describe('ExerciseLifecycleControl (live) -- absent for non-controllers', () => {
  it('renders nothing and issues NO request for an evaluator', async () => {
    renderControl({ role: 'evaluator', withHeader: true })
    await scopeResolved()
    // Let any would-be query settle.
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
    expect(lifecycleReads()).toHaveLength(0)
    expect(postSpy).not.toHaveBeenCalled()
  })
})
