/**
 * features/social/layout/SocialNavigationProvider.test.tsx
 * ---------------------------------------------------------------------------
 * The two navigation-adapter implementations (demo-polish F1, "Navigation
 * adapter (for C6)" AC):
 *
 *  - the DEFAULT provider wraps React Router: real location, push / replace, and
 *    a Back that falls back to Home when there is no earlier entry;
 *  - the MEMORY provider keeps the location and back stack in React state and
 *    NEVER touches browser history or the surrounding router -- asserted against
 *    the real `window.history` / `window.location` AND the host router's own
 *    location, so a regression that leaks a navigation outward fails here.
 */
import { useEffect, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemorySocialNavigationProvider,
  SocialNavigationProvider,
} from './SocialNavigationProvider'
import {
  useHasSocialNavigation,
  useSocialNavigate,
  useSocialNavigation,
  type SocialNavigation,
} from './socialNavigation'
import { RouterProbe } from './RouterProbe.testUtils'

/** Captures the latest adapter value so a test can drive and inspect it. */
function Capture({ onValue }: { onValue: (nav: SocialNavigation) => void }) {
  const nav = useSocialNavigation()
  useEffect(() => onValue(nav))
  return <output data-testid="adapter-path">{`${nav.location.pathname}${nav.location.search}`}</output>
}

function latest(ref: { current: SocialNavigation | undefined }): SocialNavigation {
  if (ref.current === undefined) throw new Error('adapter not captured')
  return ref.current
}

describe('SocialNavigationProvider (default: React Router)', () => {
  function setup(entries: string[] = ['/home']) {
    const ref: { current: SocialNavigation | undefined } = { current: undefined }
    render(
      <MemoryRouter initialEntries={entries}>
        <SocialNavigationProvider>
          <Capture onValue={nav => { ref.current = nav }} />
        </SocialNavigationProvider>
        <RouterProbe />
      </MemoryRouter>,
    )
    return ref
  }

  it('reports the router location and a kind of "browser"', () => {
    const ref = setup(['/hashtag/zone2?x=1'])
    expect(latest(ref).kind).toBe('browser')
    expect(latest(ref).location.pathname).toBe('/hashtag/zone2')
    expect(latest(ref).location.search).toBe('?x=1')
  })

  it('pushes on navigate and moves the real router with it', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore'))
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/explore')
    expect(screen.getByTestId('router-location')).toHaveTextContent('/explore')
    expect(latest(ref).canGoBack).toBe(true)
  })

  it('goes back to the previous entry when there is one', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore'))
    act(() => latest(ref).back())
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/home')
  })

  it('replaces with the fallback (default /home) when there is no earlier entry', () => {
    const ref = setup(['/explore'])
    expect(latest(ref).canGoBack).toBe(false)
    act(() => latest(ref).back())
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/home')
    // A replace: still no earlier entry to go back to.
    expect(latest(ref).canGoBack).toBe(true) // the replaced entry has a fresh key
    act(() => latest(ref).back('/explore'))
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/home')
  })

  it('replace: true does not add an entry', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore'))
    act(() => latest(ref).navigate('/hashtag/a', { replace: true }))
    act(() => latest(ref).back())
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/home')
  })

  it('keeps navigate / back stable across navigations (memoized rows depend on it)', () => {
    const ref = setup()
    const { navigate, back, getLocationKey } = latest(ref)
    act(() => navigate('/explore'))
    act(() => navigate('/hashtag/a'))
    expect(latest(ref).navigate).toBe(navigate)
    expect(latest(ref).back).toBe(back)
    expect(latest(ref).getLocationKey).toBe(getLocationKey)
  })

  it('getLocationKey() always reads the CURRENT entry\'s key, through a stable function', () => {
    const ref = setup()
    const { getLocationKey, navigate } = latest(ref)
    const first = getLocationKey()
    expect(first).toBe(latest(ref).location.key)

    act(() => navigate('/explore'))
    expect(getLocationKey()).toBe(latest(ref).location.key)
    expect(getLocationKey()).not.toBe(first)
  })
})

