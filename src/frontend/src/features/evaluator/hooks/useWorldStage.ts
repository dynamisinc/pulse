/**
 * features/evaluator/hooks/useWorldStage.ts
 * ---------------------------------------------------------------------------
 * Read-only participant-stage snapshot at scenario minute `t` (COR-053 —
 * scenario time only). Backs both `WorldView` (pinned to "now") and the
 * replay stage (scrubbable). TODO(EVL-003): replace with the replay-bundle
 * query once it exists.
 */

import { useMemo } from 'react'
import { getStageContent } from '../services/stageContent'
import type { StageContent } from '../types'

export function useWorldStage(t: number): StageContent {
  return useMemo(() => getStageContent(t), [t])
}
