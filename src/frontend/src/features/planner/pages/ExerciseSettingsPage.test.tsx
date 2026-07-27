/**
 * features/planner/pages/ExerciseSettingsPage.test.tsx
 * ---------------------------------------------------------------------------
 * THE MOUNT GUARD for the exercise-settings composition point (feature:
 * exercise-configuration; #41). It asserts one thing only: that every section
 * the page is supposed to compose is REACHABLE and actually RENDERS.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS — "built, tested, and inert"
 * ============================================================================
 * `ComplianceChromePanel.test.tsx` and `PracticeModePanel.test.tsx` render their
 * panels DIRECTLY, so they pass whether or not this page mounts them. Delete a
 * `<PracticeModePanel />` line — or just its entry in the page's `SECTIONS`
 * registry — and every panel suite stays green, the build type-checks, lint is
 * clean, and a planner simply has no way to reach the control in the running
 * app. That is the same failure class the backend composition-root guards close
 * (`CompositionRootWiringTests`), on the other side of the stack, and this
 * feature was already bitten by it once: all three wave-3 slices merged fully
 * green with `Program.cs` calling none of their extensions.
 * `App.integration.test.tsx` covers the page's ROUTE composition — that it is
 * reachable — but never looks at its contents, so nothing else in the suite can
 * see a missing mount.
 *
 * ============================================================================
 * WHAT CHANGED WITH THE SECTION NAV — AND WHAT DID NOT
 * ============================================================================
 * The page was a single scroll of three stacked panels, so the guard could
 * assert all three headings at once. It is now a left nav + content pane, and
 * an UNSELECTED section is `hidden` — deliberately out of the accessibility
 * tree, which is exactly why `getByRole` (which ignores hidden subtrees) stops
 * finding it. The old "all three h2s, exactly once each" assertion would fail
 * for a legitimate reason, so it is replaced — NOT weakened. The guard now
 * asserts, per section:
 *
 *   1. the section has a nav item (so it can be reached at all), and
 *   2. selecting it renders that section's OWN content.
 *
 * Both halves must hold: a section with a nav entry and no content is as broken
 * as content with no way to reach it, and each half fails a different deletion.
 *
 * ============================================================================
 * HOW IT ASSERTS — by what only the real panel renders
 * ============================================================================
 * Each section's content is found by its OWN `<h2>` heading and by the labelled
 * `region` landmark that heading names (each panel is a `<section
 * aria-labelledby>`). Deliberately NOT by `data-testid`: a testid is trivially
 * satisfiable by a stub or a placeholder, and a guard that a stand-in can pass
 * is not a guard. The heading text is also the panel's real accessible name, so
 * this doubles as a check that the page keeps its NFR-001 "one h1, a section per
 * panel" structure.
 *
 * Nav items ARE addressed by testid in one place only — the mutation-proof
 * "every section has a nav item" check needs a stable handle per id — but every
 * assertion about what a nav item *is* goes through its accessible name and
 * `aria-current`.
 *
 * ============================================================================
 * SCOPE — COMPOSITION ONLY. NOT PANEL BEHAVIOUR.
 * ============================================================================
 * The three data seams are mocked at the SERVICE layer, exactly as the panel
 * suites mock them, so `@/core/services/api` is never touched (no real axios
 * sink, no Vitest worker-teardown footgun). Each getter returns a promise that
 * NEVER SETTLES, which leaves every panel in its `isPending` branch: the heading
 * and the section landmark render unconditionally, so the mount is fully
 * observable while nothing here depends on a DTO fixture. That keeps this a fast
 * composition guard that cannot rot when a panel's wire contract changes — the
 * panels' own suites own their loaded, error and save behaviour, and this file
 * must not grow into a second copy of them.
 *
 * The one exception is the unsaved-changes and hidden-section-error behaviour:
 * that is the PAGE's own logic (it lives in the nav, not in a panel), so those
 * tests load the settings seam for real and are grouped separately below.
 *
 * TWO WORLDS — STAFF (D0 §2). Rendered inside the COBRA `ThemeProvider` and a
 * React Query client, the same envelope `StaffShellFrame` + `App.tsx` give it.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseSettingsPage } from './ExerciseSettingsPage'
import { getExerciseSettings, type ExerciseSettings } from '../services/exerciseSettingsService'
import { getChromeSettings } from '../services/chromeSettingsService'
import { getPracticeMode } from '../services/practiceModeService'

vi.mock('../services/exerciseSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/exerciseSettingsService')>()
  return { ...actual, getExerciseSettings: vi.fn(), updateExerciseSettings: vi.fn() }
})

vi.mock('../services/chromeSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/chromeSettingsService')>()
  return { ...actual, getChromeSettings: vi.fn(), updateChromeSettings: vi.fn() }
})

vi.mock('../services/practiceModeService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/practiceModeService')>()
  return { ...actual, getPracticeMode: vi.fn(), setPracticeMode: vi.fn() }
})

/**
 * A promise that never settles — the panels stay `isPending`, so each renders its
 * heading and section with no state update to await and no fixture to maintain.
 */
