/**
 * features/evaluator/hooks/useLiveStream.ts
 * ---------------------------------------------------------------------------
 * Live stream rows (D6-003/008) — everything entering the world, newest
 * first, including the distinct amber controller-dial rows and off-platform
 * markers. Mock-backed today; TODO(XC-004) swap for the live telemetry
 * stream (with a polling fallback per NFR-003) behind this same hook.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { getLiveStream } from '../services/mockData'
import type { LiveStreamRow } from '../types'

export function useLiveStream(): LiveStreamRow[] {
  const { exerciseState } = useEvaluatorState()
  return useMemo(() => getLiveStream(exerciseState), [exerciseState])
}
