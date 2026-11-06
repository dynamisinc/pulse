/**
 * features/portal/layout/moduleClickTelemetry.ts
 * ---------------------------------------------------------------------------
 * The live `trackClick` (PC-6 `portal_module_click`, XC-004 v0): exactly one
 * event per call through the caller-safe `buildAndEmit`, attributed to the
 * signed-in participant, stamped with scenario time from the exercise clock
 * (COR-053). Modules never emit it themselves. World: participant. No UI.
 */

import { useCallback } from 'react'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import type { PortalModuleId } from '../contract'
import type { PortalFrameEnvironment } from './frameEnvironmentContext'
import type { PortalModuleClickTarget } from './types'

/** Emits one `portal_module_click` for the signed-in participant (PC-6). */
export function usePortalModuleClickTelemetry(): PortalFrameEnvironment['trackClick'] {
  const { exerciseId, timeZone } = useExerciseContext()
  const { accountId } = useSession()
  return useCallback((moduleId: PortalModuleId, target?: PortalModuleClickTarget) => {
    buildAndEmit({
      exerciseId,
      eventType: 'portal_module_click',
      channel: 'portal',
      actor: { kind: 'participant', participantId: accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'portal_module', entityId: moduleId },
      ...(target?.contentId ? { payload: { contentId: target.contentId } } : {}),
    })
  }, [exerciseId, timeZone, accountId])
}
