/**
 * features/social/layout/SocialNavigationProvider.tsx
 * ---------------------------------------------------------------------------
 * The two implementations of the Social channel's navigation adapter
 * (`./socialNavigation.ts` explains the adapter and why it exists).
 *
 *  - `SocialNavigationProvider` (the DEFAULT) wraps React Router. In the app it
 *    sits under `App.tsx`'s `*` catch-all, so the channel gets real URLs, a
 *    working browser Back/Forward, and reload-on-any-route. `SocialChannel`
 *    mounts it itself when no provider is above it.
 *
 *  - `MemorySocialNavigationProvider` keeps the location and its back stack in
 *    React state. It NEVER reads or writes `window.location` / `window.history`,
 *    so a host that embeds the channel (C6's staff "preview as participant")
 *    can let the previewer click around without moving the staff app's address
 *    bar. Mount it ABOVE `<SocialChannel>`:
 *
 *        <MemorySocialNavigationProvider initialEntries={['/home']}>
 *          <SocialChannel />
 *        </MemorySocialNavigationProvider>
 *
 * ROUTER CONTEXT. `SocialRoutes` renders React Router's `<Routes>` purely as a
 * MATCHER (its `location` is overridden with the adapter's), and `<Routes>` needs
 * *a* router ancestor to exist. In the app there always is one. If a host mounts
 * the memory provider with none (a unit test, say), the provider supplies a
 * throwaway `<MemoryRouter>` so the channel still works -- that router is never
 * consulted for the location.
 *
 * STABILITY. `navigate` / `back` keep the same identity for the provider's whole
 * life, even though React Router's own `useNavigate()` does not under a plain
 * `<MemoryRouter>` (it re-creates on every location change). The latest function
 * is held in a ref so memoized feed rows are not re-rendered by a navigation
 * (NFR-002/SOC-071).
 *
 * Both providers behave the same way for the one subtle case: navigating to the
 * CURRENT path+search is a REPLACE, not a push (React Router's data router does
 * the same), so clicking the active nav pill twice does not stack duplicate
 * history entries.
 *
 * World: participant. No COBRA, no MUI.
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import {
  MemoryRouter,
  parsePath,
  useInRouterContext,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  HOME_PATH,
  SocialNavigationContextProvider,
  type SocialLocation,
  type SocialLocationState,
  type SocialNavigateOptions,
  type SocialNavigationActions,
} from './socialNavigation'

// ---------------------------------------------------------------------------
// Default provider: React Router
// ---------------------------------------------------------------------------

export interface SocialNavigationProviderProps {
  children: ReactNode
}

/** Real URLs and browser history, via the surrounding React Router. */
export function SocialNavigationProvider({ children }: SocialNavigationProviderProps) {
  const routerLocation = useLocation()
  const routerNavigate = useNavigate()

  // React Router's `key` is `'default'` only for the very first entry of a
  // session -- so any other key means there is an earlier entry in this app to
  // go back to. (A cold deep link has `'default'` and gets the fallback.)
  const canGoBack = routerLocation.key !== 'default'

  // Latest-value refs: the actions below are created once and read these, so
  // their identity never changes (see "STABILITY" in the module header).
  const navigateRef = useRef(routerNavigate)
  const canGoBackRef = useRef(canGoBack)
  useLayoutEffect(() => {
    navigateRef.current = routerNavigate
    canGoBackRef.current = canGoBack
  })

  const actions = useMemo<SocialNavigationActions>(
    () => ({
      kind: 'browser',
      navigate: (to: string, options?: SocialNavigateOptions) => {
        if (options?.replace === true) navigateRef.current(to, { replace: true })
        else navigateRef.current(to)
      },
      back: (fallback: string = HOME_PATH) => {
        if (canGoBackRef.current) navigateRef.current(-1)
        else navigateRef.current(fallback, { replace: true })
      },
    }),
    [],
  )

  const { pathname, search, hash, key } = routerLocation
  const state = useMemo<SocialLocationState>(
    () => ({ location: { pathname, search, hash, key }, canGoBack }),
    [pathname, search, hash, key, canGoBack],
  )

  return (
    <SocialNavigationContextProvider actions={actions} state={state}>
      {children}
    </SocialNavigationContextProvider>
  )
}

