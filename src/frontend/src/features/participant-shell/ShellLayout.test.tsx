/**
 * features/participant-shell/ShellLayout.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (channel-mount contract) — integration-level coverage for
 * `ShellLayout.tsx`: the single scenario-time source (AC2), the zero-styling
 * reset boundary (AC1), the z-order/stacking-context contract (AC3), and
 * exercise-scoping with no exercise/admin leak into the content region (AC4).
 *
 * Renders the REAL `ExerciseContextProvider` + `useShellState` (both resolve
 * through the shared axios client's built-in mock adapter, exactly as the
 * shipped app does) so this exercises the actual mount path a channel gets in
 * production, not a stand-in for it.
 *
 * jsdom caveat (AC1): jsdom's `getComputedStyle` does not implement the CSS
 * `all` shorthand's cascade-blocking effect - empirically, a descendant's
 * computed `color`/`fontFamily` keeps walking up to an ancestor's inline
 * style even when an intermediate element sets `all: initial` (jsdom reports
 * `all` itself as the literal string "see individual properties" and never
 * expands it). Real browsers DO block the cascade there - which is exactly
 * why `ShellLayout.tsx`'s own header documents `all: initial` (not `revert`)
 * as the mechanism that "actually guarantees no inherited enterprise styling
 * reaches the channel". Since this harness cannot observe that cascade
 * outcome, the AC1 suite below asserts on the actual reset directive being
 * present on the content region, and on the region imposing no typography of
 * its OWN - the two things this harness CAN verify, and the two things that
 * would regress AC1 if either were removed.
 */
import type { CSSProperties, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { ShellLayout } from './ShellLayout'
import { SHELL_Z, useShellContext } from './mountContract'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** Mounts `children` through the real shell (real exercise scope + shell state). */
function renderShell(children: ReactNode, ancestorStyle?: CSSProperties) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const shell = (
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <ShellLayout>{children}</ShellLayout>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )

  return render(
    ancestorStyle
      ? <div data-testid="leaked-ancestor" style={ancestorStyle}>{shell}</div>
      : shell,
  )
}

/** Reads a mounted channel's props back out, for assertion. */
function MountPropsProbe() {
  const { variant, scenarioNow } = useShellContext()
  return (
    <div data-testid="probe">
      <span data-testid="variant">{variant}</span>
      <span data-testid="scenarioNow">{scenarioNow.toISOString()}</span>
    </div>
  )
}

afterEach(() => {
  resetExerciseClock()
})

describe('ShellLayout — single scenario-time source (AC2)', () => {
  it('passes the mounted channel a scenarioNow that traces to the injected exercise clock, not wall-clock', async () => {
    // A scenario instant nowhere near "now" at any real test-run time
    // (WAVE0-REVIEW precedent 18) - if ShellLayout ever leaked a real
    // wall-clock read instead of the exercise clock, this equality
    // assertion would fail rather than coincidentally passing.
    const injectedScenarioInstant = new Date('2031-11-02T09:15:00Z')
    setExerciseClock(fixedClock(injectedScenarioInstant))

    renderShell(<MountPropsProbe />)

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    expect(screen.getByTestId('scenarioNow')).toHaveTextContent(
      injectedScenarioInstant.toISOString(),
    )
  })

  it('reflects a changed exercise-clock instant on the next mount (scenarioNow is not a hardcoded value)', async () => {
    setExerciseClock(fixedClock(new Date('2019-05-04T03:00:00Z')))
    const first = renderShell(<MountPropsProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())
    expect(screen.getByTestId('scenarioNow')).toHaveTextContent('2019-05-04T03:00:00.000Z')
    first.unmount()

    setExerciseClock(fixedClock(new Date('2044-08-19T21:45:00Z')))
    renderShell(<MountPropsProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())
    expect(screen.getByTestId('scenarioNow')).toHaveTextContent('2044-08-19T21:45:00.000Z')
  })

  it('passes the mounted channel its variant via the same useShellContext() call as scenarioNow', async () => {
    setExerciseClock(fixedClock(new Date('2026-01-01T00:00:00Z')))

    renderShell(<MountPropsProbe />)

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    // The Wave-1 shell-state mock always resolves 'full' (see shellState.ts);
    // the point under test is that variant and scenarioNow arrive together
    // off one useShellContext() call, not that 'full' specifically is chosen.
    expect(screen.getByTestId('variant')).toHaveTextContent('full')
  })
})

