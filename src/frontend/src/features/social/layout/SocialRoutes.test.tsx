/**
 * features/social/layout/SocialRoutes.test.tsx
 * ---------------------------------------------------------------------------
 * The route table (demo-polish F1, "Real URLs and Back" + "Navigation adapter"):
 * every route renders its page; `/` and every unknown / staff-like path land on
 * Home (COR-004); an unknown handle shows the profile's own "doesn't exist" state;
 * a cold deep link works without ever mounting Home; browser Back / Forward move
 * between pages; and the memory provider matches against ITS location, leaving the
 * host router and `window.history` alone -- including when the channel is mounted
 * under a staff-style parent route (the C6 shape that `<Routes location>` would
 * otherwise throw on).
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { matchSocialRoute } from './socialNavigation'
import { RouterProbe } from './RouterProbe.testUtils'
import { renderChannel } from './renderChannel.testUtils'

/** A real seeded post id, so `useThread` can resolve a thread for it. */
const THREADABLE_POST_ID = 'post-seed-fw-advisory'

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  vi.restoreAllMocks()
})

function routerLocation(): string {
  return screen.getByTestId('router-location').textContent ?? ''
}

function mainRoute(): string | null {
  return screen.getByTestId('social-main').getAttribute('data-route')
}

describe('SocialRoutes — each route renders its page', () => {
  it('/home renders the feed', async () => {
    renderChannel({ entries: ['/home'], beside: <RouterProbe /> })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(screen.getByTestId('social-feed-region')).toBeVisible()
    expect(routerLocation()).toBe('/home')
  })

  it('/ redirects to /home', async () => {
    renderChannel({ entries: ['/'], beside: <RouterProbe /> })
    await waitFor(() => expect(routerLocation()).toBe('/home'))
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(screen.getByTestId('social-feed-region')).toBeVisible()
  })

  it('/explore renders F0\'s Explore page (no props)', async () => {
    renderChannel({ entries: ['/explore'] })
    expect(await screen.findByTestId('explore-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument()
  })

  it('/hashtag/:tag renders the hashtag feed under its normalized tag', async () => {
    renderChannel({ entries: ['/hashtag/%23WaterIssues'] })
    expect(await screen.findByRole('heading', { name: '#waterissues' })).toBeInTheDocument()
    expect(screen.getByTestId('social-hashtag-region')).toBeInTheDocument()
  })

  it('/hashtag/:tag accepts a non-ASCII letter tag', async () => {
    renderChannel({ entries: ['/hashtag/Caf%C3%A9'] })
    expect(await screen.findByRole('heading', { name: '#café' })).toBeInTheDocument()
  })

  it('/:handle renders that persona\'s profile', async () => {
    renderChannel({ entries: ['/FulcoEM'] })
    expect(await screen.findByRole('heading', { name: /Fulton County EM/ })).toBeInTheDocument()
    expect(screen.getByTestId('social-profile-region')).toBeInTheDocument()
  })

  it('/:handle resolves case-insensitively', async () => {
    renderChannel({ entries: ['/DREYES_fh'] })
    expect(await screen.findByRole('heading', { name: 'Dana Reyes' })).toBeInTheDocument()
  })

  it('/:handle/status/:id renders the thread, whatever the handle segment says', async () => {
    renderChannel({ entries: [`/not-the-author/status/${THREADABLE_POST_ID}`] })
    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Post' })).toBeInTheDocument()
  })

  it('the thread placeholder handle (/i/status/:id) is a thread, not a profile', async () => {
    renderChannel({ entries: [`/i/status/${THREADABLE_POST_ID}`] })
    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
  })
})

describe('SocialRoutes — unknown and staff-like paths render Home (COR-004)', () => {
  it.each([
    '/staff/console',
    '/staff',
    '/%73taff',
    '/staff/status/1',
    '/login',
    '/hashtag',
    '/hashtag/%23',
    '/hashtag/a%20b',
    '/hashtag/%3Cscript%3E',
    '/nonsense/a/b/c/d',
    '/FulcoEM/followers',
  ])('%s lands on /home with the feed showing', async path => {
    renderChannel({ entries: [path], beside: <RouterProbe /> })
    await waitFor(() => expect(routerLocation()).toBe('/home'))
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(screen.getByTestId('social-feed-region')).toBeVisible()
    // Nothing staff-flavoured is ever rendered for a participant.
    expect(screen.queryByText(/console/i)).not.toBeInTheDocument()
  })

  it('an unknown handle shows the profile\'s own "doesn\'t exist" state', async () => {
    renderChannel({ entries: ['/nobody_by_that_name'] })
    expect(await screen.findByText('This account doesn’t exist.')).toBeInTheDocument()
    // The route still has a heading for focus to land on.
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument()
  })
})

describe('SocialRoutes — deep links and Back / Forward', () => {
  it('a cold deep link to a thread never mounts Home (no feed fetch, no feed view)', async () => {
    renderChannel({ entries: [`/FulcoEM/status/${THREADABLE_POST_ID}`] })
    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
    expect(screen.queryByTestId('social-feed-region')).not.toBeInTheDocument()
    const feedViews = getEmittedTelemetryEvents().filter(
      e => e.eventType === 'view' && e.target?.entityType === 'feed',
    )
    expect(feedViews).toHaveLength(0)
  })

  it('browser Back and Forward move between pages', async () => {
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'], beside: <RouterProbe /> })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    expect(await screen.findByTestId('explore-page')).toBeInTheDocument()
    expect(routerLocation()).toBe('/explore')
    // Home is hidden, not gone.
    expect(screen.getByTestId('social-feed-region')).not.toBeVisible()

    await user.click(screen.getByTestId('probe-back'))
    await waitFor(() => expect(routerLocation()).toBe('/home'))
    expect(screen.getByTestId('social-feed-region')).toBeVisible()
    expect(screen.queryByTestId('explore-page')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('probe-forward'))
    await waitFor(() => expect(routerLocation()).toBe('/explore'))
    expect(await screen.findByTestId('explore-page')).toBeInTheDocument()
  })

  it('opening a thread from the feed pushes a /…/status/:id URL (and Back is a pop)', async () => {
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'], beside: <RouterProbe /> })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const [target] = screen.getAllByTestId('post-open-target')
    if (target === undefined) throw new Error('expected an open target')
    await user.click(target)

    await screen.findByTestId('thread-view')
    expect(routerLocation()).toMatch(/^\/[^/]+\/status\/.+/)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() => expect(routerLocation()).toBe('/home'))
  })

  it('Back on a cold deep link replaces with /home instead of leaving the app', async () => {
    const user = userEvent.setup()
    renderChannel({ entries: ['/FulcoEM'], beside: <RouterProbe /> })
    await screen.findByTestId('social-profile-region')

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() => expect(routerLocation()).toBe('/home'))
    expect(await screen.findByTestId('social-feed-region')).toBeVisible()
  })
})

