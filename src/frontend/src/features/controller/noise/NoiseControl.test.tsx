/**
 * features/controller/noise/NoiseControl.test.tsx
 * ---------------------------------------------------------------------------
 * Story 09 AC1/AC2 + the radio-group a11y AC, against the LIVE path (USE_MOCK_DATA off) with the
 * shared hub connection and the console's pause tier replaced by test doubles:
 *   - reads GET /staff/noise on mount: level, "N posts/min", pool size and posted count;
 *   - level change round trip (PUT, then the server's state) and a visible error that falls back
 *     to the server's level;
 *   - a NoiseStateChanged frame on the shared connection updates the knob;
 *   - stopped reasons in words (frozen, clock, empty pool) and a re-read when the tier changes;
 *   - keyboard: one tab stop, arrows move and choose (wrapping), Home / End.
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
import type { NoiseLevel, NoiseStateDto } from './noiseTypes'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))

const doubles = vi.hoisted(() => {
  type Handler = (payload: unknown) => void
  const handlers = new Map<string, Set<Handler>>()
  return {
    tier: 'running' as string,
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
  useExerciseContext: () => ({ exerciseId: 'ex-noise-1', status: 'live', timeZone: 'UTC' }),
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

  it('says the world is frozen under Freeze, and re-reads when the tier changes', async () => {
    server = stateFor('medium')
    const view = render(knob())
    await waitFor(() => expect(screen.getByTestId('noise-status')).toHaveTextContent('Running'))
    const readsBefore = getSpy.mock.calls.length

    doubles.tier = 'freeze'
    server = stateFor('medium', { running: false })
    view.rerender(knob())

    expect(screen.getByTestId('noise-status')).toHaveTextContent('Stopped: the world is frozen')
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(readsBefore))
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
})
