/**
 * features/social/layout/BottomTabBar.test.tsx
 * ---------------------------------------------------------------------------
 * The phone bottom tab bar (mobile-tablet story 02, MT-D2) in isolation: the Primary
 * landmark and its items in order, `aria-current` on exactly the current tab, the Post
 * button absent unless the host passes `onCompose` (D1-011), Profile only for a persona,
 * the Notifications tab gated like the rail's bell, the unread badge as TEXT (not colour
 * only) with the count in the accessible name, plain clicks routed through the navigation
 * adapter, and the CSS contract: fixed to the bottom, safe-area aware, 44px cells, hidden
 * from the phone breakpoint up (the rail takes over). jsdom cannot lay out, so the last
 * group reads the stylesheet text, as `SocialChannel.layout.test.tsx` does.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { BottomTabBar } from './BottomTabBar'
import { PHONE_MAX_WIDTH, PHONE_QUERY, TAB_BAR_HEIGHT } from './frameMetrics'
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

interface SetupOptions {
  path?: string
  self?: Persona | undefined
  onCompose?: () => void
  showNotifications?: boolean
}

function setup({
  path = '/home',
  self = persona('dreyes_fh'),
  onCompose,
  showNotifications = true,
}: SetupOptions = {}) {
  render(
    <MemorySocialNavigationProvider initialEntries={[path]}>
      <BottomTabBar
        {...(onCompose !== undefined ? { onCompose } : {})}
        self={self}
        showNotifications={showNotifications}
      />
      <Where />
    </MemorySocialNavigationProvider>,
  )
  return screen.getByRole('navigation', { name: 'Primary' })
}

beforeEach(() => {
  summary.value = { available: true, unread: 0 }
})

describe('BottomTabBar: landmark and items', () => {
  it('is the Primary landmark with Home, Explore, Post, Notifications, Profile in order', () => {
    const nav = setup({ onCompose: vi.fn() })
    const names = within(nav).getAllByRole('link').map(a => a.textContent)
    expect(names).toEqual(['Home', 'Explore', 'Notifications', 'Profile'])
    const all = within(nav).getAllByRole('link').concat(within(nav).getAllByRole('button'))
    expect(all).toHaveLength(5)
    // Post sits between Explore and Notifications, in DOM (= reading and tab) order.
    const order = Array.from(nav.querySelectorAll('a, button')).map(
      el => el.getAttribute('aria-label') ?? el.textContent,
    )
    expect(order).toEqual(['Home', 'Explore', 'Post', 'Notifications', 'Profile'])
  })

  it('every item is a real anchor with an href (copyable URL), icons are decorative', () => {
    const nav = setup()
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home')
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
    expect(within(nav).getByRole('link', { name: /^Notifications/ }))
      .toHaveAttribute('href', '/notifications')
    expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/dreyes_fh')
    for (const svg of nav.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('BottomTabBar: aria-current', () => {
  it.each([
    ['/home', 'Home'],
    ['/explore', 'Explore'],
    ['/notifications', 'Notifications'],
    ['/dreyes_fh', 'Profile'],
  ])('%s marks only %s as current', (path, name) => {
    const nav = setup({ path })
    const current = nav.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(within(nav).getByRole('link', { name: new RegExp(`^${name}`) }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('marks nothing on a thread (not one of the tabs)', () => {
    const nav = setup({ path: '/i/status/abc' })
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(0)
  })

  it('the active tab is not colour-only: it has its own class (weight + top bar)', () => {
    const nav = setup({ path: '/explore' })
    const active = within(nav).getByRole('link', { name: 'Explore' })
    const inactive = within(nav).getByRole('link', { name: 'Home' })
    expect(active.className).not.toBe(inactive.className)
  })
})

describe('BottomTabBar: absent, not disabled (D1-011)', () => {
  it('has no Post button without onCompose', () => {
    const nav = setup()
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('Post calls onCompose', async () => {
    const onCompose = vi.fn()
    const nav = setup({ onCompose })
    await userEvent.click(within(nav).getByRole('button', { name: 'Post' }))
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('has no Profile tab without a persona', () => {
    const nav = setup({ self: undefined })
    expect(within(nav).queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
  })

  it('has no Notifications tab when the engine is not running or the mount may not show it', () => {
    summary.value = { available: false, unread: 9 }
    let nav = setup()
    expect(within(nav).queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
    expect(within(nav).queryByTestId('tab-notifications-badge')).not.toBeInTheDocument()
    document.body.innerHTML = ''
    summary.value = { available: true, unread: 9 }
    nav = setup({ showNotifications: false })
    expect(within(nav).queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
  })
})

describe('BottomTabBar: unread badge', () => {
  it('draws no badge when nothing is unread and the name is plain', () => {
    const nav = setup()
    expect(within(nav).queryByTestId('tab-notifications-badge')).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('shows the count as visible TEXT and puts it in the accessible name', () => {
    summary.value = { available: true, unread: 3 }
    const nav = setup()
    expect(within(nav).getByTestId('tab-notifications-badge')).toHaveTextContent('3')
    expect(within(nav).getByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
    // The visible badge is hidden from AT, so the count is not announced twice.
    expect(within(nav).getByTestId('tab-notifications-badge')).toHaveAttribute('aria-hidden', 'true')
  })

  it('caps at 99+', () => {
    summary.value = { available: true, unread: 250 }
    const nav = setup()
    expect(within(nav).getByTestId('tab-notifications-badge')).toHaveTextContent('99+')
    expect(within(nav).getByRole('link', { name: 'Notifications, 99+ unread' })).toBeInTheDocument()
  })
})

describe('BottomTabBar: navigation', () => {
  it('a plain click navigates through the adapter', async () => {
    const nav = setup()
    await userEvent.click(within(nav).getByRole('link', { name: 'Explore' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/explore')
    await userEvent.click(within(nav).getByRole('link', { name: 'Profile' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/dreyes_fh')
  })
})

describe('BottomTabBar: CSS contract (phones only, fixed, safe-area, 44px)', () => {
  const css = readFileSync(join(__dirname, 'BottomTabBar.module.css'), 'utf8')
  const squash = (text: string) => text.replace(/\s+/g, ' ')
  const frameCss = squash(readFileSync(join(__dirname, '../SocialChannel.module.css'), 'utf8'))

  it('uses the phone breakpoint the frame metrics declare', () => {
    expect(PHONE_MAX_WIDTH).toBe(599)
    expect(PHONE_QUERY).toBe('(max-width: 599px)')
    expect(squash(css)).toMatch(/@media \(min-width: 600px\) \{ \.bar \{ display: none; \} \}/)
    expect(frameCss).toContain('@media (max-width: 599px)')
  })

  it('is fixed to the bottom, above the shell banner, with the safe-area inset', () => {
    const text = squash(css)
    expect(text).toMatch(/\.bar \{[^}]*position: fixed/)
    expect(text).toMatch(/\.bar \{[^}]*bottom: var\(--pulse-chrome-bottom, 0px\)/)
    expect(text).toContain('env(safe-area-inset-bottom, 0px)')
  })

  it('the frame reserves the bar height + inset so no content sits under it', () => {
    expect(TAB_BAR_HEIGHT).toBe(56)
    expect(frameCss).toContain('--pulse-tabbar-height: calc(56px + env(safe-area-inset-bottom, 0px))')
    expect(frameCss).toContain('padding-bottom: var(--pulse-tabbar-height)')
  })

  it('cells are 56px tall, tabs at least 44px, Post is a 48px disc', () => {
    const text = squash(css)
    expect(text).toMatch(/\.cell \{[^}]*height: 56px/)
    expect(text).toMatch(/\.tab \{[^}]*min-height: 44px/)
    expect(text).toMatch(/\.post \{[^}]*width: 48px; height: 48px/)
  })

  it('is participant-world: no COBRA / MUI in the component or its stylesheet', () => {
    const tsx = readFileSync(join(__dirname, 'BottomTabBar.tsx'), 'utf8')
    expect(tsx).not.toMatch(/styledComponents|@mui\//)
    expect(css).toContain('var(--pc-accent)')
  })
})
