/**
 * features/controller/noise/NoiseControl.test.tsx
 * ---------------------------------------------------------------------------
 * Story 09 AC1/AC2 + the radio-group a11y AC, against the LIVE path (USE_MOCK_DATA off) with the
 * shared hub connection and the console's pause tier replaced by test doubles:
 *   - reads GET /staff/noise on mount: level, "N posts/min", pool size and posted count;
 *   - level change round trip (PUT, then the server's state) and a visible error that falls back
 *     to the server's level;
 *   - a NoiseStateChanged frame on the shared connection updates the knob;
 *   - stopped reasons in words (frozen, ended, paused, clock, empty pool);
 *   - keyboard: one tab stop, arrows move and choose (wrapping) from the focused option,
 *     Home / End;
 *   - Gate-1 folds (fake timers where time matters): the tier re-read waits ~500 ms for the pause
 *     POST to settle (M1); the 20 s poll runs only while a level is set and the tab is visible
 *     (M1); writes are serialised and an exercise switch mid-write never strands the next choice
 *     (M2); a successful write clears an earlier error (L1); a write with no answer re-reads (L2).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import type { PauseTier } from '../hooks/usePauseState'
import { NoiseControl } from './NoiseControl'
import { hasPseudoHitSlop, mediaRuleDeclarations } from '../consoleTouchTestUtils'
import type { NoiseLevel, NoiseStateDto } from './noiseTypes'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))

const doubles = vi.hoisted(() => {
  type Handler = (payload: unknown) => void
  const handlers = new Map<string, Set<Handler>>()
  return {
    tier: 'running' as string,
    exerciseId: 'ex-noise-1',
    status: 'live' as string,
    handlers,
    emit(eventName: string, payload: unknown) {
      handlers.get(eventName)?.forEach(handler => handler(payload))
    },
  }
})

vi.mock('@/core/realtime/connection', () => ({
  HubConnectionState: {
    Connected: 'Connected',
    Reconnecting: 'Reconnecting',
    Disconnected: 'Disconnected',
  },
  realtimeConnection: {
    subscribe(eventName: string, handler: (payload: unknown) => void) {
      const set = doubles.handlers.get(eventName) ?? new Set()
      set.add(handler)
      doubles.handlers.set(eventName, set)
      return () => {
        set.delete(handler)
      }
    },
    onStateChange: () => () => undefined,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    state: 'Connected',
  },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: doubles.exerciseId,
    status: doubles.status,
    timeZone: 'UTC',
  }),
}))

vi.mock('../hooks/usePauseState', () => ({
  usePauseState: () => ({ tier: doubles.tier as PauseTier }),
}))

const RATES: Record<NoiseLevel, number> = { off: 0, low: 2, medium: 6, high: 15 }

function stateFor(level: NoiseLevel, overrides: Partial<NoiseStateDto> = {}): NoiseStateDto {
  return {
    level,
    ratePerMinute: RATES[level],
    poolSize: 40,
    postedCount: 12,
    running: level !== 'off',
    ...overrides,
  }
}

function ok(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
}

let server: NoiseStateDto
let getSpy: MockInstance<typeof api.get>
let putSpy: MockInstance<typeof api.put>

beforeEach(() => {
  doubles.tier = 'running'
  doubles.exerciseId = 'ex-noise-1'
  doubles.status = 'live'
  doubles.handlers.clear()
  server = stateFor('off')
  getSpy = vi.spyOn(api, 'get').mockImplementation(() => Promise.resolve(ok(server)))
  putSpy = vi.spyOn(api, 'put').mockImplementation((_url, body) => {
    const level = (body as { level: NoiseLevel }).level
    server = stateFor(level, { postedCount: server.postedCount })
    return Promise.resolve(ok(server))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function knob() {
  return (
    <ThemeProvider theme={cobraTheme}>
      <NoiseControl />
    </ThemeProvider>
  )
}

function radio(name: string) {
  const group = screen.getByRole('radiogroup', { name: 'White noise' })
  return within(group).getByRole('radio', { name })
}

/** Advances fake time by `ms` and lets the answered requests and React settle. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** A PUT answer the test releases by hand. */
function holdNextPut() {
  let release: (response: AxiosResponse) => void = () => undefined
  let fail: (error: unknown) => void = () => undefined
  putSpy.mockImplementationOnce(
    () => new Promise<AxiosResponse>((resolve, reject) => {
      release = resolve
      fail = reject
    }),
  )
  return {
    release: (response: AxiosResponse) => act(async () => release(response)),
    fail: (error: unknown) => act(async () => fail(error)),
  }
}

function putLevels(): unknown[] {
  return putSpy.mock.calls.map(call => (call[1] as { level: string }).level)
}

