/**
 * features/participant-shell/channelRouter/ChannelRouter.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 12 (#708): `<ChannelRouter>` mounted the way `App.tsx`
 * mounts it, `BrandThemeProvider > ShellLayout > ChannelRouter`, with the REAL
 * shell (nav, content region, overlay) and the real enablement guard.
 *
 * Only `GET /channel-nav-config` is stubbed (through a spy on the shared axios
 * client that passes every other request through to the mock adapters), so
 * the nav and the guard resolve a mixed catalog from the same cache entry,
 * exactly as they do in the app. Channels are stub registrations: the router
 * is under test, not any channel's pages.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Navigate, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { OutletSkinScope } from '@/features/channels/skin'
import {
  registerChannel,
  type ChannelRegistration,
} from '@/features/channels/routing'
import { resetChannelRegistryForTests } from '@/features/channels/routing/registry'
import { matchSocialRoute } from '@/features/social/layout/socialNavigation'
import { BrandThemeProvider } from '../BrandThemeProvider'
import { ShellLayout } from '../ShellLayout'
import { LandingSelectionProvider, useLandingSelection } from '../landingSelection'
import { ChannelRouter } from './ChannelRouter'
import { resolveChannelPath } from './resolveChannelPath'

type ChannelFlag = 'social' | 'portal' | 'news' | 'press' | 'weather'
type Flags = Partial<Record<ChannelFlag, boolean>>

const LABELS: Record<ChannelFlag, string> = {
  social: 'Social',
  portal: 'Portal',
  news: 'News',
  press: 'Press Room',
  weather: 'Weather',
}

function navConfigBody(flags: Flags) {
  return {
    channels: (Object.keys(LABELS) as ChannelFlag[]).map(id => ({
      id,
      label: LABELS[id],
      icon: id,
      enabled: flags[id] ?? false,
    })),
    currentChannelId: 'social',
    hideWhenSingleChannel: false,
  }
}

let navConfigAnswer: () => Promise<unknown>

function respondWith(flags: Flags) {
  navConfigAnswer = () => Promise.resolve({ data: navConfigBody(flags), status: 200 })
}

const realGet = api.get.bind(api)

beforeEach(() => {
  resetChannelRegistryForTests()
  respondWith({ social: true })
  vi.spyOn(api, 'get').mockImplementation(((url: string, config?: unknown) =>
    url === '/channel-nav-config'
      ? navConfigAnswer()
      : realGet(url, config as never)) as typeof api.get)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetChannelRegistryForTests()
})

// ---------------------------------------------------------------------------
// Stub channels
// ---------------------------------------------------------------------------

const mounts: Record<string, number> = {}

function countMount(id: string): void {
  mounts[id] = (mounts[id] ?? 0) + 1
}

/** A channel that shows its path, counts its mounts and has one heading. */
function StubChannel({ id, onRoot }: { readonly id: string; readonly onRoot?: string }) {
  const { pathname } = useLocation()
  useEffect(() => countMount(id), [id])
  if (onRoot !== undefined && pathname === '/') return <Navigate to={onRoot} replace />
  return (
    <section data-testid={`channel-${id}`}>
      <h1>{id} heading</h1>
      <p data-testid={`${id}-path`}>{pathname}</p>
    </section>
  )
}

function SocialScope({ children }: { readonly children: ReactNode }) {
  return <div data-testid="social-scope">{children}</div>
}

function NewslineScope({ children }: { readonly children: ReactNode }) {
  return (
    <OutletSkinScope outlet={{ slug: 'newsline-7', skinKey: 'neutral', skinOverrides: null }}>
      {children}
    </OutletSkinScope>
  )
}

function PlainScope({ children }: { readonly children: ReactNode }) {
  return <>{children}</>
}

function registerSocial() {
  registerChannel({
    id: 'social',
    pathPrefix: '/',
    navPath: '/home',
    element: <StubChannel id="social" onRoot="/home" />,
    themeScope: SocialScope,
    claimsPath: pathname => matchSocialRoute(pathname) !== 'redirect',
  })
}

