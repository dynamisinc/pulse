/**
 * features/planner/pages/ExerciseSettingsPage.test.tsx
 * ---------------------------------------------------------------------------
 * THE MOUNT GUARD for the exercise-settings composition point (feature:
 * exercise-configuration; #41). It asserts one thing only: that the page
 * actually RENDERS each panel it is supposed to compose.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS — "built, tested, and inert"
 * ============================================================================
 * `ComplianceChromePanel.test.tsx` and `PracticeModePanel.test.tsx` render their
 * panels DIRECTLY, so they pass whether or not this page mounts them. Delete a
 * `<PracticeModePanel />` line and every panel suite stays green, the build
 * type-checks, lint is clean — and a planner simply has no way to reach the
 * control in the running app. That is the same failure class the backend
 * composition-root guards close (`CompositionRootWiringTests`), on the other
 * side of the stack, and this feature was already bitten by it once: all three
 * wave-3 slices merged fully green with `Program.cs` calling none of their
 * extensions. `App.integration.test.tsx` covers the page's ROUTE composition —
 * that it is reachable — but never looks at its contents, so nothing else in the
 * suite can see a missing mount.
 *
 * ============================================================================
 * HOW IT ASSERTS — by what only the real panel renders
 * ============================================================================
 * Each panel is found by its OWN `<h2>` heading and by the labelled `region`
 * landmark that heading names (each panel is a `<section aria-labelledby>`).
 * Deliberately NOT by `data-testid`: a testid is trivially satisfiable by a stub
 * or a placeholder, and a guard that a stand-in can pass is not a guard. The
 * heading text is also the panel's real accessible name, so this doubles as a
 * check that the page keeps its NFR-001 "one h1, a section per panel" structure.
 *
 * ============================================================================
 * SCOPE — MOUNTING ONLY. NOT PANEL BEHAVIOUR.
 * ============================================================================
 * The three data seams are mocked at the SERVICE layer, exactly as the panel
 * suites mock them, so `@/core/services/api` is never touched (no real axios
 * sink, no Vitest worker-teardown footgun). Each getter returns a promise that
 * NEVER SETTLES, which leaves every panel in its `isPending` branch: the heading
 * and the section landmark render unconditionally, so the mount is fully
 * observable while nothing here depends on a DTO fixture. That keeps this a fast
 * mount guard that cannot rot when a panel's wire contract changes — the panels'
 * own suites own their loaded, error and save behaviour, and this file must not
 * grow into a second copy of them.
 *
 * TWO WORLDS — STAFF (D0 §2). Rendered inside the COBRA `ThemeProvider` and a
 * React Query client, the same envelope `StaffShellFrame` + `App.tsx` give it.
 */
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseSettingsPage } from './ExerciseSettingsPage'
import { getExerciseSettings } from '../services/exerciseSettingsService'
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

/** The `<h2>` heading each panel renders — the thing only that panel puts on the page. */
const PANEL_HEADINGS = {
  settings: 'Exercise settings',
  chrome: 'Compliance chrome',
  practice: 'Practice / sandbox',
} as const

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

beforeEach(() => {
  vi.mocked(getExerciseSettings).mockReset().mockImplementation(pendingForever)
  vi.mocked(getChromeSettings).mockReset().mockImplementation(pendingForever)
  vi.mocked(getPracticeMode).mockReset().mockImplementation(pendingForever)
})

describe('ExerciseSettingsPage — composition-point mount guard', () => {
  it('mounts the compliance-chrome panel (story 02)', () => {
    renderPage()

    // The panel's own h2 — not a testid a stub could satisfy.
    expect(
      screen.getByRole('heading', { level: 2, name: PANEL_HEADINGS.chrome }),
    ).toBeInTheDocument()

    // ...and the section landmark that heading names, which the panel owns.
    expect(screen.getByRole('region', { name: PANEL_HEADINGS.chrome })).toBeInTheDocument()
  })

  it('mounts the practice/sandbox panel (story 04)', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { level: 2, name: PANEL_HEADINGS.practice }),
    ).toBeInTheDocument()

    expect(screen.getByRole('region', { name: PANEL_HEADINGS.practice })).toBeInTheDocument()
  })

  it('still mounts the exercise-settings panel (story 01b)', () => {
    // The pre-existing mount is guarded too: wave 3 added panels beside it, and a
    // composition point that quietly loses its ORIGINAL panel fails just as silently.
    renderPage()

    expect(
      screen.getByRole('heading', { level: 2, name: PANEL_HEADINGS.settings }),
    ).toBeInTheDocument()

    expect(screen.getByRole('region', { name: PANEL_HEADINGS.settings })).toBeInTheDocument()
  })

  it('renders every panel INSIDE the page main landmark, exactly once each', () => {
    renderPage()

    // Inside the <main>: a panel rendered somewhere else on the page would not be
    // in the work area the staff shell scrolls, and "exactly once" catches a
    // duplicated mount line as surely as a missing one.
    const page = screen.getByTestId('exercise-settings-page')

    for (const heading of Object.values(PANEL_HEADINGS)) {
      expect(within(page).getAllByRole('heading', { level: 2, name: heading })).toHaveLength(1)
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