function pendingForever<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

/**
 * Every section the page must compose: its nav-item testid, the name of the nav
 * item a planner clicks, and the `<h2>` / region name only the real content
 * renders. Deleting an entry from the page's `SECTIONS` registry, or deleting a
 * panel mount, fails against this table.
 */
const SECTIONS = [
  { id: 'identity', nav: 'Identity & schedule', heading: 'Identity & schedule' },
  { id: 'channels', nav: 'Channels', heading: 'Channels' },
  { id: 'theming', nav: 'Theming & outlets', heading: 'Theming & outlets' },
  { id: 'chrome', nav: 'Compliance chrome', heading: 'Compliance chrome' },
  { id: 'practice', nav: 'Practice / sandbox', heading: 'Practice / sandbox' },
] as const

/** A part-configured exercise, for the page-owned tests that need a loaded form. */
const SETTINGS: ExerciseSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  name: 'Atlanta CIE 2026',
  worldName: 'Metro Atlanta',
  locale: null,
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.0000000+00:00',
  scheduledEndAt: null,
  channels: [
    { id: 'social', label: 'Social', enabled: true },
    { id: 'news', label: 'News', enabled: false },
  ],
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: {},
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExerciseSettingsPage />, { wrapper: Wrapper })
}

/** The page's section nav — a real `<nav>` with an accessible name. */
function nav(): HTMLElement {
  return screen.getByRole('navigation', { name: /exercise configuration sections/i })
}

beforeEach(() => {
  vi.mocked(getExerciseSettings).mockReset().mockImplementation(pendingForever)
  vi.mocked(getChromeSettings).mockReset().mockImplementation(pendingForever)
  vi.mocked(getPracticeMode).mockReset().mockImplementation(pendingForever)
})

describe('ExerciseSettingsPage — composition-point mount guard', () => {
  it.each(SECTIONS)('offers a nav item for the $id section', ({ id, nav: name }) => {
    renderPage()

    // Present in the nav landmark (not merely somewhere on the page)...
    const item = screen.getByTestId(`exercise-config-nav-${id}`)
    expect(nav()).toContainElement(item)
    // ...and reachable by the accessible name a planner actually reads.
    expect(within(nav()).getByRole('button', { name })).toBe(item)
  })

  it.each(SECTIONS)('renders the $id section’s own content when it is selected', async ({ id, heading }) => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId(`exercise-config-nav-${id}`))

    // The panel's own h2 — not a testid a stub could satisfy.
    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
    // ...and the section landmark that heading names, which the panel owns.
    expect(screen.getByRole('region', { name: heading })).toBeInTheDocument()
  })

  it('lands on a real section on arrival, with no clicking required', () => {
    // A page whose content pane starts empty is a broken page, however good the
    // nav is.
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: 'Identity & schedule' })).toBeInTheDocument()
    expect(screen.getByTestId('exercise-config-nav-identity')).toHaveAttribute('aria-current', 'page')
  })

  it('shows exactly one section at a time', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('exercise-config-nav-practice'))

    // Exactly one h2 is in the accessibility tree: the selected section's. A
    // duplicated mount line, or a section that failed to hide, fails here.
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Practice / sandbox')
  })

  it('keeps every section inside the page main landmark', async () => {
    const user = userEvent.setup()
    renderPage()
    const page = screen.getByTestId('exercise-settings-page')

    for (const section of SECTIONS) {
      await user.click(screen.getByTestId(`exercise-config-nav-${section.id}`))
      // A panel rendered outside the <main> would not be in the work area the
      // staff shell scrolls.
      expect(
        within(page).getAllByRole('heading', { level: 2, name: section.heading }),
      ).toHaveLength(1)
    }
  })

  it('keeps the page a single main landmark with exactly one h1', () => {
    // NFR-001: the panels are h2 sections under ONE page h1. A panel that started
    // rendering its own h1 — or a second page title — would break the heading
    // outline a screen-reader user navigates by.
    renderPage()

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Exercise configuration')
  })
})

