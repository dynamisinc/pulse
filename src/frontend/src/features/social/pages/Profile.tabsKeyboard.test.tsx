/**
 * features/social/pages/Profile.tabsKeyboard.test.tsx
 * ---------------------------------------------------------------------------
 * Gate-1 H-2 (NFR-001, WAI-ARIA tabs): the profile tablist is keyboard-operable.
 * Before the fix the arrow keys changed the SELECTION but never moved FOCUS, so a
 * keyboard user's focus stayed on the old tab and the next key navigated from the
 * wrong place. Selection follows focus (automatic activation), and:
 *   - ArrowRight/ArrowLeft move to the next/previous tab and WRAP;
 *   - Home/End jump to the first/last tab;
 *   - only the selected tab is in the tab order (roving tabindex);
 *   - `aria-controls` is on the selected tab only (inactive panels are not in the
 *     DOM, so they must not be referenced);
 *   - the tabpanel is itself a tab stop (`tabIndex=0`) so Tab from the tablist lands
 *     in the content even when it has no focusable control.
 * Driven with real `userEvent` keyboard input against the real page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { Profile } from './Profile'

const OWN_ID = 'persona-dreyes_fh'

const TAB_NAMES = ['Posts', 'Posts & replies', 'Media', 'Likes'] as const

function renderProfile() {
  // A QueryClient: the Likes tab renders video cards, and F2's VideoPlayer reads
  // `useChromeConfig()` (React Query) for the exercise watermark.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={OWN_ID} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

function tab(name: (typeof TAB_NAMES)[number]): HTMLElement {
  return screen.getByRole('tab', { name })
}

/** Asserts `name` is the focused AND selected tab, and no other tab is selected. */
function expectCurrent(name: (typeof TAB_NAMES)[number]) {
  expect(tab(name)).toHaveFocus()
  expect(tab(name)).toHaveAttribute('aria-selected', 'true')
  for (const other of TAB_NAMES.filter(n => n !== name)) {
    expect(tab(other)).toHaveAttribute('aria-selected', 'false')
  }
}

beforeEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests({ withDemoFixtures: true })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  postStore.resetForTests()
  vi.restoreAllMocks()
})

describe('Profile tablist — keyboard (H-2)', () => {
  it('ArrowRight moves focus AND selection to the next tab', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()
    expectCurrent('Posts')

    await user.keyboard('{ArrowRight}')

    expectCurrent('Posts & replies')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'profile-tab-replies')

    await user.keyboard('{ArrowRight}')
    expectCurrent('Media')
  })

  it('ArrowRight wraps from the last tab to the first', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()
    await user.keyboard('{End}')
    expectCurrent('Likes')

    await user.keyboard('{ArrowRight}')

    expectCurrent('Posts')
  })

  it('walks the full ring with ArrowRight and wraps back to the start', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()

    for (const expected of ['Posts & replies', 'Media', 'Likes', 'Posts'] as const) {
      await user.keyboard('{ArrowRight}')
      expectCurrent(expected)
    }
  })

  it('ArrowLeft moves back, and wraps from the first tab to the last', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()

    await user.keyboard('{ArrowLeft}')
    expectCurrent('Likes')

    await user.keyboard('{ArrowLeft}')
    expectCurrent('Media')
  })

  it('End jumps to the last tab and Home to the first', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()

    await user.keyboard('{End}')
    expectCurrent('Likes')

    await user.keyboard('{Home}')
    expectCurrent('Posts')
  })

  it('keeps a roving tabindex: only the selected tab is in the tab order', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()
    await user.keyboard('{ArrowRight}')

    expect(tab('Posts & replies')).toHaveAttribute('tabindex', '0')
    for (const other of ['Posts', 'Media', 'Likes'] as const) {
      expect(tab(other)).toHaveAttribute('tabindex', '-1')
    }
  })

  it('ignores other keys (no selection or focus change)', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    tab('Posts').focus()

    await user.keyboard('a{ArrowDown}{ArrowUp}')

    expectCurrent('Posts')
  })
})

describe('Profile tabs — ARIA wiring (H-2)', () => {
  it('references a panel only from the SELECTED tab, and that panel exists', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    for (const name of TAB_NAMES) {
      await user.click(tab(name))
      const controls = tab(name).getAttribute('aria-controls')
      expect(controls, `${name} controls its panel`).toBeTruthy()
      expect(document.getElementById(controls ?? '')).toBe(screen.getByRole('tabpanel'))
      for (const other of TAB_NAMES.filter(n => n !== name)) {
        // The inactive tabs' panels are not in the DOM, so they must not be referenced.
        expect(tab(other)).not.toHaveAttribute('aria-controls')
      }
    }
  })

  it('makes the tabpanel a tab stop reachable from the tablist with Tab', async () => {
    const user = userEvent.setup()
    renderProfile()
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('tabindex', '0')

    // Dana has no media posts, so the Media panel holds only a sentence: no focusable
    // control. That is exactly when the panel itself must be focusable.
    await user.click(tab('Media'))
    expect(await screen.findByText('No media yet.')).toBeInTheDocument()
    tab('Media').focus()
    await user.tab()

    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })
})