// ---------------------------------------------------------------------------
// Memory provider: in-React-state history, no browser involvement
// ---------------------------------------------------------------------------

interface MemoryHistoryState {
  readonly entries: readonly SocialLocation[]
  readonly index: number
  /** Monotonic counter minting `SocialLocation.key`s (kept in state: the reducer is pure). */
  readonly nextKey: number
}

type MemoryHistoryAction =
  | { readonly type: 'navigate'; readonly to: string; readonly replace: boolean }
  | { readonly type: 'back'; readonly fallback: string }

/** Splits `to` into path/search/hash and guarantees an absolute pathname. */
function toLocation(to: string, key: string): SocialLocation {
  const parsed = parsePath(to)
  const pathname = parsed.pathname ?? '/'
  return {
    pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
    search: parsed.search ?? '',
    hash: parsed.hash ?? '',
    key,
  }
}

function initMemoryHistory(
  initialEntries: readonly string[],
  initialIndex: number | undefined,
): MemoryHistoryState {
  const paths = initialEntries.length > 0 ? initialEntries : [HOME_PATH]
  const entries = paths.map((path, i) => toLocation(path, `mem-${i}`))
  const last = entries.length - 1
  const index = Math.min(Math.max(initialIndex ?? last, 0), last)
  return { entries, index, nextKey: entries.length }
}

function memoryHistoryReducer(
  state: MemoryHistoryState,
  action: MemoryHistoryAction,
): MemoryHistoryState {
  const current = state.entries[state.index]
  const nextKey = `mem-${state.nextKey}`

  const replaceCurrent = (to: string): MemoryHistoryState => {
    const entries = state.entries.slice()
    entries[state.index] = toLocation(to, nextKey)
    return { entries, index: state.index, nextKey: state.nextKey + 1 }
  }

  if (action.type === 'back') {
    if (state.index > 0) return { ...state, index: state.index - 1 }
    return replaceCurrent(action.fallback)
  }

  const next = toLocation(action.to, nextKey)
  const samePlace =
    current !== undefined &&
    current.pathname === next.pathname &&
    current.search === next.search
  if (action.replace || samePlace) return replaceCurrent(action.to)
  return {
    entries: [...state.entries.slice(0, state.index + 1), next],
    index: state.index + 1,
    nextKey: state.nextKey + 1,
  }
}

export interface MemorySocialNavigationProviderProps {
  /** Starting history, oldest first. Defaults to `['/home']`. */
  initialEntries?: readonly string[]
  /** Which entry is current at the start. Defaults to the last one. */
  initialIndex?: number
  children: ReactNode
}

/**
 * Keeps the channel's location in memory. Never touches browser history, the
 * address bar, or window scroll. See the module header for when to use it.
 */
export function MemorySocialNavigationProvider({
  initialEntries = [HOME_PATH],
  initialIndex,
  children,
}: MemorySocialNavigationProviderProps) {
  const inRouter = useInRouterContext()
  const [history, dispatch] = useReducer(
    memoryHistoryReducer,
    undefined,
    () => initMemoryHistory(initialEntries, initialIndex),
  )

  const navigate = useCallback((to: string, options?: SocialNavigateOptions) => {
    dispatch({ type: 'navigate', to, replace: options?.replace === true })
  }, [])
  const back = useCallback((fallback: string = HOME_PATH) => {
    dispatch({ type: 'back', fallback })
  }, [])
  const actions = useMemo<SocialNavigationActions>(
    () => ({ kind: 'memory', navigate, back }),
    [navigate, back],
  )

  const location = history.entries[history.index] ?? toLocation(HOME_PATH, 'mem-fallback')
  const canGoBack = history.index > 0
  const state = useMemo<SocialLocationState>(
    () => ({ location, canGoBack }),
    [location, canGoBack],
  )

  const content = (
    <SocialNavigationContextProvider actions={actions} state={state}>
      {children}
    </SocialNavigationContextProvider>
  )
  // `<Routes>` needs *a* router ancestor; supply a throwaway one if the host has none.
  return inRouter ? content : <MemoryRouter>{content}</MemoryRouter>
}
