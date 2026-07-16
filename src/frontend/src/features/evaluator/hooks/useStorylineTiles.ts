/**
 * features/evaluator/hooks/useStorylineTiles.ts
 * ---------------------------------------------------------------------------
 * Storyline board data (D6-001). Today this just re-shapes the mock fixtures
 * by exercise state; the seam for a real integration is here — swap the body
 * for a React Query call against the exercise-context/telemetry API
 * (XC-004) and every consumer (`StorylineBoard`) is unaffected.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { getStorylineTiles } from '../services/mockData'
import type { StorylineTile } from '../types'

export function useStorylineTiles(): StorylineTile[] {
  const { exerciseState } = useEvaluatorState()
  // TODO(XC-004): replace with useQuery(['storyline-tiles', exerciseId]) once
  // the telemetry stream exists; keep the same StorylineTile[] shape.
  return useMemo(() => getStorylineTiles(exerciseState), [exerciseState])
}