describe('ExerciseSettingsPage — section nav accessibility (NFR-001)', () => {
  it('marks only the selected section with aria-current', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('exercise-config-nav-chrome'))

    expect(screen.getByTestId('exercise-config-nav-chrome')).toHaveAttribute('aria-current', 'page')
    for (const section of SECTIONS) {
      if (section.id === 'chrome') continue
      expect(screen.getByTestId(`exercise-config-nav-${section.id}`)).not.toHaveAttribute(
        'aria-current',
      )
    }
  })

  it('moves focus to the content pane so a keyboard user lands on what they chose', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('exercise-config-nav-practice'))

    const content = screen.getByTestId('exercise-config-content')
    await waitFor(() => expect(content).toHaveFocus())
    expect(content).toHaveAttribute('aria-label', 'Practice / sandbox settings')
  })

  it('does not steal focus on first render', () => {
    renderPage()

    // Focus belongs to the document until the planner asks for a section; yanking
    // it on mount would drop a screen-reader user past the page heading.
    expect(screen.getByTestId('exercise-config-content')).not.toHaveFocus()
  })

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup()
    renderPage()

    // Real <button>s in a real <nav>: Tab reaches them, Enter activates them —
    // no roving tabindex, no arrow-key contract half-implemented.
    const chrome = screen.getByTestId('exercise-config-nav-chrome')
    chrome.focus()
    expect(chrome).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { level: 2, name: 'Compliance chrome' })).toBeInTheDocument()
  })
})

describe('ExerciseSettingsPage — unsaved changes and off-screen validation', () => {
  beforeEach(() => {
    vi.mocked(getExerciseSettings).mockReset().mockResolvedValue(SETTINGS)
  })

  it('says nothing about unsaved changes while the settings form is clean', async () => {
    renderPage()
    await screen.findByTestId('exercise-settings-form')

    expect(screen.queryByTestId('exercise-settings-unsaved-notice')).not.toBeInTheDocument()
  })

  it('warns — icon and words — once the shared settings form is dirty', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('exercise-settings-form')

    await user.type(screen.getByLabelText('World name'), '!')

    const notice = await screen.findByTestId('exercise-settings-unsaved-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/unsaved exercise settings/i)
    expect(notice.querySelector('svg')).not.toBeNull()
  })

  it('keeps the edit, and says where it is, when the planner moves to another form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('exercise-settings-form')
    await user.type(screen.getByLabelText('World name'), '!')

    // Practice mode is a DIFFERENT form with a different save — this is the move
    // that could abandon an edit, so the notice must say it did not.
    await user.click(screen.getByTestId('exercise-config-nav-practice'))

    const notice = screen.getByTestId('exercise-settings-unsaved-notice')
    expect(notice).toHaveTextContent(/nothing was discarded/i)
    expect(notice).toHaveTextContent(/identity & schedule/i)

    // ...and the way back restores the edit rather than a fresh form.
    await user.click(screen.getByRole('button', { name: /back to identity & schedule/i }))
    expect(screen.getByLabelText('World name')).toHaveValue('Metro Atlanta!')
  })

  it('marks a section in the nav whose field blocked a save from another section', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('exercise-settings-form')

    // Break a CHANNELS field, walk away to theming, then save from there.
    await user.click(screen.getByTestId('exercise-config-nav-channels'))
    await user.click(screen.getByRole('checkbox', { name: 'Social' }))
    await user.click(screen.getByTestId('exercise-config-nav-theming'))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    // The nav says which section needs attention, in words as well as colour...
    const marker = await screen.findByTestId('exercise-config-nav-error-channels')
    expect(marker).toHaveTextContent(/needs attention/i)
    expect(marker.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()

    // ...and the planner has been taken there, so the error is not off-screen.
    expect(screen.getByRole('heading', { level: 2, name: 'Channels' })).toBeInTheDocument()
    expect(screen.getByTestId('exercise-config-nav-channels')).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
