/**
 * features/participant-shell/channelRouter/returnTo.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 12 (#708), "deep links survive login": the return-to
 * helper, and the round trip through the REAL `SessionProvider` (signed-out
 * redirect remembers the permalink) and `completeSignIn` (the hand-off takes
 * it). Only `resolveSession` is stubbed, to the signed-out failure.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider, clearTokens } from '@/core/auth'
import { resolveSession } from '@/core/auth/sessionResolver'
import { wallClockNowIso } from '@/core/time/wallClock'
import { completeSignIn } from '@/features/login/completeSignIn'
import {
  RETURN_TO_STORAGE_KEY,
  RETURN_TO_TTL_MS,
  isSafeReturnToPath,
  rememberReturnTo,
  takeReturnTo,
} from './returnTo'

vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: vi.fn(),
}))

const PERMALINK = '/news/newsline-7/emergency-call-delays'

beforeEach(() => {
  window.localStorage.removeItem(RETURN_TO_STORAGE_KEY)
  clearTokens()
})

afterEach(() => {
  clearTokens()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isSafeReturnToPath', () => {
  it.each([PERMALINK, '/home', '/weather/zones/north?x=1#top', '/portal'])('keeps %s', path => {
    expect(isSafeReturnToPath(path)).toBe(true)
  })

  it.each([
    '/',
    '',
    'news/x',
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example/news/x',
    '/javascript:alert(1)',
    '/login',
    '/join/abc',
    '/STAFF/console',
    '/news/\nx',
    `/${'a'.repeat(600)}`,
    42,
    null,
  ])('refuses %s', path => {
    expect(isSafeReturnToPath(path)).toBe(false)
  })
})

describe('remember / take', () => {
  it('returns the remembered path once, then forgets it', () => {
    rememberReturnTo(PERMALINK)

    expect(takeReturnTo()).toBe(PERMALINK)
    expect(takeReturnTo()).toBeNull()
  })

  it('does not keep an unsafe path, and an unsafe one clears an older entry', () => {
    rememberReturnTo(PERMALINK)
    rememberReturnTo('//evil.example')

    expect(takeReturnTo()).toBeNull()
  })

  it('expires after the TTL, so a stale link never hijacks a later sign-in', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z') })
    rememberReturnTo(PERMALINK)
    vi.setSystemTime(new Date(Date.parse('2026-11-02T12:00:00Z') + RETURN_TO_TTL_MS + 1))

    expect(takeReturnTo()).toBeNull()
  })

  it('re-checks a stored entry on read (storage can be edited)', () => {
    window.localStorage.setItem(
      RETURN_TO_STORAGE_KEY,
      JSON.stringify({ path: '//evil.example', savedAt: Date.parse(wallClockNowIso()) }),
    )
    expect(takeReturnTo()).toBeNull()

    window.localStorage.setItem(RETURN_TO_STORAGE_KEY, 'not json')
    expect(takeReturnTo()).toBeNull()
  })
})

describe('deep link survives login (round trip)', () => {
  function LoginPage() {
    const { pathname } = useLocation()
    return <p data-testid="login-page">{pathname}</p>
  }

  function Arrived() {
    const { pathname } = useLocation()
    return <p data-testid="arrived">{pathname}</p>
  }

  it('a signed-out visitor to a permalink is sent to /login and arrives at the permalink after', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolveSession).mockRejectedValue(new Error('signed out'))

    render(
      <MemoryRouter initialEntries={[PERMALINK]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<SessionProvider><p>fiction</p></SessionProvider>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('login-page')).toHaveTextContent('/login')

    // The participant sign-in pages hand off through completeSignIn with takeReturnTo().
    const navigate = vi.fn()
    completeSignIn({ token: 't', refreshToken: 'r' }, {
      persist: true,
      navigate,
      returnTo: takeReturnTo(),
    })
    expect(navigate).toHaveBeenCalledWith(PERMALINK, { replace: true })

    render(
      <MemoryRouter initialEntries={[navigate.mock.calls[0]?.[0] as string]}>
        <Arrived />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('arrived')).toHaveTextContent(PERMALINK)
  })

  it('a signed-out visit to a staff path is not remembered (participant-only)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolveSession).mockRejectedValue(new Error('signed out'))

    render(
      <MemoryRouter initialEntries={['/staff/console']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<SessionProvider><p>console</p></SessionProvider>} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByTestId('login-page')
    expect(takeReturnTo()).toBeNull()
  })

  it('with nothing remembered the hand-off goes to / (the landing entry)', () => {
    const navigate = vi.fn()
    completeSignIn({ token: 't', refreshToken: 'r' }, {
      persist: true,
      navigate,
      returnTo: takeReturnTo(),
    })
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })
})