describe('MemorySocialNavigationProvider (no browser history)', () => {
  let pushState: ReturnType<typeof vi.spyOn>
  let replaceState: ReturnType<typeof vi.spyOn>
  const startUrl = window.location.href

  beforeEach(() => {
    pushState = vi.spyOn(window.history, 'pushState')
    replaceState = vi.spyOn(window.history, 'replaceState')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup(initialEntries?: string[], host: ReactNode = null) {
    const ref: { current: SocialNavigation | undefined } = { current: undefined }
    render(
      <MemoryRouter initialEntries={['/staff/console']}>
        <MemorySocialNavigationProvider
          {...(initialEntries !== undefined ? { initialEntries } : {})}
        >
          <Capture onValue={nav => { ref.current = nav }} />
        </MemorySocialNavigationProvider>
        <RouterProbe />
        {host}
      </MemoryRouter>,
    )
    return ref
  }

  it('starts at /home by default and reports kind "memory"', () => {
    const ref = setup()
    expect(latest(ref).kind).toBe('memory')
    expect(latest(ref).location.pathname).toBe('/home')
    expect(latest(ref).canGoBack).toBe(false)
  })

  it('honors initialEntries', () => {
    const ref = setup(['/home', '/explore'])
    expect(latest(ref).location.pathname).toBe('/explore')
    expect(latest(ref).canGoBack).toBe(true)
  })

  it('pushes, goes back, and falls back — all in memory', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/hashtag/zone2'))
    act(() => latest(ref).navigate('/FulcoEM/status/post-1'))
    expect(latest(ref).location.pathname).toBe('/FulcoEM/status/post-1')
    act(() => latest(ref).back())
    expect(latest(ref).location.pathname).toBe('/hashtag/zone2')
    act(() => latest(ref).back())
    expect(latest(ref).location.pathname).toBe('/home')
    // Nothing earlier: replace with the fallback instead of dead-ending.
    act(() => latest(ref).back('/explore'))
    expect(latest(ref).location.pathname).toBe('/explore')
    expect(latest(ref).canGoBack).toBe(false)
  })

  it('truncates forward entries when pushing after a back', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore'))
    act(() => latest(ref).back())
    act(() => latest(ref).navigate('/hashtag/a'))
    act(() => latest(ref).back())
    expect(latest(ref).location.pathname).toBe('/home')
    act(() => latest(ref).back('/explore'))
    expect(latest(ref).location.pathname).toBe('/explore') // /home was the only entry
  })

  it('treats navigating to the current path as a replace (no duplicate entry)', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/home'))
    act(() => latest(ref).navigate('/home'))
    expect(latest(ref).canGoBack).toBe(false)
  })

  it('parses search and hash into the location', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore?q=boil#top'))
    expect(latest(ref).location.search).toBe('?q=boil')
    expect(latest(ref).location.hash).toBe('#top')
  })

  it('never touches browser history, the address bar, or the host router', () => {
    const ref = setup()
    act(() => latest(ref).navigate('/explore'))
    act(() => latest(ref).navigate('/hashtag/a'))
    act(() => latest(ref).back())
    act(() => latest(ref).navigate('/x/status/1', { replace: true }))
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.location.href).toBe(startUrl)
    // The host (staff) router is exactly where it was.
    expect(screen.getByTestId('router-location')).toHaveTextContent('/staff/console')
  })

  it('keeps navigate / back stable across navigations', () => {
    const ref = setup()
    const { navigate, back, getLocationKey } = latest(ref)
    act(() => navigate('/explore'))
    expect(latest(ref).navigate).toBe(navigate)
    expect(latest(ref).back).toBe(back)
    expect(latest(ref).getLocationKey).toBe(getLocationKey)
  })

  it('getLocationKey() reads the current entry\'s key, and a back changes it', () => {
    const ref = setup()
    const { getLocationKey, navigate, back } = latest(ref)
    const home = getLocationKey()
    act(() => navigate('/explore'))
    const explore = getLocationKey()
    expect(explore).toBe(latest(ref).location.key)
    expect(explore).not.toBe(home)
    act(() => back())
    expect(getLocationKey()).toBe(home)
  })

  it('supplies its own router when the host has none (no ancestor <Router>)', () => {
    const ref: { current: SocialNavigation | undefined } = { current: undefined }
    render(
      <MemorySocialNavigationProvider>
        <Capture onValue={nav => { ref.current = nav }} />
      </MemorySocialNavigationProvider>,
    )
    expect(latest(ref).location.pathname).toBe('/home')
  })

  it('mounts under a nested parent route (the C6 shape)', () => {
    // The channel sits inside a staff route whose pathname does NOT prefix the memory
    // location. The `<Routes location>` half of this is pinned through the real
    // SocialRoutes in SocialRoutes.test.tsx; here the provider only has to be happy.
    const ref: { current: SocialNavigation | undefined } = { current: undefined }
    render(
      <MemoryRouter initialEntries={['/staff/console']}>
        <Routes>
          <Route
            path="/staff/console/*"
            element={(
              <MemorySocialNavigationProvider>
                <Capture onValue={nav => { ref.current = nav }} />
              </MemorySocialNavigationProvider>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('adapter-path')).toHaveTextContent('/home')
  })
})

describe('hooks outside a provider fail closed', () => {
  it('useSocialNavigate / useSocialNavigation throw; useHasSocialNavigation is false', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Has() {
      return <output data-testid="has">{String(useHasSocialNavigation())}</output>
    }
    render(<Has />)
    expect(screen.getByTestId('has')).toHaveTextContent('false')

    function Navigate(): null {
      useSocialNavigate()
      return null
    }
    expect(() => render(<Navigate />)).toThrow(/navigation provider/i)

    function Full(): null {
      useSocialNavigation()
      return null
    }
    expect(() => render(<Full />)).toThrow(/navigation provider/i)
    errors.mockRestore()
  })
})
