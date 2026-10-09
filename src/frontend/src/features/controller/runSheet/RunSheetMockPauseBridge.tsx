/**
 * features/controller/runSheet/RunSheetMockPauseBridge.tsx
 * ---------------------------------------------------------------------------
 * MOCK-MODE ONLY: makes the pause tier a controller sets through `PausePill` /
 * `usePauseState` visible to the run sheet's in-memory mock queue, so PAUSE INJECTS and
 * FREEZE are demoable under `npm run dev` (inject-queue story 07, review M-2; IQ-5).
 * STAFF world. Renders nothing.
 *
 * WHY IT EXISTS. Live, the server owns the tier: `GET /api/injects` reports `pauseTier`
 * and the server's burst runner honours it, so PausePill -> `POST /api/steering/pause-tier`
 * -> the next poll shows the banner. The mock queue has no server to ask: its tier is its
 * own field, and `usePauseState` keeps the tier in a module store the mock cannot see. So
 * in mock mode this component copies the store's tier into the mock
 * (`injectMock.setPauseTier`) whenever it changes, suspending/resuming the mock's burst
 * runner exactly as the server would, and invalidates the queue read so the panel's
 * banner follows at once instead of on the next 3 s poll.
 *
 * WHERE THE SEAM IS. This is deliberately NOT inside `RunSheetPanel` (which stays prop-less
 * and knows nothing of `usePauseState`): the console route mounts it beside the panel. In
 * LIVE mode it renders nothing and never calls `usePauseState`: the run sheet gets its tier
 * from the server, so this adds no pause-tier GET or POST of its own (in mock mode
 * `usePauseState` makes no network call at all).
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { usePauseState } from '../hooks/usePauseState'
import { injectMock } from './injectMock'

function PauseTierToMock() {
  const { tier } = usePauseState()
  const queryClient = useQueryClient()

  useEffect(() => {
    injectMock.setPauseTier(tier)
    // The run sheet shows the tier the queue READ reports: re-read now, not in <= 3 s.
    void queryClient.invalidateQueries({ queryKey: ['injects'] })
  }, [tier, queryClient])

  return null
}

export function RunSheetMockPauseBridge() {
  return USE_MOCK_DATA ? <PauseTierToMock /> : null
}
