/**
 * features/login/completeSignIn.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-2: every sign-in completion stores the pair, forgets the previous
 * identity's client state, and only then navigates - from ONE helper, so the join page,
 * the participant sign-in page and the staff sign-in page cannot drift.
 *
 * Three layers, because each catches what the others cannot:
 *  1. ORDER and ARGUMENTS, with `@/core/auth` spied: setTokens, then resetClientSession,
 *     then the caller's client, then navigate('/', { replace: true }); persist true/false
 *     reach `setTokens` as the participant / staff store choice.
 *  2. REAL STATE, with the real token store and the real reset: the pair lands in the
 *     right Web Storage, and a cached query and an own-post from the PREVIOUS identity
 *     are gone afterwards (the user-visible bug the helper exists to prevent).
 *  3. A SOURCE SCAN of the three pages: each one finishes through `completeSignIn` and
 *     none stores tokens itself, so a fourth sign-in path that forgets the reset fails
 *     here instead of in front of a user on a shared device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientSession, setTokens } from '@/core/auth'
import { completeSignIn, SIGNED_IN_PATH } from './completeSignIn'

vi.mock('@/core/auth', () => ({
  setTokens: vi.fn(),
  resetClientSession: vi.fn(),
}))

const mockSetTokens = vi.mocked(setTokens)
const mockReset = vi.mocked(resetClientSession)

const PAIR = { token: 'access-1', refreshToken: 'refresh-1' }

beforeEach(() => {
  mockSetTokens.mockReset()
  mockReset.mockReset()
})

describe('completeSignIn - order and arguments', () => {
  it('stores the pair, resets the session, clears the caller\'s client, then navigates (replace)', () => {
    const calls: string[] = []
    mockSetTokens.mockImplementation(() => { calls.push('setTokens') })
    mockReset.mockImplementation(() => { calls.push('resetClientSession') })
    const queryClient = { clear: vi.fn(() => { calls.push('queryClient.clear') }) }
    const navigate = vi.fn(() => { calls.push('navigate') })

    completeSignIn(PAIR, { persist: true, navigate, queryClient })

    expect(calls).toEqual(['setTokens', 'resetClientSession', 'queryClient.clear', 'navigate'])
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
    expect(SIGNED_IN_PATH).toBe('/')
  })

  it('persist: true stores in the participant (localStorage) store', () => {
    completeSignIn(PAIR, { persist: true, navigate: vi.fn() })
    expect(mockSetTokens).toHaveBeenCalledTimes(1)
    expect(mockSetTokens).toHaveBeenCalledWith(PAIR, { persist: true })
  })

  it('persist: false passes NO options, so the token store\'s own session default applies', () => {
    completeSignIn(PAIR, { persist: false, navigate: vi.fn() })
    expect(mockSetTokens).toHaveBeenCalledTimes(1)
    expect(mockSetTokens.mock.calls[0]).toEqual([PAIR])
  })

  it('works without a caller client (the shared one is cleared by resetClientSession)', () => {
    const navigate = vi.fn()
    expect(() => completeSignIn(PAIR, { persist: false, navigate })).not.toThrow()
    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does nothing before it is called and navigates exactly once', () => {
    const navigate = vi.fn()
    expect(mockSetTokens).not.toHaveBeenCalled()
    completeSignIn(PAIR, { persist: true, navigate })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('passes a refresh-less pair through untouched (the view-only code has none)', () => {
    const pair = { token: 'access-only' }
    completeSignIn(pair, { persist: true, navigate: vi.fn() })
    expect(mockSetTokens).toHaveBeenCalledWith(pair, { persist: true })
  })
})

describe('completeSignIn - the three pages all finish through it', () => {
  const pages = import.meta.glob(
    ['./pages/JoinPage.tsx', './pages/ParticipantSignInPage.tsx', './pages/StaffSignInPage.tsx'],
    { eager: true, query: '?raw', import: 'default' },
  ) as Record<string, string>

  /** Source with comments removed, so prose that merely MENTIONS a call never trips it. */
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

  it('scans all three pages (cannot pass vacuously)', () => {
    expect(Object.keys(pages).sort()).toEqual([
      './pages/JoinPage.tsx',
      './pages/ParticipantSignInPage.tsx',
      './pages/StaffSignInPage.tsx',
    ])
  })

  it.each([
    './pages/JoinPage.tsx',
    './pages/ParticipantSignInPage.tsx',
    './pages/StaffSignInPage.tsx',
  ])('%s calls completeSignIn and never stores tokens or resets by itself', path => {
    const source = code(pages[path] ?? '')
    expect(source).toMatch(/\bcompleteSignIn\(/)
    expect(source).toMatch(/from '\.\.\/completeSignIn'/)
    // The pieces live in the helper only: a page that called these directly could skip one.
    expect(source).not.toMatch(/\bsetTokens\(/)
    expect(source).not.toMatch(/\bresetClientSession\(/)
    expect(source).not.toMatch(/\bnavigate\(/)
  })

  it('the participant pages persist and the staff page does not (read from the call itself)', () => {
    // Anchored to the `completeSignIn(...)` call's own argument list, not the whole file: a page
    // that merely MENTIONS `persist: true` elsewhere (a constant, a sibling call) must not pass.
    const persistOf = (path: string): string | undefined =>
      /\bpersist:\s*(true|false)\b/.exec(callArguments(code(pages[path] ?? ''), 'completeSignIn'))?.[1]

    expect(persistOf('./pages/JoinPage.tsx')).toBe('true')
    expect(persistOf('./pages/ParticipantSignInPage.tsx')).toBe('true')
    expect(persistOf('./pages/StaffSignInPage.tsx')).toBe('false')
  })

  it('the call-anchored scan is not fooled by a `persist` that sits outside the call', () => {
    const decoy = [
      "import { completeSignIn } from '../completeSignIn'",
      'const persist = { persist: true }',
      'function finish() {',
      '  completeSignIn(pair, { persist: false, navigate })',
      '}',
    ].join('\n')

    expect(callArguments(decoy, 'completeSignIn')).toContain('persist: false')
    expect(callArguments(decoy, 'completeSignIn')).not.toContain('persist: true')
    // A name that is only imported, never called, has no arguments at all.
    expect(callArguments("import { completeSignIn } from '../completeSignIn'", 'completeSignIn')).toBe('')
    // Parentheses inside the arguments do not end the scan early.
    expect(callArguments('completeSignIn(f(a), { persist: true }) ; g(persist: false)', 'completeSignIn'))
      .toBe('f(a), { persist: true }')
  })
})

/**
 * The text between the parentheses of the first CALL `name(...)` in `source` (balanced, so
 * nested calls are included), or '' when it is never called. An import of the name has no
 * `(` after it and so does not count.
 */
function callArguments(source: string, name: string): string {
  const start = new RegExp(`\\b${name}\\(`).exec(source)
  if (start === null) return ''
  const open = start.index + start[0].length
  let depth = 1
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (depth === 0) return source.slice(open, index)
  }
  return source.slice(open)
}
