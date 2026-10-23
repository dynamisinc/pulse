/**
 * features/social/layout/renderChannel.testUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY render helpers shared by the F1 layout suites (it ships in no
 * runtime import path; only `*.test.tsx` files import it). It assembles the same
 * provider stack `App.tsx` stacks around the channel, so each suite states only
 * what it varies:
 *
 *   QueryClientProvider > MemoryRouter > ExerciseContextProvider > SessionProvider
 *     > ShellContextProvider > [optional MemorySocialNavigationProvider] > SocialChannel
 *
 * A FIXED scenario clock keeps relative times deterministic (COR-053). The
 * `MemoryRouter` stands in for the app's browser router; `RouterProbe`
 * (`./RouterProbe.testUtils.tsx`, passed via `beside`) exposes its REAL location and two
 * buttons that drive the router's history the way the browser's own Back / Forward
 * buttons would, so a suite can tell "the channel moved" from "the real address bar
 * moved".
 *
 * World: participant test scaffolding -- no COBRA, no MUI.
 */

import type { ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { setExerciseClock } from '@/core/clock'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { ExerciseEndedProvider } from '@/features/participant-shell/writeGate'
import { SocialChannel } from '../SocialChannel'
import { MemorySocialNavigationProvider } from './SocialNavigationProvider'

/** A scenario "now" just after the seeded Fairhaven arc (posts land 13:15-14:20Z). */
export const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

export interface RenderChannelOptions {
  /** The REAL router's entries (the app's address bar). Defaults to `['/home']`. */
  entries?: string[]
  variant?: ShellVariant
  /** The shell has not resolved the variant yet (cold load; MT-D8). */
  variantPending?: boolean
  /** Mount the channel under the memory navigation provider (C6's preview). */
  memory?: { initialEntries?: string[] }
  /** Render extra content beside the channel inside the router (probes). */
  beside?: ReactNode
  /**
   * Mount the whole stack under a parent ROUTE at this path (`<Route path="X/*">`)
   * instead of directly under the router -- the shape of a staff route hosting the
   * C6 preview. `entries` defaults to `[parentRoute]` when this is set.
   */
  parentRoute?: string
  /**
   * Mirror the app's route table: `/login` is a SIBLING route that replaces the
   * participant surface, and everything else is the channel under the `*` catch-all
   * (what `createRoleAwareRoutes` does). Needed to observe the sign-out redirect.
   */
  appRoutes?: boolean
  /** Start in the ENDED (read-only review) state. Flip later via `setShellMount({ ended })`. */
  ended?: boolean
}

/** What `renderChannel` returns: RTL's result plus a way to move the shell's mount state. */
export interface RenderChannelResult extends RenderResult {
  /**
   * Re-render the SAME tree with a new shell mount state (variant / pending), keeping every
   * component (and the query client) mounted: how the shell's variant query settles after a
   * cold load (MT-D8).
   */
  setShellMount: (next: {
    variant?: ShellMountProps['variant']
    variantPending?: boolean
    ended?: boolean
  }) => void
}

export function renderChannel(options: RenderChannelOptions = {}): RenderChannelResult {
  const { memory, beside, parentRoute, appRoutes = false } = options
  const entries = options.entries ?? [parentRoute ?? '/home']
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const tree = (
    variant: ShellMountProps['variant'],
    variantPending: boolean | undefined,
    ended: boolean,
  ) => {
    const mount: ShellMountProps = { variant, scenarioNow: SCENARIO_NOW, variantPending }
    const channel = <SocialChannel />
    const stack = (
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={mount}>
            <ExerciseEndedProvider ended={ended}>
              {memory === undefined
                ? channel
                : (
                  <MemorySocialNavigationProvider
                    {...(memory.initialEntries !== undefined
                      ? { initialEntries: memory.initialEntries }
                      : {})}
                  >
                    {channel}
                  </MemorySocialNavigationProvider>
                )}
            </ExerciseEndedProvider>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    )
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={entries}>
          {appRoutes
            ? (
              <Routes>
                <Route path="/login" element={<p data-testid="login-page">Sign in</p>} />
                <Route path="*" element={stack} />
              </Routes>
            )
            : parentRoute === undefined
              ? stack
              : (
                <Routes>
                  <Route path={`${parentRoute}/*`} element={stack} />
                </Routes>
              )}
          {beside}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  let current = {
    variant: options.variant ?? 'full',
    variantPending: options.variantPending,
    ended: options.ended ?? false,
  }
  const result = render(tree(current.variant, current.variantPending, current.ended))
  return {
    ...result,
    setShellMount: next => {
      current = { ...current, ...next }
      result.rerender(tree(current.variant, current.variantPending, current.ended))
    },
  }
}
