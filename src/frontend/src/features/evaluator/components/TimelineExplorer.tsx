/**
 * features/evaluator/components/TimelineExplorer.tsx
 * ---------------------------------------------------------------------------
 * Filterable event explorer (D6-004, EVL-001/002): chip filters (channel /
 * origin / storyline / range) + actor search. Rows behind a shared org
 * account carry a visible (not hover-only) "⌨ D. Reyes" attribution chip
 * (COR-018); off-platform responses are first-class rows tagged
 * "☎ OFF-PLATFORM · CTL-026". "View in situ →" deep-links into Replay at
 * that scenario moment.
 */

import { Box, Stack, Typography, Chip, Button, IconButton, Tooltip } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlag, faArrowRight, faKeyboard } from '@fortawesome/free-solid-svg-icons'
import { CobraTextField } from '@/theme/styledComponents'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { useTimelineEvents } from '../hooks/useTimelineEvents'
import { scenarioClock } from '../services/scenarioTime'
import type { TimelineChannel, TimelineFilters, WorldChannel } from '../types'

const CHANNEL_PALETTE: Record<TimelineChannel, { bg: string; fg: string }> = {
  PULSE: { bg: '#eef3f9', fg: '#1e3a5f' },
  PORTAL: { bg: '#fdf3e3', fg: '#8a5300' },
  WIRE: { bg: '#eef7f0', fg: '#256b43' },
  STAFF: { bg: '#fff3dd', fg: '#8a5300' },
  'OFF-PLATFORM': { bg: '#efeaf7', fg: '#5b4a7a' },
}

function replayChannelFor(channel: TimelineChannel): WorldChannel {
  return channel === 'PORTAL' ? 'portal' : 'pulse'
}

interface FilterGroup {
  key: keyof TimelineFilters;
  label: string;
  options: string[];
}

const FILTER_GROUPS: FilterGroup[] = [
  { key: 'channel', label: 'CHANNEL', options: ['All', 'PULSE', 'PORTAL', 'WIRE', 'OFF-PLATFORM'] },
  { key: 'origin', label: 'ORIGIN', options: ['All', 'ENGINE', 'INJ', 'SIMCELL', 'PARTICIPANT', 'CONTROLLER'] },
  { key: 'storyline', label: 'STORYLINE', options: ['All', '#WaterIssues', 'Boil Advisory', 'Millbrook Rumor'] },
  { key: 'range', label: 'RANGE', options: ['All', 'First 30m', 'After advisory'] },
]

export function TimelineExplorer() {
  const {
    timelineFilters, setTimelineFilter, openAnnotation, jumpToReplayMoment,
  } = useEvaluatorState()
  const events = useTimelineEvents()

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap', bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', px: 1.75, py: 1.25 }}
      >
        {FILTER_GROUPS.map(group => (
          <Stack key={group.key} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ font: '800 9px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.12em', color: '#848482' }}>
              {group.label}
            </Typography>
            {group.options.map(option => {
              const selected = timelineFilters[group.key] === option
              return (
                <Chip
                  key={option}
                  label={option}
                  size="small"
                  clickable
                  onClick={() => setTimelineFilter(group.key, option)}
                  sx={{
                    fontWeight: 600,
                    fontSize: 11,
                    borderRadius: '999px',
                    border: `1px solid ${selected ? '#1e3a5f' : '#c4c4c4'}`,
                    bgcolor: selected ? '#1e3a5f' : 'transparent',
                    color: selected ? '#fff' : '#4a4f55',
                  }}
                />
              )
            })}
          </Stack>
        ))}
        <CobraTextField
          size="small"
          placeholder="actor / handle…"
          value={timelineFilters.actorQuery}
          onChange={e => setTimelineFilter('actorQuery', e.target.value)}
          sx={{ width: 150, '& .MuiOutlinedInput-root': { borderRadius: '999px' } }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ font: '600 10.5px ui-monospace,Menlo,monospace', color: '#848482' }}>
          {events.length} EVENTS
        </Typography>
      </Stack>

      <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', overflow: 'hidden' }}>
        {events.map(event => {
          const palette = CHANNEL_PALETTE[event.channel]
          return (
            <Box
              key={event.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: '74px 84px minmax(0,1fr) auto',
                gap: 1.5,
                alignItems: 'start',
                px: 2,
                py: '11px',
                borderBottom: '1px solid #eceff2',
                bgcolor: event.isDial ? '#fffaf0' : 'transparent',
                '&:hover': { bgcolor: '#f4f7fa' },
              }}
            >
              <Typography sx={{ font: '700 11px ui-monospace,Menlo,monospace', color: '#4a4f55', pt: 0.25 }}>
                {scenarioClock(event.t)}
              </Typography>
              <Box>
                <Chip
                  label={event.channel}
                  size="small"
                  sx={{
                    fontWeight: 800,
                    fontSize: 9,
                    letterSpacing: '.08em',
                    borderRadius: '5px',
                    bgcolor: palette.bg,
                    color: palette.fg,
                    height: 20,
                  }}
                />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography sx={{ font: '700 12px ui-sans-serif,system-ui,sans-serif', color: event.isDial ? '#8a5300' : '#1a1a1a' }}>
                    {event.actor}
                  </Typography>
                  {event.humanAttribution && (
                    <Tooltip title="Shared org account — per-human attribution (COR-018)">
                      <Chip
                        icon={<FontAwesomeIcon icon={faKeyboard} size="2xs" />}
                        label={event.humanAttribution}
                        size="small"
                        sx={{
                          fontWeight: 600,
                          fontSize: 10,
                          color: '#1e3a5f',
                          bgcolor: '#eef3f9',
                          border: '1px solid #b9c7d8',
                          borderRadius: '999px',
                          height: 20,
                        }}
                      />
                    </Tooltip>
                  )}
                  {event.isOffPlatform && (
                    <Chip
                      label="☎ OFF-PLATFORM · CTL-026"
                      size="small"
                      sx={{
                        fontWeight: 700,
                        fontSize: 9,
                        letterSpacing: '.04em',
                        color: '#5b4a7a',
                        bgcolor: '#efeaf7',
                        border: '1px solid #c9b8e8',
                        borderRadius: '4px',
                        height: 20,
                      }}
                    />
                  )}
                  <Typography sx={{ font: '600 9.5px ui-monospace,Menlo,monospace', color: '#848482' }}>
                    {event.origin}
                  </Typography>
                </Stack>
                <Typography sx={{ font: '400 12px/1.5 ui-sans-serif,system-ui,sans-serif', mt: 0.25, color: '#1a1a1a' }}>
                  {event.text}
                </Typography>
              </Box>
              <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                <Tooltip title="Bookmark (B)">
                  <IconButton
                    size="small"
                    onClick={() => openAnnotation(`${event.actor} · ${scenarioClock(event.t)}`)}
                    sx={{ border: '1px solid #c4c4c4', borderRadius: '6px', color: '#848482', '&:hover': { color: '#1e3a5f', borderColor: '#1e3a5f' } }}
                  >
                    <FontAwesomeIcon icon={faFlag} size="2xs" />
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  onClick={() => jumpToReplayMoment(event.t, replayChannelFor(event.channel))}
                  title="Open Replay at this moment — see it as participants did (EVL-002)"
                  endIcon={<FontAwesomeIcon icon={faArrowRight} size="2xs" />}
                  sx={{ border: '1px solid #b9c7d8', borderRadius: '6px', color: '#1e3a5f', fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap' }}
                >
                  View in situ
                </Button>
              </Stack>
            </Box>
          )
        })}
      </Box>
    </Stack>
  )
}