function registerPrefixed(id: Exclude<ChannelFlag, 'social'>, themeScope = PlainScope) {
  const registration: ChannelRegistration = {
    id,
    pathPrefix: `/${id}`,
    element: <StubChannel id={id} />,
    themeScope,
  }
  registerChannel(registration)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function LocationProbe() {
  const { pathname } = useLocation()
  return <output data-testid="location">{pathname}</output>
}

function renderRouter(path: string, wrap: (node: ReactNode) => ReactNode = node => node) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <BrandThemeProvider>
            <ShellLayout>{wrap(<ChannelRouter />)}</ShellLayout>
          </BrandThemeProvider>
          <LocationProbe />
        </ExerciseContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const contentRegion = () => screen.getByTestId('pulse-shell-content-region')
const strip = () => screen.getByTestId('pulse-channel-nav-strip')

// ---------------------------------------------------------------------------

describe('channel registry → router (AC1)', () => {
  beforeEach(() => {
    registerSocial()
    registerPrefixed('portal')
    registerPrefixed('weather')
    registerPrefixed('press')
    respondWith({ social: true, portal: false, weather: true, press: true })
  })

  it.each(['/home', '/explore', '/hashtag/zone2', '/alice', '/alice/status/42', '/alerts'])(
    'Social keeps its own sub-route %s at /',
    async path => {
      renderRouter(path)

      expect(await screen.findByTestId('channel-social')).toBeInTheDocument()
      expect(screen.getByTestId('social-path')).toHaveTextContent(path)
    },
  )

  it.each([
    ['/weather/zones/north-county', 'weather'],
    ['/weather/newsline-wx/morning-forecast', 'weather'],
    ['/press/county-oem', 'press'],
  ])('a channel owns every sub-route under its prefix: %s', async (path, id) => {
    renderRouter(path)

    expect(await screen.findByTestId(`channel-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`${id}-path`)).toHaveTextContent(path)
    expect(screen.queryByTestId('channel-social')).not.toBeInTheDocument()
  })

  it('never pre-empts a channel’s own final 404 under its prefix (press FU-6)', async () => {
    renderRouter('/press/county-oem/embargoed-release')

    // The router hands the path to the channel; only the channel's page decides it is missing.
    expect(await screen.findByTestId('channel-press')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()
  })

  it('neither mounts nor 404s the login-free /display/:token route (portal FU-3)', async () => {
    renderRouter('/display/abc123')

    await waitFor(() => expect(contentRegion()).toBeInTheDocument())
    expect(within(contentRegion()).queryByTestId(/^channel-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()
    expect(document.querySelector('[data-channel-router-scope]')).toBeNull()
  })

  it('matches a channel prefix case-insensitively (a hand-typed /News link)', async () => {
    respondWith({ social: true, news: true })
    registerPrefixed('news')
    renderRouter('/News/newsline-7/emergency-call-delays')

    expect(await screen.findByTestId('channel-news')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-social')).not.toBeInTheDocument()
  })

  it('a channel registered later is mounted without touching the router (late registration)', async () => {
    respondWith({ social: true, news: true })
    renderRouter('/news/newsline-7/emergency-call-delays')
    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()

    act(() => registerPrefixed('news'))

    expect(await screen.findByTestId('channel-news')).toBeInTheDocument()
  })
})

describe('participant not-found (AC6, WR-002)', () => {
  beforeEach(() => {
    registerSocial()
    respondWith({ social: true, news: true })
  })

  it.each([
    '/some/deep/unknown/path',
    '/hashtag/not a tag!',
    '/staff/console',
    '/news/newsline-7/emergency-call-delays', // catalogued channel, not registered
  ])('renders the brand-skinned, fiction-safe not-found inside the shell for %s', async path => {
    renderRouter(path)

    const notFound = await screen.findByTestId('channel-not-found')
    expect(contentRegion()).toContainElement(notFound)
    expect(screen.getByTestId('pulse-brand-theme-scope')).toContainElement(notFound)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(notFound.textContent).not.toMatch(/exercise|admin|disabled|enabled|404|staff/i)
    expect(screen.queryByTestId('channel-social')).not.toBeInTheDocument()
    // No COBRA / default-MUI 404 anywhere.
    expect(document.querySelector('[class*="Mui"]')).toBeNull()
  })

  it('sets the page title while shown and restores it after', async () => {
    document.title = 'Riverbend Daily'
    const user = userEvent.setup()
    renderRouter('/some/deep/unknown/path')

    await screen.findByTestId('channel-not-found')
    expect(document.title).toBe('Page not found')

    await user.click(screen.getByRole('link', { name: 'Go to the home page' }))

    expect(await screen.findByTestId('channel-social')).toBeInTheDocument()
    expect(document.title).toBe('Riverbend Daily')
  })
})

describe('per-channel theme scope (AC2) and the guard OUTSIDE it (F13 review)', () => {
  beforeEach(() => {
    registerSocial()
    registerPrefixed('news', NewslineScope)
  })

  it('mounts an enabled channel inside its own outlet skin scope, below the shell', async () => {
    respondWith({ social: true, news: true })
    renderRouter('/news/newsline-7')

    const channel = await screen.findByTestId('channel-news')
    const skin = channel.closest('[data-skin-scope]')
    expect(skin).toHaveAttribute('data-skin-scope', 'outlet-newsline-7')
    expect(contentRegion()).toContainElement(skin as HTMLElement)
    // Nothing skin-scoped sits above the shell or around the nav.
    expect(screen.getByTestId('pulse-shell-root').closest('[data-skin-scope]')).toBeNull()
    expect(strip().closest('[data-skin-scope]')).toBeNull()
  })

  it('the guard’s not-found keeps the exercise brand, never the outlet skin', async () => {
    respondWith({ social: true, news: false })
    renderRouter('/news/newsline-7')

    const notFound = await screen.findByTestId('channel-not-found')
    expect(notFound.closest('[data-skin-scope]')).toBeNull()
    expect(document.querySelector('[data-skin-scope]')).toBeNull()
    expect(screen.getByTestId('pulse-brand-theme-scope')).toContainElement(notFound)
  })

  it('the guard’s loading placeholder keeps the exercise brand, never the outlet skin', async () => {
    navConfigAnswer = () => new Promise(() => {})
    renderRouter('/news/newsline-7')

    const pending = await screen.findByText('Loading…')
    expect(pending.closest('[data-skin-scope]')).toBeNull()
    expect(document.querySelector('[data-skin-scope]')).toBeNull()
    expect(screen.getByTestId('pulse-brand-theme-scope')).toContainElement(pending)
  })

  it('mounts Social inside its own scope (SocialBrandScope in production)', async () => {
    respondWith({ social: true })
    renderRouter('/home')

    const channel = await screen.findByTestId('channel-social')
    expect(screen.getByTestId('social-scope')).toContainElement(channel)
  })
})

describe('nav agreement (AC3)', () => {
  beforeEach(() => {
    registerSocial()
    registerPrefixed('news')
    registerPrefixed('weather')
  })

  it('an enabled, registered channel is in the nav and navigable; a disabled one is in neither', async () => {
    respondWith({ social: true, news: true, weather: false })
    const user = userEvent.setup()
    renderRouter('/home')

    await screen.findByTestId('channel-social')
    await waitFor(() =>
      expect(within(strip()).getByRole('link', { name: 'News', hidden: true })).toBeInTheDocument())
    expect(within(strip()).queryByRole('link', { name: 'Weather', hidden: true })).toBeNull()
    expect(within(strip()).getByRole('link', { name: 'Social', hidden: true }))
      .toHaveAttribute('aria-current', 'page')

    await user.click(within(strip()).getByRole('link', { name: 'News', hidden: true }))

    expect(await screen.findByTestId('channel-news')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/news')
    expect(within(strip()).getByRole('link', { name: 'News', hidden: true }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('nav entries are real links to each channel’s nav path', async () => {
    respondWith({ social: true, news: true })
    renderRouter('/home')

    await waitFor(() =>
      expect(within(strip()).getByRole('link', { name: 'News', hidden: true }))
        .toHaveAttribute('href', '/news'))
    expect(within(strip()).getByRole('link', { name: 'Social', hidden: true }))
      .toHaveAttribute('href', '/home')
  })

  it('the disabled channel’s URL renders the participant not-found', async () => {
    respondWith({ social: true, news: true, weather: false })
    renderRouter('/weather/zones/north-county')

    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-weather')).not.toBeInTheDocument()
  })

  it('an enabled channel with no registration is left out of the nav (no door to a not-found)', async () => {
    respondWith({ social: true, news: true, press: true })
    renderRouter('/home')

    await waitFor(() =>
      expect(within(strip()).getByRole('link', { name: 'News', hidden: true })).toBeInTheDocument())
    expect(within(strip()).queryByRole('link', { name: 'Press Room', hidden: true })).toBeNull()
  })

  it('moves focus to the new channel’s heading on a channel switch (keyboard only)', async () => {
    respondWith({ social: true, news: true })
    const user = userEvent.setup()
    renderRouter('/home')
    await waitFor(() =>
      expect(within(strip()).getByRole('link', { name: 'News', hidden: true })).toBeInTheDocument())

    within(strip()).getByRole('link', { name: 'News', hidden: true }).focus()
    await user.keyboard('{Enter}')

    const heading = await screen.findByRole('heading', { name: 'news heading' })
    expect(heading).toHaveFocus()

    within(strip()).getByRole('link', { name: 'Social', hidden: true }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'social heading' })).toHaveFocus()
  })
})

describe('focus follows a late heading (AC8)', () => {
  let revealHeading: () => void = () => {}

  function LateHeadingChannel() {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      revealHeading = () => setReady(true)
    }, [])
    return ready ? <h1>weather heading</h1> : <p>loading forecast</p>
  }

  it('parks on the content scope, then moves to the heading once it renders', async () => {
    registerSocial()
    registerChannel({
      id: 'weather',
      pathPrefix: '/weather',
      element: <LateHeadingChannel />,
      themeScope: PlainScope,
    })
    respondWith({ social: true, weather: true })
    const user = userEvent.setup()
    renderRouter('/home')
    await waitFor(() =>
      expect(within(strip()).getByRole('link', { name: 'Weather', hidden: true })).toBeInTheDocument())

    await user.click(within(strip()).getByRole('link', { name: 'Weather', hidden: true }))

    expect(await screen.findByText('loading forecast')).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('data-channel-router-scope', 'weather')

    act(() => revealHeading())

    expect(await screen.findByRole('heading', { name: 'weather heading' })).toHaveFocus()
  })
})

describe('landing (AC4, PRT-001)', () => {
  beforeEach(() => {
    mounts.social = 0
    registerSocial()
  })

  it('lands on /portal when the portal is registered and enabled', async () => {
    registerPrefixed('portal')
    respondWith({ social: true, portal: true })
    renderRouter('/')

    expect(await screen.findByTestId('channel-portal')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/portal$/)
  })

  it('lands on Social home when the portal is registered but disabled', async () => {
    registerPrefixed('portal')
    respondWith({ social: true, portal: false })
    renderRouter('/')

    expect(await screen.findByTestId('channel-social')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/home$/)
  })

  it('pilot mode: Social home, mounted once across the / → /home hand-off', async () => {
    respondWith({ social: true })
    renderRouter('/')

    expect(await screen.findByTestId('channel-social')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/home$/)
    expect(mounts.social).toBe(1)
  })

  it('an enabled portal that has not registered does not strand the participant', async () => {
    respondWith({ social: true, portal: true })
    renderRouter('/')

    expect(await screen.findByTestId('channel-social')).toBeInTheDocument()
  })

  it('a read-only session keeps its landing selection', async () => {
    function SelectionProbe() {
      return <p data-testid="selection">{useLandingSelection()}</p>
    }
    resetChannelRegistryForTests()
    registerChannel({
      id: 'social',
      pathPrefix: '/',
      navPath: '/home',
      element: <SelectionProbe />,
      themeScope: SocialScope,
    })
    respondWith({ social: true })
    renderRouter('/', node => (
      <LandingSelectionProvider value="all-posts">{node}</LandingSelectionProvider>
    ))

    expect(await screen.findByTestId('selection')).toHaveTextContent('all-posts')
  })
})

describe('channels cannot escape the shell (AC7)', () => {
  it('renders the channel only in the content region; the nav and overlay stay shell siblings', async () => {
    registerSocial()
    respondWith({ social: true })
    renderRouter('/home')

    const channel = await screen.findByTestId('channel-social')
    expect(contentRegion()).toContainElement(channel)
    expect(contentRegion()).not.toContainElement(strip())
    expect(screen.getByTestId('pulse-shell-root')).toContainElement(contentRegion())
  })
})

describe('resolveChannelPath (pure)', () => {
  it('resolves the landing entry, outside-shell paths and unregistered catalogued prefixes', () => {
    expect(resolveChannelPath('/', []).kind).toBe('landing')
    expect(resolveChannelPath('/display', []).kind).toBe('outside-shell')
    expect(resolveChannelPath('/Display/abc', []).kind).toBe('outside-shell')
    expect(resolveChannelPath('/news/a/b', []).kind).toBe('not-found')
    expect(resolveChannelPath('/anything', []).kind).toBe('not-found')
  })
})

describe('two worlds (static, AC2)', () => {
  const sources: Record<string, string> = {
    ...import.meta.glob(['./*.ts', './*.tsx', '!./*.test.*'], {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
    ...import.meta.glob('../../channels/routing/registry.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  }

  it('scans every router module (cannot vacuously pass)', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(sources)).toContain('./ChannelRouter.tsx')
  })

  it('imports no COBRA theme, no COBRA component and no MUI component', () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/from '[^']*(?:@\/theme|cobra)[^']*'/i)
      expect(source, file).not.toMatch(/from '@mui\//)
    }
  })
})
