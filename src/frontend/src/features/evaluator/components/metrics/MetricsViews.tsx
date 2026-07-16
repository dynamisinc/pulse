/**
 * features/evaluator/components/metrics/MetricsViews.tsx
 * ---------------------------------------------------------------------------
 * The Metrics view (D6): latency, coverage, and sentiment panels together.
 * Pre-E8 (D6-011): sentiment collapses to an honest "engine off" card;
 * latency + coverage (event-log-derived) stay fully usable regardless.
 */

import { Stack } from '@mui/material'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { useMetrics } from '../../hooks/useMetrics'
import { LatencyPanel } from './LatencyPanel'
import { CoveragePanel } from './CoveragePanel'
import { SentimentPanel, SentimentUnavailableCard } from './SentimentPanel'

export function MetricsViews() {
  const { engineOn } = useEvaluatorState()
  const { latencyRows, coverageRows, sentiment } = useMetrics()

  return (
    <Stack sx={{ gap: 1.75, maxWidth: 1080 }}>
      <LatencyPanel rows={latencyRows} />
      <CoveragePanel rows={coverageRows} />
      {engineOn ? <SentimentPanel data={sentiment} /> : <SentimentUnavailableCard />}
    </Stack>
  )
}
