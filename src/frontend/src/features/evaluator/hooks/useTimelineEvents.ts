/**
 * features/evaluator/hooks/useTimelineEvents.ts
 * ---------------------------------------------------------------------------
 * Filterable event list for `TimelineExplorer` (D6-004): chip filters
 * (channel / origin / storyline / range) + actor search applied to the mock
 * event log. TODO(EVL-001/002): replace `TIMELINE_EVENTS` with a paginated
 * event-log query; keep the filter contract (`TimelineFilters`) identical so
 * `TimelineExplorer` doesn't change.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { TIMELINE_EVENTS } from '../services/mockData'
import type { TimelineEvent } from '../types'

export function useTimelineEvents(): TimelineEvent[] {
  const { timelineFilters } = useEvaluatorState()

  return useMemo(() => TIMELINE_EVENTS.filter(e => {
    if (timelineFilters.channel !== 'All' && e.channel !== timelineFilters.channel) return false
    if (timelineFilters.origin !== 'All' && !e.origin.startsWith(timelineFilters.origin)) return false
    if (timelineFilters.storyline !== 'All' && e.storyline !== timelineFilters.storyline) return false
    if (timelineFilters.range === 'First 30m' && e.t > 30) return false
    if (timelineFilters.range === 'After advisory' && e.t < 31) return false
    if (
      timelineFilters.actorQuery
      && !e.actor.toLowerCase().includes(timelineFilters.actorQuery.toLowerCase())
    ) return false
    return true
  }), [timelineFilters])
}
