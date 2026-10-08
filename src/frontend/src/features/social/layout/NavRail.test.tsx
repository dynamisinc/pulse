/**
 * features/social/layout/NavRail.test.tsx
 * ---------------------------------------------------------------------------
 * The nav rail in isolation (demo-polish F1, "Nav rail" AC): pill links
 * Home / Explore / Profile with `aria-current="page"` on the active one; Profile
 * only for a persona-bound session; a Post button that is ABSENT (not disabled)
 * unless the host passes `onCompose`; no Notifications / Messages; and the
 * account card (avatar, name, @handle) only when asked for.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { NavRail } from './NavRail'
import { MemorySocialNavigationProvider } from './SocialNavigationProvider'
import { useSocialNavigation } from './socialNavigation'

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
  self?: Persona
  onCompose?: () => void
  showAccount?: boolean
}

function setup({ path = '/home', self, onCompose, showAccount = false }: SetupOptions = {}) {
  const postButtonRef = createRef<HTMLButtonElement>()
  render(
    <MemorySocialNavigationProvider initialEntries={[path]}>
      <NavRail
        {...(onCompose !== undefined ? { onCompose } : {})}
        postButtonRef={postButtonRef}
        self={self}
        showAccount={showAccount}
      />
      <Where />
    </MemorySocialNavigationProvider>,
  )
  return { postButtonRef }
}

describe('NavRail — landmark and links', () => {
  it('is the Primary navigation landmark with the logo link and the pill links', () => {
    setup({ self: persona('dreyes_fh') })
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Pulse home' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Explore' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/dreyes_fh')
  })

  it('renders the Pulse logomark', () => {
    setup()
    expect(screen.getByTestId('pulse-logo')).toBeInTheDocument()
  })

  it('has no Profile pill for a persona-less session (absent, not disabled)', () => {
    setup()
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
  })

  it('has no Notifications or Messages (out of scope for this story)', () => {
    setup({ self: persona('dreyes_fh'), onCompose: () => undefined })
    expect(screen.queryByText(/notifications/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/messages/i)).not.toBeInTheDocument()
  })

  it.each([
    ['/home', 'Home'],
    ['/explore', 'Explore'],
    ['/dreyes_fh', 'Profile'],
    ['/DREYES_FH', 'Profile'],
  ])('marks exactly one pill aria-current at %s -> %s', (path, label) => {
    setup({ path, self: persona('dreyes_fh') })
    const current = screen
      .getAllByRole('link')
      .filter(link => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(label)
  })

  it('marks nothing current on another persona\'s profile, a hashtag, or a thread', () => {
    for (const path of ['/FulcoEM', '/hashtag/zone2', '/FulcoEM/status/post-1']) {
      const { unmount } = render(
        <MemorySocialNavigationProvider initialEntries={[path]}>
          <NavRail self={persona('dreyes_fh')} showAccount={false} />
        </MemorySocialNavigationProvider>,
      )
      expect(
        screen.getAllByRole('link').filter(link => link.hasAttribute('aria-current')),
      ).toHaveLength(0)
      unmount()
    }
  })

  it('does not rely on colour alone: the active pill carries a distinct class too', () => {
    setup({ path: '/explore', self: persona('dreyes_fh') })
    expect(screen.getByRole('link', { name: 'Explore' }).className).toMatch(/linkActive/)
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toMatch(/linkActive/)
  })

  it('navigates in the adapter on a plain click', async () => {
    const user = userEvent.setup()
    setup({ self: persona('dreyes_fh') })
    await user.click(screen.getByRole('link', { name: 'Explore' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/explore')
    await user.click(screen.getByRole('link', { name: 'Profile' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/dreyes_fh')
    await user.click(screen.getByRole('link', { name: 'Pulse home' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/home')
  })

  it('is keyboard-operable: Tab reaches the links and Enter follows one', async () => {
    const user = userEvent.setup()
    setup({ self: persona('dreyes_fh') })
    await user.tab() // logo
    await user.tab() // Home
    await user.tab() // Explore
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/explore')
  })
})

describe('NavRail — Post button', () => {
  it('is ABSENT without onCompose (read-only / persona-less: absent, never disabled)', () => {
    setup({ self: persona('dreyes_fh') })
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument()
  })

  it('calls onCompose and exposes its ref so focus can return to it', async () => {
    const user = userEvent.setup()
    const onCompose = vi.fn()
    const { postButtonRef } = setup({ self: persona('dreyes_fh'), onCompose })
    const post = screen.getByRole('button', { name: 'Post' })
    expect(postButtonRef.current).toBe(post)
    await user.click(post)
    expect(onCompose).toHaveBeenCalledTimes(1)
  })
})

describe('NavRail — account card', () => {
  it('shows avatar, display name and @handle for the signed-in persona', () => {
    setup({ self: persona('dreyes_fh'), showAccount: true })
    const card = screen.getByTestId('account-card')
    expect(within(card).getByText('Dana Reyes')).toBeInTheDocument()
    expect(within(card).getByText('@dreyes_fh')).toBeInTheDocument()
    expect(within(card).getByTestId('post-avatar')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('is absent when the host does not want one (a staff preview)', () => {
    setup({ self: persona('dreyes_fh'), showAccount: false })
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
