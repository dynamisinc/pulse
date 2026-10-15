/**
 * features/social/pages/Profile.bannerBands.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06, Gate-1 M-4 ("EVERYTHING must be watermarked"): the persona
 * banner PHOTO on the profile hero carries the EXERCISE bands under the same rule as
 * every other participant image (`isWatermarkRequired`, driven through a mocked
 * `useChromeConfig`); the plain accent tint (no photo) carries none. Rendered through
 * the real provider stack in mock mode, as `Profile.brandProfile.test.tsx` does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { api } from '@/core/services/api'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { Profile } from './Profile'

const ctl = vi.hoisted(() => ({ enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfig: (): ChromeConfig => ({
      enabled: ctl.enabled,
      watermark: ctl.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

const FULCO_ID = 'persona-fulcoem' // seeded with a banner photo
const TBRANDT_ID = 'persona-tbrandt41' // no banner

function renderProfile(personaId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <SocialDirectoryProvider>
              <Profile personaId={personaId} />
            </SocialDirectoryProvider>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  ctl.enabled = true
  ctl.watermark = true
  postStore.resetForTests()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  resetExerciseClock()
  postStore.resetForTests()
  vi.restoreAllMocks()
})

describe('Profile — EXERCISE bands on the banner photo', () => {
  it('marks the banner photo (top + bottom) when required', async () => {
    renderProfile(FULCO_ID)
    await screen.findByTestId('profile-banner-image')

    const banner = screen.getByTestId('profile-banner')
    expect(within(banner).getByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    expect(within(banner).getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
  })

  it('renders NO band on the photo when not required (watermark off, banner on)', async () => {
    ctl.watermark = false
    renderProfile(FULCO_ID)
    await screen.findByTestId('profile-banner-image')

    expect(within(screen.getByTestId('profile-banner')).queryByTestId('exercise-bands')).toBeNull()
  })

  it('marks it when the chrome is off even with the watermark switch off', async () => {
    ctl.enabled = false
    ctl.watermark = false
    renderProfile(FULCO_ID)
    await screen.findByTestId('profile-banner-image')

    expect(within(screen.getByTestId('profile-banner')).getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('puts no bands on the plain accent tint (a persona with no banner photo)', async () => {
    renderProfile(TBRANDT_ID)
    await screen.findByRole('heading', { name: 'Tom Brandt' })

    expect(within(screen.getByTestId('profile-banner')).queryByTestId('exercise-bands')).toBeNull()
  })
})
