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
import { pillLabel, renderControl, resetLifecycleMock, scopeResolved } from './lifecycle.testUtils'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))

// The control gates on the signed-in session's role (a staff session, from the session kit).
vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle.sessionKit.testUtils')).resolveSession,
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
/** The exercise the server's SESSION is on: what the scope and every lifecycle answer name. */
let serverExerciseId = 'ex-live-0001'
/** When set, ONLY the transition's answer names this exercise (the GETs name the session's). */
let postAnswerExerciseId: string | undefined
/** When set, a scope read made after a transition waits for this promise (holds the refresh). */
let scopeGate: Promise<void> | undefined
let lifecycleBodyOverride: unknown
let postFailure: AxiosError | undefined
/** The server APPLIES the transition, then the answer is lost / the request fails (S-A). */
let failAfterApply: AxiosError | undefined
let getLifecycleFailure: AxiosError | undefined
/** When set, a POST waits for this promise (to hold a request in flight). */
let postGate: Promise<void> | undefined

function lifecycleBody() {
  return lifecycleBodyOverride ?? {
    exerciseId: serverExerciseId,
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

/** The 200 body of a transition: the lifecycle body, naming `postAnswerExerciseId` if it is set. */
function transitionAnswer(): unknown {
  const body = lifecycleBody()
  return postAnswerExerciseId !== undefined && typeof body === 'object' && body !== null
    ? { ...body, exerciseId: postAnswerExerciseId }
    : body
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
  serverExerciseId = 'ex-live-0001'
  postAnswerExerciseId = undefined
  scopeGate = undefined
  lifecycleBodyOverride = undefined
  postFailure = undefined
  failAfterApply = undefined
  getLifecycleFailure = undefined
  postGate = undefined

  getSpy = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/exercise-context') {
      if (scopeGate !== undefined && postSpy.mock.calls.length > 0) await scopeGate
      return {
        data: {
          exerciseId: serverExerciseId,
          // The PARTICIPANT-facing name differs on purpose: staff labels show the internal one.
          exerciseName: serverExerciseId === 'ex-live-0001' ? 'Harbor Town' : null,
          timeZone: 'America/New_York',
          status: serverState,
        },
      }
    }
    if (url === '/staff/assignments') {
      // The staff label is the INTERNAL name from the assignments (story 09), never the
      // participant-facing scope name (which the scope above may even send as null).
      return {
        data: [
          { exerciseId: 'ex-live-0001', exerciseName: 'Coastal Surge (live)', role: 'controller', personId: 'p-1', isLead: true },
          { exerciseId: 'ex-other-9999', exerciseName: 'Harbor Drill (other)', role: 'controller', personId: 'p-1', isLead: false },
        ],
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
    if (failAfterApply !== undefined) throw failAfterApply
    return { data: transitionAnswer() }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetLifecycleMock()
})

const lifecycleReads = () => getSpy.mock.calls.filter(call => call[0] === LIFECYCLE_PATH)
const scopeReads = () => getSpy.mock.calls.filter(call => call[0] === '/exercise-context')

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
      state: 'staged',
      storedStatus: 'staged',
      allowedTransitions: ['live', 'teleported'],
    }
    renderControl({ withHeader: true })
    await scopeResolved()

    expect(await screen.findByRole('button', { name: /start exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /end exercise/i })).not.toBeInTheDocument()
  })
})