describe('ShellLayout — zero-styling reset boundary (AC1)', () => {
  it('applies the CSS reset directive and imposes no color/font/background of its own on the content region', async () => {
    setExerciseClock(fixedClock(new Date('2026-06-01T00:00:00Z')))

    renderShell(<span data-testid="probe">content</span>, {
      color: 'rgb(255, 0, 0)',
      fontFamily: 'Comic Sans MS',
    })

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const region = screen.getByTestId('pulse-shell-content-region')
    const regionStyleAttr = region.getAttribute('style') ?? ''

    // The actual mechanism ShellLayout.tsx documents as the AC1 guarantee:
    // `all: initial` (never `revert` - see "The reset boundary" in the
    // module header) forces the CSS-spec initial value for every inherited
    // property regardless of an ancestor's rule. This fails if that
    // directive is ever removed from `contentRegionStyle`.
    expect(regionStyleAttr).toContain('all: initial')

    // Beyond inheriting nothing, the shell itself must impose no typography/
    // color/background of its own on the region - if it did, that alone
    // would violate "zero styling" before inheritance even enters into it.
    expect(regionStyleAttr).not.toMatch(/(?:^|;)\s*(color|font-family|font-weight|background)\s*:/i)
  })

  it('lets the channel set its own color/font untouched by the shell', async () => {
    setExerciseClock(fixedClock(new Date('2026-06-01T00:00:00Z')))

    renderShell(
      <span
        data-testid="probe"
        style={{ color: 'rgb(10, 20, 30)', fontFamily: 'Brand Sans' }}
      >
        content
      </span>,
      { color: 'rgb(255, 0, 0)', fontFamily: 'Comic Sans MS' },
    )

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const probe = screen.getByTestId('probe')
    expect(probe.style.color).toBe('rgb(10, 20, 30)')
    // A multi-word family name serializes quoted (`"Brand Sans"`) - the point
    // under test is that it's untouched, not the exact quoting form.
    expect(probe.style.fontFamily).toBe('"Brand Sans"')
  })
})

describe('ShellLayout — z-order / stacking-context contract (AC3)', () => {
  it('mounts the content region at SHELL_Z.content inside its own CSS stacking context', async () => {
    setExerciseClock(fixedClock(new Date('2026-06-01T00:00:00Z')))

    renderShell(<span data-testid="probe">content</span>)

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const region = screen.getByTestId('pulse-shell-content-region')
    const computed = getComputedStyle(region)

    expect(computed.zIndex).toBe(String(SHELL_Z.content))
    expect(computed.isolation).toBe('isolate')
    // A channel's own z-index values are scoped inside this stacking context
    // only because it IS one (`isolation: isolate` + a positioned box) - a
    // regression here is exactly what would let a channel draw above the
    // overlay layer despite SHELL_Z.content being numerically lowest.
    expect(computed.position).toBe('relative')
  })
})

describe('ShellLayout — exercise-scoped, no leak into the content region (AC4, XC-001/002)', () => {
  it('never renders the exercise id, name, or any exercise/admin/picker concept into the content region', async () => {
    setExerciseClock(fixedClock(new Date('2026-06-01T00:00:00Z')))

    renderShell(<span data-testid="probe">content</span>)

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const region = screen.getByTestId('pulse-shell-content-region')
    const regionHtml = region.innerHTML.toLowerCase()

    // The Wave-0 mock exercise scope's id/name (core/exerciseContext) - none
    // of it belongs in a channel's content region. useShellState reads
    // exerciseId only to KEY its query (shellState.test.ts covers that it's
    // never sent as a request param); it must never reach the DOM either.
    expect(regionHtml).not.toContain('ex-mock-0001')
    expect(regionHtml).not.toContain('coastal surge')
    for (const forbidden of ['exercise', 'picker', 'admin', 'switcher', 'simulation-status']) {
      expect(regionHtml).not.toContain(forbidden)
    }
  })
})
