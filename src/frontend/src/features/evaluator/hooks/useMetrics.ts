/**
 * features/evaluator/hooks/useMetrics.ts
 * ---------------------------------------------------------------------------
 * Data for `MetricsViews` (D6-008/009/010/011): response latency (incl.
 * off-platform markers, CTL-026), coverage/missed-opportunity rows with
 * provisional-until-confirmed display state (D6-010), and sentiment-chart
 * geometry with the controller-dial overlay (D6-008).
 *
 * TODO(EVL-010...015): replace `LATENCY_ROWS` / `SENTIMENT_POINTS` with a
 * metrics-query result; coverage stays evaluator-owned state (confirm/
 * dismiss is a judgment call, not engine output) so it lives in
 * `EvaluatorStateContext`, not here.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import {
  AXIS_TICKS,
  DIAL_MARKS,
  LATENCY_ROWS,
  SENTIMENT_POINTS,
  evidenceChipPalette,
} from '../services/mockData'
import {
  buildAxisTickGeometry,
  buildDialMarkers,
  buildSentimentPath,
  seamXPosition,
} from '../services/sentimentGeometry'
import { TIME_JUMP_T } from '../services/scenarioTime'
import type { CoverageItem, CoverageStatus, LatencyRow } from '../types'

export type CoverageChipVariant = 'addressed' | 'confirmed' | 'provisional'

export interface CoverageRowView {
  item: CoverageItem;
  glyph: string;
  glyphColor: string;
  edgeColor: string;
  opacity: number;
  chipLabel: string;
  chipVariant: CoverageChipVariant;
  /** Only unconfirmed rows carry Confirm-for-AAR / Dismiss actions. */
  pending: boolean;
}

function buildCoverageRowView(item: CoverageItem): CoverageRowView {
  const status: CoverageStatus = item.status
  const chipLabel = status === 'addressed'
    ? 'ADDRESSED'
    : status === 'confirmed'
      ? `MISSED · CONFIRMED ${item.confirmedBy ?? ''}`.trim()
      : 'PROVISIONAL — NOT IN AAR YET'
  return {
    item,
    glyph: status === 'addressed' ? '✓' : '✕',
    glyphColor: status === 'addressed' ? '#256b43' : '#b3261e',
    edgeColor: status === 'addressed' ? '#2e7d4f' : status === 'confirmed' ? '#b3261e' : '#c4c4c4',
    opacity: status === 'unconfirmed' ? 0.78 : 1,
    chipLabel,
    chipVariant: status === 'addressed' ? 'addressed' : status === 'confirmed' ? 'confirmed' : 'provisional',
    pending: status === 'unconfirmed',
  }
}

export interface SentimentChartData {
  path: string;
  dialMarkers: ReturnType<typeof buildDialMarkers>;
  axisTicks: ReturnType<typeof buildAxisTickGeometry>;
  seamX: string;
}

export interface MetricsData {
  latencyRows: LatencyRow[];
  coverageRows: CoverageRowView[];
  sentiment: SentimentChartData;
  provisionalCount: number;
}

export function useMetrics(): MetricsData {
  const { coverageItems } = useEvaluatorState()

  const coverageRows = useMemo(() => coverageItems.map(buildCoverageRowView), [coverageItems])
  const provisionalCount = useMemo(
    () => coverageItems.filter(c => c.status === 'unconfirmed').length,
    [coverageItems],
  )

  const sentiment = useMemo<SentimentChartData>(() => ({
    path: buildSentimentPath(SENTIMENT_POINTS),
    dialMarkers: buildDialMarkers(DIAL_MARKS),
    axisTicks: buildAxisTickGeometry(AXIS_TICKS),
    seamX: seamXPosition(TIME_JUMP_T),
  }), [])

  return { latencyRows: LATENCY_ROWS, coverageRows, sentiment, provisionalCount }
}

export { evidenceChipPalette }
