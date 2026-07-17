/**
 * features/evaluator/hooks/useReplayTrack.ts
 * ---------------------------------------------------------------------------
 * Replay scrubber track data (D6-005): the activity ridgeline, the staff
 * lane (inject ▸ / controller-dial ◆ markers — never mixed into activity
 * data), the scenario-time-jump seam position, and bookmark ⚑ marks derived
 * from the evaluator's own annotations. TODO(EVL-003): back the ridge with
 * the real replay-bundle activity histogram; staff marks with the MSEL +
 * dial-event log.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { RIDGE_HEIGHTS_PCT, STAFF_LANE_MARK_SEEDS } from '../services/mockData'
import { ARC_DURATION_MINUTES, TIME_JUMP_T, percentOfArc } from '../services/scenarioTime'
import type { BookmarkMark, RidgePoint, StaffLaneMark } from '../types'

const SCENARIO_START_MINUTES = 14 * 60 + 20
const TIME_JUMP_MINUTES = 4 * 60

export interface ReplayTrackData {
  ridge: RidgePoint[];
  staffMarks: StaffLaneMark[];
  bookmarkMarks: BookmarkMark[];
  seamLeftPct: number;
}

/** Recovers elapsed scenario minutes `t` from an annotation's `HH:MM` time. */
function elapsedMinutesFromScenarioClock(time: string): number {
  const parts = time.split(':')
  const hh = Number(parts[0])
  const mm = Number(parts[1])
  const raw = hh * 60 + mm - SCENARIO_START_MINUTES
  const unwrapped = raw > ARC_DURATION_MINUTES ? raw - TIME_JUMP_MINUTES : raw
  return Math.min(ARC_DURATION_MINUTES, Math.max(0, unwrapped))
}

export function useReplayTrack(): ReplayTrackData {
  const { annotations } = useEvaluatorState()

  const ridge = useMemo<RidgePoint[]>(
    () => RIDGE_HEIGHTS_PCT.map(heightPct => ({ heightPct })),
    [],
  )

  const staffMarks = useMemo<StaffLaneMark[]>(() => STAFF_LANE_MARK_SEEDS.map((seed, i) => ({
    id: `staff-mark-${i}`,
    t: seed.t,
    leftPct: percentOfArc(seed.t),
    glyph: seed.glyph,
    color: seed.color,
    tooltip: seed.tooltip,
  })), [])

  const bookmarkMarks = useMemo<BookmarkMark[]>(() => annotations.slice(0, 6).map((a, i) => {
    const t = elapsedMinutesFromScenarioClock(a.time)
    return { id: `bookmark-${i}-${a.id}`, t, leftPct: percentOfArc(t), tooltip: a.note }
  }), [annotations])

  return { ridge, staffMarks, bookmarkMarks, seamLeftPct: percentOfArc(TIME_JUMP_T) }
}
