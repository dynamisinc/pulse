/**
 * features/social/theme/forcedLight.darkOs.test.tsx
 * ---------------------------------------------------------------------------
 * TRIPWIRE: no JS branch in the social tree reacts to the OS colour scheme.
 *
 * What this is NOT: proof that the page is light under a dark OS. The original defect
 * was CSS-only (per-module `@media (prefers-color-scheme: dark)` / `[data-theme]`
 * blocks), jsdom applies no stylesheets, and this test passes on the pre-fix tree too
 * (Gate-1 M-1). The REAL proof of "forced light" is `forcedLight.guard.test.ts`, which
 * reads every stylesheet under features/social/** off disk and fails on any dark-mode
 * rule, plus `documentHead.test.ts` (the document pins `color-scheme: light`). A manual
 * dark-OS check is a Gate-2 item.
 *
 * What it DOES guard: with `matchMedia` reporting a dark OS, a rendered social tree (the
 * profile page, the feed skeleton, the brand scope) neither asks the browser about the
 * OS scheme nor sets a theme attribute anywhere. If someone later adds a JS-driven
 * dark mode (a `matchMedia('(prefers-color-scheme: dark)')` listener, a `data-theme`
 * toggle), this fails. Together with the guard: no CSS rule and no JS branch reacts to
 * a dark OS.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { BrandThemeProvider } from '@/features/participant-shell/BrandThemeProvider'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { FeedSkeleton } from '../components/FeedSkeleton'
import { Profile } from '../pages/Profile'
import { SocialBrandScope } from './SocialBrandScope'

let queries: string[] = []
const realMatchMedia = window.matchMedia

beforeEach(() => {
  resetTelemetryBuffer()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
  queries = []
  // A dark-mode OS: every `prefers-color-scheme: dark` query matches.
  window.matchMedia = (query: string): MediaQueryList => {
    queries.push(query)
    return {
      matches: /prefers-color-scheme:\s*dark/i.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  }
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  vi.restoreAllMocks()
})

describe('tripwire: no JS branch reacts to a dark OS', () => {
  it('really reports a dark OS (so the checks below are meaningful)', () => {
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(true)
    expect(window.matchMedia('(prefers-color-scheme: light)').matches).toBe(false)
    queries = []
  })

  it('a rendered social tree never reads the OS colour scheme and sets no theme attribute', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <SessionProvider>
            <BrandThemeProvider>
              <SocialBrandScope>
                <ShellContextProvider
                  value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
                >
                  <Profile personaId="persona-fairhavenwater" />
                </ShellContextProvider>
              </SocialBrandScope>
            </BrandThemeProvider>
          </SessionProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await screen.findAllByTestId('post-card')

    expect(queries.filter(q => /color-scheme/i.test(q))).toEqual([])
    expect(document.querySelector('[data-theme]')).toBeNull()
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.style.colorScheme).not.toMatch(/dark/)
  })

  it('the loading skeleton is light too (no scheme query, no theme attribute)', () => {
    render(<FeedSkeleton />)

    expect(queries.filter(q => /color-scheme/i.test(q))).toEqual([])
    expect(document.querySelector('[data-theme]')).toBeNull()
  })
})