describe('SocialRoutes — matchSocialRoute agrees with the rendered <Routes> table', () => {
  const battery: ReadonlyArray<string> = [
    '/home',
    '/explore',
    '/hashtag/zone2',
    '/hashtag/%23WaterIssues',
    '/hashtag/%23',
    '/hashtag/a%20b',
    '/FulcoEM',
    `/FulcoEM/status/${THREADABLE_POST_ID}`,
    `/i/status/${THREADABLE_POST_ID}`,
    '/',
    '/staff',
    '/%73taff',
    '/staff/console',
    '/login',
    '/hashtag',
    '/i',
    '/a/b/c',
  ]

  it.each(battery)('%s', async path => {
    renderChannel({ memory: { initialEntries: [path] } })
    const expected = matchSocialRoute(path)
    // A redirect hop ends on Home.
    const expectedRoute = expected === 'redirect' ? 'home' : expected
    await waitFor(() => expect(mainRoute()).toBe(expectedRoute))
  })
})

describe('SocialRoutes — the memory provider (C6\'s staff preview)', () => {
  it('matches its own location, leaving the host router and browser history alone', async () => {
    const user = userEvent.setup()
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const href = window.location.href

    renderChannel({
      entries: ['/staff/console'],
      memory: { initialEntries: ['/home'] },
      beside: <RouterProbe />,
    })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    expect(await screen.findByTestId('explore-page')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())

    // The staff app's router never moved; neither did the real browser.
    expect(routerLocation()).toBe('/staff/console')
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.location.href).toBe(href)
  })

  it('works mounted under a staff-style parent route (no <Routes location> invariant)', async () => {
    const user = userEvent.setup()
    renderChannel({
      parentRoute: '/staff/console',
      memory: { initialEntries: ['/home'] },
      beside: <RouterProbe />,
    })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    expect(await screen.findByTestId('explore-page')).toBeInTheDocument()
    expect(routerLocation()).toBe('/staff/console')

    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(routerLocation()).toBe('/staff/console')
  })

  it('an unknown path under the memory provider redirects in memory, not in the host router', async () => {
    renderChannel({
      entries: ['/staff/console'],
      memory: { initialEntries: ['/staff/console'] },
      beside: <RouterProbe />,
    })
    await waitFor(() => expect(mainRoute()).toBe('home'))
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(routerLocation()).toBe('/staff/console')
    expect(within(screen.getByTestId('social-main')).getByTestId('social-feed-region')).toBeVisible()
  })
})