describe('NoiseControl (live)', () => {
  it('reads the state on mount and shows the level, rate, pool size and posted count', async () => {
    server = stateFor('medium')
    render(knob())

    await waitFor(() => expect(radio('Medium')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText('White noise')).toBeVisible()
    expect(screen.getByTestId('noise-rate')).toHaveTextContent('6 posts/min')
    expect(screen.getByTestId('noise-counts')).toHaveTextContent('40 in pool · 12 posted')
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Running')
    expect(getSpy).toHaveBeenCalledWith('/staff/noise', expect.any(Object))
  })

  it('round-trips a level change through PUT /staff/noise', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    await user.click(radio('High'))

    expect(putSpy).toHaveBeenCalledWith('/staff/noise', { level: 'high' }, expect.any(Object))
    await waitFor(() => expect(screen.getByTestId('noise-rate')).toHaveTextContent('15 posts/min'))
    expect(radio('High')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Off')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Running')
  })

  it('shows a failed change as text and falls back to the server level', async () => {
    const user = userEvent.setup()
    const config = { headers: new AxiosHeaders() }
    putSpy.mockRejectedValue(
      new AxiosError('403', 'ERR_BAD_REQUEST', config, null, {
        data: undefined,
        status: 403,
        statusText: 'Forbidden',
        headers: new AxiosHeaders(),
        config,
      }),
    )
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    await user.click(radio('Low'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only a controller can change white noise.',
    )
    expect(radio('Off')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Low')).toHaveAttribute('aria-checked', 'false')
  })

  it('stays live from NoiseStateChanged on the shared connection', async () => {
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    act(() => {
      doubles.emit('NoiseStateChanged', stateFor('low', { postedCount: 13 }))
    })

    expect(radio('Low')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('noise-rate')).toHaveTextContent('2 posts/min')
    expect(screen.getByTestId('noise-counts')).toHaveTextContent('40 in pool · 13 posted')
  })

  it('says frozen under Freeze, and re-reads ~500 ms after the tier changes', async () => {
    vi.useFakeTimers()
    server = stateFor('medium')
    const view = render(knob())
    await flush()
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Running')
    expect(getSpy).toHaveBeenCalledTimes(1)

    doubles.tier = 'freeze'
    server = stateFor('medium', { running: false })
    view.rerender(knob())

    expect(screen.getByTestId('noise-status')).toHaveTextContent('Stopped: the world is frozen')
    await flush(499)
    expect(getSpy).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(getSpy).toHaveBeenCalledTimes(2)

    // Resume: the re-read after the POST settles brings back the server's Running.
    doubles.tier = 'running'
    server = stateFor('medium')
    view.rerender(knob())
    await flush(500)
    expect(getSpy).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('noise-status')).toHaveTextContent('Running')
  })

  it.each([
    ['completed', 'Stopped: the exercise has ended'],
    ['archived', 'Stopped: the exercise has ended'],
    ['paused', 'Stopped: the exercise is paused'],
  ])('names a %s lifecycle as the stop', async (status, text) => {
    doubles.status = status
    server = stateFor('low', { running: false })
    render(knob())
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('says the clock is not running when the server reports a stop outside Freeze', async () => {
    server = stateFor('low', { running: false })
    render(knob())
    expect(await screen.findByText('Stopped: the clock is not running')).toBeInTheDocument()
  })

  it('says the pool is empty', async () => {
    server = stateFor('high', { poolSize: 0, running: false })
    render(knob())
    expect(await screen.findByText('No posts in the pool')).toBeInTheDocument()
  })

  it('is a keyboard radio group: one tab stop, arrows choose and wrap, Home / End', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    expect(radio('Off')).toHaveAttribute('tabindex', '0')
    expect(radio('Low')).toHaveAttribute('tabindex', '-1')

    await user.tab()
    expect(radio('Off')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(radio('Low')).toHaveFocus()
    await waitFor(() => expect(radio('Low')).toHaveAttribute('aria-checked', 'true'))

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(radio('Medium')).toHaveAttribute('aria-checked', 'true'))
    expect(radio('Medium')).toHaveFocus()

    await user.keyboard('{End}')
    await waitFor(() => expect(radio('High')).toHaveAttribute('aria-checked', 'true'))

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    expect(radio('Off')).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(radio('High')).toHaveAttribute('aria-checked', 'true'))

    await user.keyboard('{Home}')
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    await waitFor(() => expect(putLevels().at(-1)).toBe('off'))
    expect(putLevels()).toEqual(expect.arrayContaining(['low', 'medium', 'high', 'off']))
  })

  it('moves from the FOCUSED option, not the selected one', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))

    act(() => radio('Medium').focus())
    await user.keyboard('{ArrowRight}')

    await waitFor(() => expect(radio('High')).toHaveAttribute('aria-checked', 'true'))
    expect(putLevels()).toEqual(['high'])
  })
})