describe('ExerciseLifecycleControl (live) -- failures are visible text', () => {
  it('a Start refused because the exercise has MOVED ON still shows the server\'s own sentence, and the buttons tell the truth', async () => {
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    const start = await screen.findByRole('button', { name: /start exercise/i })
    const readsBefore = lifecycleReads().length
    // Another controller started the exercise AND ended it: our Start is now completed -> live.
    serverState = 'completed'

    await user.click(start)

    const alert = await screen.findByTestId('lifecycle-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('The exercise state was not changed.')
    expect(alert).toHaveTextContent(
      "'completed' -> 'live' is not an allowed lifecycle transition (allowed from 'completed': archived).",
    )
    // S-1: the exercise scope was re-resolved too, so the header pill stops showing the old state.
    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
    // The lifecycle was re-read, so the control offers what is actually possible: nothing.
    await waitFor(() => expect(lifecycleReads().length).toBeGreaterThan(readsBefore))
    await waitFor(() => expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /end exercise/i })).not.toBeInTheDocument()
  })

  it('W-1: a Start refused (409) because another controller already started it is a SUCCESS, announced, with no error', async () => {
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    const start = await screen.findByRole('button', { name: /start exercise/i })
    // Another controller starts the exercise first: our Start is now a live -> live request (409).
    serverState = 'live'

    await user.click(start)

    await waitFor(() => expect(screen.getByTestId('lifecycle-status'))
      .toHaveTextContent('The exercise was already started. The state is now LIVE.'))
    expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    expect(await screen.findByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
    // Focus is never left on <body>: the Start button it was on is gone.
    await waitFor(() => expect(screen.getByRole('group', { name: 'Exercise lifecycle' })).toHaveFocus())
  })

  it.each([
    [401, 'Your console session has expired or has no exercise. Sign in again.'],
    [403, 'Only staff assigned to this exercise can change its state.'],
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

  it.each([
    ['no status at all (the response was lost)', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['a 408 (the request timed out)', httpError(408, undefined)],
    ['a 502 (a proxy cut the response)', httpError(502, undefined)],
    ['a 500 (the server failed after committing)', httpError(500, undefined)],
  ])('S-A / W-1: %s -- the server may have APPLIED it; the console asks, finds it LIVE and reports success', async (_label, failure) => {
    const user = userEvent.setup()
    failAfterApply = failure
    renderControl({ withHeader: true })
    await scopeResolved()
    expect(pillLabel()).toBe('STAGED')
    const readsBefore = lifecycleReads().length
    const scopeBefore = scopeReads().length

    await user.click(await screen.findByRole('button', { name: /start exercise/i }))

    // It re-read the lifecycle and re-resolved the scope, so the screen tells the truth...
    await waitFor(() => expect(lifecycleReads().length).toBeGreaterThan(readsBefore))
    await waitFor(() => expect(scopeReads().length).toBeGreaterThan(scopeBefore))
    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    expect(await screen.findByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
    // ...and it does NOT also say "the state was not changed" beside a screen that says it was.
    expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('lifecycle-status'))
      .toHaveTextContent('The exercise was already started. The state is now LIVE.'))
  })

  it.each([
    ['no status at all (the response was lost)', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['a 504 (a gateway timed out)', httpError(504, undefined)],
  ])('W-1: an End with %s that the server APPLIED closes the dialog as a success, announced, with focus kept', async (_label, failure) => {
    serverState = 'live'
    failAfterApply = failure
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
    // No contradiction: no "not ended" anywhere, in or out of the dialog.
    expect(screen.queryByTestId('end-exercise-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-status'))
      .toHaveTextContent('The exercise had already ended. The state is now ENDEX.')
    expect(screen.getByRole('group', { name: 'Exercise lifecycle' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
  })

  it('W-1: an End refused (409) because ANOTHER controller already ended it is a success: announced, dialog closed, focus on the group, never <body>', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    // Another controller ends the exercise while this one is typing.
    serverState = 'completed'

    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('end-exercise-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('lifecycle-status'))
      .toHaveTextContent('The exercise had already ended. The state is now ENDEX.'))
    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Exercise lifecycle' })).toHaveFocus())
    expect(document.body).not.toHaveFocus()
  })

  it('W-1: an End refused because the exercise moved to something ELSE keeps the reason, and the open dialog is NOT torn down when the buttons behind it go away', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()
    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('Type END to confirm')
    await user.type(field, 'END')
    // The exercise is ended AND archived under the controller: completed -> completed is not the
    // outcome asked for, and there is nothing left to offer.
    serverState = 'archived'

    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    const error = await within(dialog).findByTestId('end-exercise-error')
    expect(error).toHaveTextContent("'archived' -> 'completed' is not an allowed lifecycle transition")
    // The End button behind the dialog is gone (nothing is reachable from archived)...
    await waitFor(() => expect(screen.queryByTestId('lifecycle-end')).not.toBeInTheDocument())
    // ...but the dialog explaining why is still there, with END still typed.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(field).toHaveValue('END')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([400, 401, 403, 404, 429])(
    'S-A: a definitive %i changes nothing the console thinks it knows: no re-read, no scope refresh',
    async status => {
      const user = userEvent.setup()
      postFailure = httpError(status, undefined)
      renderControl({ withHeader: true })
      await scopeResolved()
      const start = await screen.findByRole('button', { name: /start exercise/i })
      const readsBefore = lifecycleReads().length
      const scopeBefore = scopeReads().length

      await user.click(start)
      await screen.findByTestId('lifecycle-error')
      await new Promise(resolve => setTimeout(resolve, 30))

      expect(lifecycleReads()).toHaveLength(readsBefore)
      expect(scopeReads()).toHaveLength(scopeBefore)
      expect(pillLabel()).toBe('STAGED')
    },
  )

  it('S-A: when the server cannot be reached at all the scope is left alone (a failed refresh would fail the provider closed)', async () => {
    const user = userEvent.setup()
    postFailure = new AxiosError('Network Error', 'ERR_NETWORK')
    renderControl({ withHeader: true })
    await scopeResolved()
    const start = await screen.findByRole('button', { name: /start exercise/i })
    const scopeBefore = scopeReads().length
    // The re-read will fail too.
    getLifecycleFailure = new AxiosError('Network Error', 'ERR_NETWORK')

    await user.click(start)

    expect(await screen.findByTestId('lifecycle-error')).toHaveTextContent('could not be reached')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(scopeReads()).toHaveLength(scopeBefore)
    // The console is still standing.
    expect(screen.getByTestId('staff-header')).toBeInTheDocument()
    expect(pillLabel()).toBe('STAGED')
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

describe('ExerciseLifecycleControl (live) -- the server\'s exercise must be the one shown (S-3)', () => {
  it('offers NOTHING when the lifecycle answer is for a DIFFERENT exercise, says so, and re-resolves the scope', async () => {
    // A duplicated tab: another tab switched the session\'s active exercise to ex-other-9999.
    lifecycleBodyOverride = {
      exerciseId: 'ex-other-9999',
      state: 'live',
      storedStatus: 'live',
      allowedTransitions: ['paused', 'completed'],
    }
    renderControl({ withHeader: true })
    await scopeResolved()
    const scopeBefore = scopeReads().length

    const alert = await screen.findByTestId('lifecycle-load-error')
    expect(alert).toHaveTextContent('different exercise than this console shows')
    expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
    // The console catches up: the scope is asked again (once per answer, never in a loop).
    await waitFor(() => expect(scopeReads().length).toBeGreaterThan(scopeBefore))
    await new Promise(resolve => setTimeout(resolve, 30))
    const settled = scopeReads().length
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(scopeReads().length).toBe(settled)
  })

  it('still offers its buttons when the echo is the console\'s exercise in a different letter case', async () => {
    lifecycleBodyOverride = {
      exerciseId: 'EX-LIVE-0001',
      state: 'staged',
      storedStatus: 'staged',
      allowedTransitions: ['live'],
    }
    renderControl({ withHeader: true })
    await scopeResolved()

    expect(await screen.findByRole('button', { name: /start exercise/i })).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-load-error')).not.toBeInTheDocument()
  })

  // Copilot review on #484: the SUCCESS answer names an exercise too. A duplicated tab whose
  // session was switched to another exercise (by the other tab) still shows the old one; the POST
  // then lands on the SESSION's exercise, and its 200 answer is for that one, not the one shown.
  describe('a SUCCESSFUL transition whose answer is for a DIFFERENT exercise than the one shown', () => {
    const NOT_CONFIRMED = 'not confirmed for the one on screen'

    it('Start: is not announced as started, offers nothing for the shown exercise, says what happened, and re-resolves the scope', async () => {
      const user = userEvent.setup()
      renderControl({ withHeader: true })
      await scopeResolved()
      const start = await screen.findByRole('button', { name: /start exercise/i })
      // The other tab switched the session to another exercise AFTER this tab drew its buttons.
      serverExerciseId = 'ex-other-9999'
      const scopeBefore = scopeReads().length

      await user.click(start)

      expect(postSpy).toHaveBeenCalledTimes(1) // the request did go out: it was applied, elsewhere
      // The words are truthful: applied to the session's exercise, not confirmed for this one.
      const alert = await screen.findByTestId('lifecycle-error')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent('different exercise than the one this console shows')
      expect(alert).toHaveTextContent(NOT_CONFIRMED)
      // Never announced: not "started", and not an "already" either.
      expect(screen.getByTestId('lifecycle-status')).toBeEmptyDOMElement()
      expect(document.body).not.toHaveTextContent(/Exercise (started|ended)/)
      // The scope was re-resolved, so the console catches up with the session.
      await waitFor(() => expect(scopeReads().length).toBeGreaterThan(scopeBefore))
      await waitFor(() => expect(screen.getByTestId('staff-header')).toHaveTextContent('Harbor Drill'))
      expect(screen.getByTestId('lifecycle-status')).toBeEmptyDOMElement()
    })

    it('Start: while the scope is still catching up, the shown exercise\'s buttons are already gone (fail closed)', async () => {
      const user = userEvent.setup()
      renderControl({ withHeader: true })
      await scopeResolved()
      const start = await screen.findByRole('button', { name: /start exercise/i })
      serverExerciseId = 'ex-other-9999'
      let releaseScope: () => void = () => undefined
      scopeGate = new Promise<void>(resolve => { releaseScope = resolve })

      await user.click(start)

      // The refresh has not landed, yet nothing is offered for the exercise on screen: the answer
      // is held in the cache and the control is in its existing "different exercise" state.
      await screen.findByTestId('lifecycle-error')
      expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
      expect(screen.getByTestId('lifecycle-load-error'))
        .toHaveTextContent('different exercise than this console shows')
      expect(screen.getByTestId('lifecycle-status')).toBeEmptyDOMElement()
      releaseScope()
      await waitFor(() => expect(screen.getByTestId('staff-header')).toHaveTextContent('Harbor Drill'))
    })

    it('End: the dialog is NOT closed as a success and nothing is announced as ended; it explains itself, and Cancel closes it', async () => {
      serverState = 'live'
      const user = userEvent.setup()
      renderControl({ withHeader: true })
      await scopeResolved()
      await user.click(await screen.findByRole('button', { name: /end exercise/i }))
      const dialog = await screen.findByRole('dialog')
      const field = within(dialog).getByLabelText('Type END to confirm')
      await user.type(field, 'END')
      serverExerciseId = 'ex-other-9999' // the session moved while this tab sat on the old exercise
      const scopeBefore = scopeReads().length

      await user.click(within(dialog).getByTestId('end-exercise-confirm'))

      // The dialog stays and says, in text, that this is not confirmed for the exercise on screen.
      const error = await within(dialog).findByTestId('end-exercise-error')
      expect(error).toHaveAttribute('role', 'alert')
      expect(error).toHaveTextContent('different exercise than the one this console shows')
      expect(error).toHaveTextContent(NOT_CONFIRMED)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(field).toHaveValue('END')
      expect(screen.getByTestId('lifecycle-status')).toBeEmptyDOMElement()
      expect(document.body).not.toHaveTextContent(/Exercise (started|ended)/)
      await waitFor(() => expect(scopeReads().length).toBeGreaterThan(scopeBefore))
      await waitFor(() => expect(screen.getByTestId('staff-header')).toHaveTextContent('Harbor Drill'))

      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // Cancelling clears the notice, and nothing was ever announced as a success. (With the
      // session's exercise ended there is nothing to press, so the group itself may be gone.)
      expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('lifecycle-status')?.textContent ?? '').toBe('')
    })

    it('the same exercise in a different letter case is still a plain success', async () => {
      const user = userEvent.setup()
      renderControl({ withHeader: true })
      await scopeResolved()
      const start = await screen.findByRole('button', { name: /start exercise/i })
      const scopeBefore = scopeReads().length
      postAnswerExerciseId = 'EX-LIVE-0001' // the console's exercise, only the letter case differs

      await user.click(start)

      await waitFor(() => expect(screen.getByTestId('lifecycle-status'))
        .toHaveTextContent('Exercise started. The state is now LIVE.'))
      expect(screen.queryByTestId('lifecycle-error')).not.toBeInTheDocument()
      await waitFor(() => expect(scopeReads().length).toBeGreaterThan(scopeBefore))
    })
  })

  it('names the exercise in the End dialog', async () => {
    serverState = 'live'
    const user = userEvent.setup()
    renderControl({ withHeader: true })
    await scopeResolved()

    await user.click(await screen.findByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByTestId('end-exercise-name')).toHaveTextContent('Coastal Surge (live)')
    expect(within(dialog).queryByText(/Harbor Town/)).toBeNull()
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

    const confirm = within(dialog).getByTestId('end-exercise-confirm')
    await waitFor(() => expect(confirm).toHaveTextContent('Ending…'))
    // S-2: `aria-disabled`, NOT `disabled` -- the control that holds focus keeps it mid-request.
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(confirm).not.toBeDisabled()
    expect(confirm).toHaveFocus()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('aria-disabled', 'true')
    expect(cancel).not.toBeDisabled()
    const field = within(dialog).getByLabelText('Type END to confirm')
    expect(field).toHaveAttribute('readonly')
    expect(field).not.toBeDisabled()
    // ...and none of them does anything while the request is in flight.
    await user.click(cancel)
    await user.keyboard('{Escape}')
    await user.click(confirm)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(postSpy).toHaveBeenCalledTimes(1)

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
  it('renders nothing and issues NO request for an evaluator SESSION', async () => {
    renderControl({ sessionRole: 'evaluator', withHeader: true })
    await scopeResolved()
    // Let any would-be query settle.
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
    expect(lifecycleReads()).toHaveLength(0)
    expect(postSpy).not.toHaveBeenCalled()
  })
})
