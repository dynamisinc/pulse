/**
 * features/evaluator/pages/EvaluatorDashboardPage.tsx
 * ---------------------------------------------------------------------------
 * Work-area content for the Evaluator Dashboard (D6), hosted inside the real
 * shared staff shell (D7) — `App.tsx` mounts this page as `StaffShellFrame`'s
 * `children`, with `StaffHeader` / `Toolstrip` filling the frame's header /
 * toolstrip slots. This component registers its own tools into the ONE
 * shell-owned toolstrip dock (`EvaluatorToolstripRegistration`, D7-011)
 * rather than drawing a strip of its own.
 *
 * Four views: Live (storyline board + live stream + read-only world view),
 * Timeline (filterable event explorer), Replay (video-scrubber over the
 * exercise), Metrics (latency / coverage / sentiment). Read-only throughout
 * (COR-013) — steering lives in the Controller Console.
 */

import { Box, Stack, Typography } from '@mui/material'
import { EvaluatorStateProvider, useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { EvaluatorToolstripRegistration } from '../components/shell/EvaluatorToolstripRegistration'
import { EvaluatorFlyoutLayer } from '../components/shell/EvaluatorFlyoutLayer'
import { DevExerciseStateToggle } from '../components/DevExerciseStateToggle'
import { StorylineBoard } from '../components/StorylineBoard'
import { LiveStream } from '../components/LiveStream'
import { WorldView } from '../components/WorldView'
import { TimelineExplorer } from '../components/TimelineExplorer'
import { ReplayPlayer } from '../components/replay/ReplayPlayer'
import { MetricsViews } from '../components/metrics/MetricsViews'
import type { EvaluatorView } from '../types'

const TABS: EvaluatorView[] = ['live', 'timeline', 'replay', 'metrics']

function EvaluatorDashboardContent() {
  const { view, setView } = useEvaluatorState()

  return (
    <Stack sx={{ gap: 1.75, p: '18px 22px', minHeight: '100%' }}>
      <DevExerciseStateToggle />

      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, borderBottom: '1px solid #dcdcdc', pb: 0 }}>
        {TABS.map(tab => {
          const active = view === tab
          return (
            <Box
              key={tab}
              component="button"
              onClick={() => setView(tab)}
              sx={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                font: '700 12px ui-sans-serif,system-ui,sans-serif',
                letterSpacing: '.1em',
                padding: '8px 14px',
                color: active ? '#1e3a5f' : '#848482',
                boxShadow: active ? 'inset 0 -2.5px 0 #1e3a5f' : 'none',
              }}
            >
              {tab.toUpperCase()}
            </Box>
          )
        })}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482', pb: 0.75 }}>
          Read-only — evaluators observe; steering lives in the Controller Console (COR-013)
        </Typography>
      </Stack>

      {view === 'live' && (
        <Stack sx={{ gap: 1.75 }}>
          <StorylineBoard />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 1.75, alignItems: 'start' }}>
            <LiveStream />
            <WorldView />
          </Box>
        </Stack>
      )}

      {view === 'timeline' && <TimelineExplorer />}
      {view === 'replay' && <ReplayPlayer />}
      {view === 'metrics' && <MetricsViews />}
    </Stack>
  )
}

export function EvaluatorDashboardPage() {
  return (
    <EvaluatorStateProvider>
      {/* The frame's work-area column is the positioning context; the surface
          owns its own scroll + its absolutely-positioned flyout overlays. */}
      <Box sx={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          <EvaluatorToolstripRegistration />
          <EvaluatorDashboardContent />
        </Box>
        <EvaluatorFlyoutLayer />
      </Box>
    </EvaluatorStateProvider>
  )
}
