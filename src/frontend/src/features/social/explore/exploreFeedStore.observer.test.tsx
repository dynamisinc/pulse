/**
 * features/social/explore/exploreFeedStore.observer.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 low (D1-011), through the React binding and the REAL shared arrival
 * source. `useFeedStream` and `useThread` never open the stream for an observer /
 * read-only mount (`affordancesAvailable(variant)` false); the always-mounted right
 * rail's Explore baseline used to start it regardless, so an observer opened (and held)
 * a live transport it must not have:
 *
 *  - `variant: 'readOnly'` -> the baseline is READ (Trending / search are not blank) and
 *    `defaultFeedStreamSource.start()` is never called;
 *  - `variant: 'full'` -> it is started, exactly once (the ref-counted shared source).
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetTelemetryBuffer } from '@/core/telemetry'
// Import order matters: `exploreTestUtils` (-> the Explore store) must load before
// `feedStreamSource`, or the store's `defaultFeedStreamSource` default binds while that
// module is still mid-evaluation through the `@/features/social` barrel cycle.
import { renderExplore, resetExplore, seedPost } from './exploreTestUtils'
import { useExploreBaseline } from './useExploreFeed'
import { defaultFeedStreamSource } from '../services/feedStreamSource'

function Probe() {
  const { posts, loading } = useExploreBaseline()
  return <output data-testid="baseline">{loading ? 'loading' : `ready:${posts.length}`}</output>
}

afterEach(() => {
  resetExplore()
  resetTelemetryBuffer()
  vi.restoreAllMocks()
})

describe('the Explore baseline vs the arrival stream (D1-011)', () => {
  it('an observer (readOnly) mount reads the baseline but never starts the shared stream', async () => {
    seedPost({ id: 'ob-1', text: 'an observer sees this #Obs', at: '2033-09-04T10:00:00Z' })
    const start = vi.spyOn(defaultFeedStreamSource, 'start')
    const stop = vi.spyOn(defaultFeedStreamSource, 'stop')

    const { unmount } = renderExplore(<Probe />, { variant: 'readOnly' })
    await waitFor(() => expect(screen.getByTestId('baseline')).toHaveTextContent(/^ready:[1-9]/))

    expect(start).not.toHaveBeenCalled()
    unmount()
    await Promise.resolve()
    expect(stop).not.toHaveBeenCalled()
  })

  it('a full (interactive) mount starts it once', async () => {
    seedPost({ id: 'ob-2', text: 'a participant sees this #Obs', at: '2033-09-04T10:00:00Z' })
    const start = vi.spyOn(defaultFeedStreamSource, 'start')

    renderExplore(<Probe />, { variant: 'full' })
    await waitFor(() => expect(screen.getByTestId('baseline')).toHaveTextContent(/^ready:[1-9]/))

    expect(start).toHaveBeenCalledTimes(1)
  })
})