describe('NoiseControl (Gate-1 folds)', () => {
  it('serialises writes: a choice made mid-write waits, and only the latest is sent', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    const first = holdNextPut()

    await user.click(radio('Low'))
    await user.click(radio('Medium'))
    await user.click(radio('High'))
    expect(putLevels()).toEqual(['low'])
    expect(radio('High')).toHaveAttribute('aria-checked', 'true')

    await first.release(ok(stateFor('low')))

    await waitFor(() => expect(putLevels()).toEqual(['low', 'high']))
    await waitFor(() => expect(screen.getByTestId('noise-rate')).toHaveTextContent('15 posts/min'))
    expect(radio('High')).toHaveAttribute('aria-checked', 'true')
  })

  it('an exercise switch mid-write neither adopts its answer nor strands the next choice', async () => {
    const user = userEvent.setup()
    const view = render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    const stale = holdNextPut()
    await user.click(radio('Low'))

    doubles.exerciseId = 'ex-noise-2'
    server = stateFor('medium')
    view.rerender(knob())
    await waitFor(() => expect(radio('Medium')).toHaveAttribute('aria-checked', 'true'))

    await user.click(radio('High'))
    await stale.release(ok(stateFor('low')))

    await waitFor(() => expect(putLevels()).toEqual(['low', 'high']))
    await waitFor(() => expect(screen.getByTestId('noise-rate')).toHaveTextContent('15 posts/min'))
    expect(radio('High')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Low')).toHaveAttribute('aria-checked', 'false')
  })

  it('clears an earlier error when a later write succeeds', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    const first = holdNextPut()

    await user.click(radio('Low'))
    await user.click(radio('High'))
    const config = { headers: new AxiosHeaders() }
    await first.fail(
      new AxiosError('400', 'ERR_BAD_REQUEST', config, null, {
        data: { detail: 'The pool is being replaced.' },
        status: 400,
        statusText: 'Bad Request',
        headers: new AxiosHeaders(),
        config,
      }),
    )

    await waitFor(() => expect(putLevels()).toEqual(['low', 'high']))
    await waitFor(() => expect(screen.getByTestId('noise-rate')).toHaveTextContent('15 posts/min'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('re-reads the state after a write that got no answer', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    const readsBefore = getSpy.mock.calls.length
    putSpy.mockImplementationOnce(() => {
      // The server applied it; only the answer was lost.
      server = stateFor('low')
      return Promise.reject(new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED'))
    })

    await user.click(radio('Low'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/)
    await waitFor(() => expect(getSpy.mock.calls.length).toBe(readsBefore + 1))
    await waitFor(() => expect(radio('Low')).toHaveAttribute('aria-checked', 'true'))
  })

  it('polls every 20 s while a level is set and the tab is visible', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.useFakeTimers()
    server = stateFor('low')
    render(knob())
    await flush()
    expect(getSpy).toHaveBeenCalledTimes(1)

    await flush(19_999)
    expect(getSpy).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(getSpy).toHaveBeenCalledTimes(2)

    // Another console stopped the clock: the poll picks it up.
    server = stateFor('low', { running: false })
    await flush(20_000)
    expect(getSpy).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('noise-status')).toHaveTextContent(
      'Stopped: the clock is not running',
    )

    // A hidden tab does not poll.
    visibility = 'hidden'
    await flush(40_000)
    expect(getSpy).toHaveBeenCalledTimes(3)

    // Off: no poll at all.
    visibility = 'visible'
    act(() => {
      doubles.emit('NoiseStateChanged', stateFor('off'))
    })
    await flush(60_000)
    expect(getSpy).toHaveBeenCalledTimes(3)
  })

  it('does not poll while the level is off', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.useFakeTimers()
    render(knob())
    await flush()
    await flush(60_000)
    expect(getSpy).toHaveBeenCalledTimes(1)
  })
})

describe('NoiseControl — touch targets (story 14, D5-024)', () => {
  it('makes every level a 44x44 pill, 8px apart, inside (pointer: coarse), with no hit-slop', async () => {
    server = stateFor('low')
    render(knob())
    await waitFor(() => expect(radio('Low')).toHaveAttribute('aria-checked', 'true'))

    for (const name of ['Off', 'Low', 'Medium', 'High']) {
      const coarse = mediaRuleDeclarations(radio(name), 'pointer: coarse')
      expect(coarse['min-width']).toBe('44px')
      expect(coarse['min-height']).toBe('44px')
      expect(hasPseudoHitSlop(radio(name))).toBe(false)
    }
    const group = screen.getByTestId('noise-level-group')
    expect(mediaRuleDeclarations(group, 'pointer: coarse').gap).toBe('8px')
  })

  it('a tap on a level is the whole interaction (no hover, no key)', async () => {
    const user = userEvent.setup()
    render(knob())
    await waitFor(() => expect(radio('Off')).toHaveAttribute('aria-checked', 'true'))
    await user.click(radio('Medium'))
    expect(putSpy).toHaveBeenCalledWith('/staff/noise', { level: 'medium' }, expect.any(Object))
  })
})
