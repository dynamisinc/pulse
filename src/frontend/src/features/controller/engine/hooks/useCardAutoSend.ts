/**
 * features/controller/engine/hooks/useCardAutoSend.ts
 * ---------------------------------------------------------------------------
 * ONE answer to "will an expired review card AUTO-SEND (vs hold)?" for the visible countdown
 * label ("sends in" / "holds in").
 *  - LIVE: the SERVER decides, so this follows the same server-derived rule as the banner,
 *    `timeoutAutoSendState(...) === 'active'`, from the engine settings only. The browser-local
 *    kill-switch store is NOT consulted (another console may have stopped/restored since).
 *  - MOCK: the client decides (`DraftTimerDriver` resolves locally), so it uses the same
 *    `wouldAutoSendOnExpiry` rule the mock timers use, with the local effective autonomy.
 * STAFF world, no UI.
 */
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { effectiveTimeoutAutoSend, timeoutAutoSendState } from '../models/effectiveTimeoutAutoSend'
import { wouldAutoSendOnExpiry } from '../services/autoHoldPolicy'
import { useEngineControl } from './useEngineControl'
import { useEngineSettings } from './useEngineSettings'

export function useCardAutoSend(): boolean {
  const { settings } = useEngineSettings()
  const { effective } = useEngineControl()
  const swamped = settings?.autonomy.swampedMode ?? false
  if (!USE_MOCK_DATA) return timeoutAutoSendState(swamped, settings) === 'active'
  return wouldAutoSendOnExpiry(
    effective,
    effectiveTimeoutAutoSend(swamped, settings),
    settings?.providerCutToFake ?? false,
  )
}
