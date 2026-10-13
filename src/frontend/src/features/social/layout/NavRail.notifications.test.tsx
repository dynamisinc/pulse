/**
 * features/social/layout/NavRail.notifications.test.tsx
 * ---------------------------------------------------------------------------
 * The nav rail's Notifications bell (demo-polish F7, story 16 "Bell and badge"): the link
 * exists only while the notifications engine runs; its unread count is TEXT capped at `99+`;
 * its accessible name is "Notifications, N unread"; it is never a colour-only dot; it carries
 * `aria-current` on `/notifications`; and a plain click moves through the navigation adapter.
 *
 * The rail reads the count through `useNotificationsSummary`, so this suite replaces that one
 * hook (hoisted mock) and leaves the rest of the rail real. The real engine -> rail path is in
 * `notifications/NotificationsFlow.test.tsx`.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { NavRail } from './NavRail'
import { MemorySocialNavigationProvider } from './SocialNavigationProvider'
import { useSocialNavigation } from './socialNavigation'

const summary = vi.hoisted(() => ({ value: { available: false, unread: 0 } }))
vi.mock('../notifications/useNotifications', () => ({
  useNotificationsSummary: () => summary.value,
}))

function persona(handle: string): Persona {
  const found = personaById(personaIdForHandle(handle))
  if (!found) throw new Error(`fixture missing seeded persona @${handle}`)
  return found
}

function Where() {
  const { location } = useSocialNavigation()
  return <output data-testid="where">{location.pathname}</output>
}

function setup(path = '/home') {
  render(
    <MemorySocialNavigationProvider initialEntries={[path]}>
      <NavRail self={persona('dreyes_fh')} showAccount={false} />
      <Where />
    </MemorySocialNavigationProvider>,
  )
}

beforeEach(() => {
  summary.value = { available: false, unread: 0 }
})

describe('NavRail — the Notifications bell is absent unless the engine runs (D1-011)', () => {
  it('has no Notifications link and no badge when notifications are unavailable', () => {
    summary.value = { available: false, unread: 7 } // even a stale count must not draw anything
    setup()
    expect(screen.queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
  })

  it('has the link between Explore and Profile when available', () => {
    summary.value = { available: true, unread: 0 }
    setup()
    const names = screen
      .getAllByRole('link')
      .map(link => link.getAttribute('aria-label') ?? link.textContent)
    expect(names.slice(1, 5)).toEqual(['Home', 'Explore', 'Notifications', 'Profile'])
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications')
  })
})

describe('NavRail — the unread badge is text, not a dot', () => {
  it('draws no badge, and a plain accessible name, at zero unread', () => {
    summary.value = { available: true, unread: 0 }
    setup()
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('shows the count as characters and names the link "Notifications, N unread"', () => {
    summary.value = { available: true, unread: 3 }
    setup()
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
  })

  it('caps the visible count at 99+ (and the name says the same)', () => {
    summary.value = { available: true, unread: 99 }
    const { unmount } = render(
      <MemorySocialNavigationProvider>
        <NavRail self={persona('dreyes_fh')} showAccount={false} />
      </MemorySocialNavigationProvider>,
    )
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent(/^99$/)
    unmount()

    summary.value = { available: true, unread: 340 }
    setup()
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent(/^99\+$/)
    expect(screen.getByRole('link', { name: 'Notifications, 99+ unread' })).toBeInTheDocument()
  })

  it('hides the badge glyphs from assistive tech so the count is not read twice', () => {
    summary.value = { available: true, unread: 5 }
    setup()
    expect(screen.getByTestId('notifications-badge')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('NavRail — navigation and current page', () => {
  it('marks the bell aria-current on /notifications, and only the bell', () => {
    summary.value = { available: true, unread: 2 }
    setup('/notifications')
    const current = screen
      .getAllByRole('link')
      .filter(link => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName('Notifications, 2 unread')
    expect(current[0]?.className).toMatch(/linkActive/) // not colour alone
  })

  it('a plain click navigates in the adapter', async () => {
    const user = userEvent.setup()
    summary.value = { available: true, unread: 1 }
    setup('/home')
    await user.click(screen.getByRole('link', { name: 'Notifications, 1 unread' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/notifications')
  })
})
