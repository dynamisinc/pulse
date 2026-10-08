/**
 * features/social/SocialChannel.frame.test.tsx
 * ---------------------------------------------------------------------------
 * The app frame (demo-polish F1), end to end through the real channel:
 *
 *  - ACCESSIBILITY (NFR-001): the three landmarks, the skip link, focus moving to
 *    the main heading on a route change (and NOT on first render or a redirect hop),
 *    the compose modal making the frame inert and returning focus to Post;
 *  - ABSENT, NOT DISABLED (D1-011): no Post button / account card where the mount or
 *    session may not have them, no Notifications / Messages;
 *  - "STATE SURVIVES BACK": the unsent draft, the feed's DOM, its telemetry guard and
 *    the window scroll position all survive Explore -> Back;
 *  - SIGN OUT: `endSession()` then the login redirect, in an app-shaped route table.
 *
 * Layout MEASUREMENTS live in `SocialChannel.layout.test.tsx` (CSS), and the route
 * table in `layout/SocialRoutes.test.tsx`.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { RouterProbe } from './layout/RouterProbe'
import { renderChannel } from './layout/testHarness'

const endSessionMock = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  endSession: endSessionMock,
}))

beforeEach(() => {
  resetTelemetryBuffer()
  endSessionMock.mockResolvedValue(undefined)
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  endSessionMock.mockReset()
})

async function feedReady() {
  await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
}

function routerLocation(): string {
  return screen.getByTestId('router-location').textContent ?? ''
}

describe('landmarks and skip link (NFR-001)', () => {
  it('exposes nav[Primary], one main, and aside[Sidebar]', async () => {
    renderChannel()
    await feedReady()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  })

  it('puts the main region between the two rails, with the feed inside it', async () => {
    renderChannel()
    await feedReady()
    const main = screen.getByRole('main')
    expect(main).toContainElement(screen.getAllByTestId('post-card')[0] as HTMLElement)
    expect(main).not.toContainElement(screen.getByRole('navigation', { name: 'Primary' }))
    expect(main).not.toContainElement(screen.getByRole('complementary', { name: 'Sidebar' }))
  })

  it('makes "Skip to main content" the first focusable control, and it focuses main', async () => {
    const user = userEvent.setup()
    renderChannel({ beside: <RouterProbe /> })
    await feedReady()

    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    // It moved focus; it did not push a `#social-main` entry onto history.
    expect(routerLocation()).toBe('/home')
  })
})

describe('focus on route change (NFR-001)', () => {
  it('does not steal focus on first render', async () => {
    renderChannel()
    await feedReady()
    expect(document.body).toHaveFocus()
  })

  it('does not steal focus on a redirect hop (/ -> /home)', async () => {
    renderChannel({ entries: ['/'], beside: <RouterProbe /> })
    await waitFor(() => expect(routerLocation()).toBe('/home'))
    await feedReady()
    expect(document.body).toHaveFocus()
  })

  it('moves focus to the new page\'s heading when a nav pill is used', async () => {
    const user = userEvent.setup()
    renderChannel()
    await feedReady()

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Explore' })).toHaveFocus()

    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toHaveFocus())
  })

  it('moves focus to the heading on browser Back / Forward as well', async () => {
    const user = userEvent.setup()
    renderChannel({ beside: <RouterProbe /> })
    await feedReady()

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    await user.click(screen.getByTestId('probe-back'))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toHaveFocus())
  })

  it('shows exactly one visible h1 per route', async () => {
    const user = userEvent.setup()
    renderChannel()
    await feedReady()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('compose modal from the Post button', () => {
  it('opens a focus-trapped dialog, makes the frame inert, and Esc returns focus to Post', async () => {
    const user = userEvent.setup()
    renderChannel()
    await feedReady()

    const post = await screen.findByTestId('nav-post-button')
    await user.click(post)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: 'Post text' })).toHaveFocus()
    expect(post.closest('[inert]')).not.toBeNull()
    expect(dialog.closest('[inert]')).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(post).toHaveFocus()
    expect(post.closest('[inert]')).toBeNull()
  })

  it('closes after a post is published (mock mode fires onPosted)', async () => {
    const user = userEvent.setup()
    renderChannel()
    await feedReady()

    await user.click(await screen.findByTestId('nav-post-button'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Post text' }), 'Boil water in effect')
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('has NO Post button in a read-only mount (absent, never disabled)', async () => {
    renderChannel({ variant: 'readOnly' })
    await feedReady()
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument()
  })

  it('has NO Post button in a staff-preview mount', async () => {
    renderChannel({ variant: 'preview' })
    await feedReady()
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
  })
})

describe('account card', () => {
  it('shows the signed-in persona in a full mount', async () => {
    renderChannel()
    await feedReady()
    const card = await screen.findByTestId('account-card')
    expect(within(card).getByText('Dana Reyes')).toBeInTheDocument()
    expect(within(card).getByText('@dreyes_fh')).toBeInTheDocument()
  })

  it('a read-only mount still offers Sign out (only a staff preview must not)', async () => {
    renderChannel({ variant: 'readOnly' })
    await feedReady()
    expect(await screen.findByTestId('account-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('is absent from a staff-preview mount — a preview must not sign the staff user out', async () => {
    renderChannel({ variant: 'preview' })
    await feedReady()
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('signs out via endSession() and lands on the login route', async () => {
    const user = userEvent.setup()
    renderChannel({ appRoutes: true })
    await feedReady()

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(endSessionMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('social-channel')).not.toBeInTheDocument()
  })
})

describe('state survives Back (feed baseline, draft, telemetry)', () => {
  const feedViews = () =>
    getEmittedTelemetryEvents().filter(
      e => e.eventType === 'view' && e.target?.entityType === 'feed',
    ).length

  it('keeps the unsent draft, the very same feed DOM, and emits no second feed view', async () => {
    const user = userEvent.setup()
    renderChannel({ beside: <RouterProbe /> })
    await feedReady()
    expect(feedViews()).toBe(1)

    const draft = within(screen.getByTestId('composer')).getByRole('textbox', { name: 'Post text' })
    await user.type(draft, 'Draft I have not sent')
    const firstCard = screen.getAllByTestId('post-card')[0] as HTMLElement
    const cardCount = screen.getAllByTestId('post-card').length

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(screen.getByTestId('social-feed-region')).not.toBeVisible()

    await user.click(screen.getByTestId('probe-back'))
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())

    // The draft survived...
    expect(
      within(screen.getByTestId('composer')).getByRole('textbox', { name: 'Post text' }),
    ).toHaveValue('Draft I have not sent')
    // ...the feed was hidden, never remounted (same element instance, same rows)...
    expect(screen.getAllByTestId('post-card')[0]).toBe(firstCard)
    expect(screen.getAllByTestId('post-card')).toHaveLength(cardCount)
    // ...and its emit-once view guard was never re-armed.
    expect(feedViews()).toBe(1)
  })
})

describe('scroll position (browser kind only)', () => {
  let scrollTopWrites: number[]
  let documentScroll: number

  beforeEach(() => {
    scrollTopWrites = []
    documentScroll = 0
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      get: () => documentScroll,
      set: (value: number) => {
        scrollTopWrites.push(value)
        documentScroll = value
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'scrollTop')
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 })
  })

  function scrollWindowTo(top: number) {
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: top })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
  }

  it('starts a new page at the top and restores Home\'s offset on Back', async () => {
    const user = userEvent.setup()
    renderChannel({ beside: <RouterProbe /> })
    await feedReady()

    scrollWindowTo(640)
    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(scrollTopWrites.at(-1)).toBe(0)

    await user.click(screen.getByTestId('probe-back'))
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(scrollTopWrites.at(-1)).toBe(640)
  })

  it('never touches window scroll under the memory provider', async () => {
    const user = userEvent.setup()
    renderChannel({ memory: { initialEntries: ['/home'] } })
    await feedReady()

    scrollWindowTo(640)
    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(scrollTopWrites).toEqual([])
  })
})

describe('active nav state follows the route', () => {
  it('moves aria-current as the user navigates', async () => {
    const user = userEvent.setup()
    renderChannel()
    await feedReady()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')

    await user.click(await screen.findByRole('link', { name: 'Profile' }))
    await screen.findByTestId('social-profile-region')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  })
})
