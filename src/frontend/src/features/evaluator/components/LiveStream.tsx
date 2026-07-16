/**
 * features/evaluator/components/LiveStream.tsx
 * ---------------------------------------------------------------------------
 * Everything entering the world, newest first (D6-003/008): ordinary posts,
 * off-platform response markers (☎, CTL-026), inject-fired rows, and the
 * distinct amber controller-dial rows (◆ "scenario design input — not
 * participant behavior") — dial rows are visually never confusable with
 * participant posts. Every row carries a ⚑ that opens annotation capture.
 *
 * TODO(NFR-001/XC-004): once this backs a real telemetry stream instead of a
 * static mock list, specify + implement live-region behavior (e.g. a
 * polite-announcing "N new" affordance rather than silently reflowing rows)
 * so burst-rate updates stay screen-reader legible — flagging per the a11y
 * cross-cutting AC rather than shipping a silent-live surface.
 */

import { Box, Stack, Tooltip, IconButton, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faFlag } from '@fortawesome/free-solid-svg-icons'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { useLiveStream } from '../hooks/useLiveStream'

const SEAL_BLUE = '#2D9CDB'

export function LiveStream() {
  const { openAnnotation } = useEvaluatorState()
  const rows = useLiveStream()

  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: '11px', borderBottom: '1px solid #dcdcdc' }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          LIVE STREAM
        </Typography>
        <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
          everything entering the world, newest first · ⚑ or B bookmarks a moment
        </Typography>
      </Stack>

      {rows.map(row => (
        <Stack
          key={row.id}
          direction="row"
          sx={{
            gap: 1.375,
            px: 2,
            py: 1.5,
            borderBottom: '1px solid #eceff2',
            bgcolor: row.background ?? 'transparent',
            '&:hover': { bgcolor: '#f4f7fa' },
          }}
        >
          <Box
            sx={{
              width: 34,
              height: 34,
              flex: 'none',
              borderRadius: row.avatarShape === 'circle' ? '50%' : '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: '800 12px ui-sans-serif,system-ui,sans-serif',
              color: '#fff',
              bgcolor: row.avatarBg,
            }}
          >
            {row.avatarText}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography sx={{ font: '700 12.5px ui-sans-serif,system-ui,sans-serif', color: row.nameColor ?? '#1a1a1a' }}>
                {row.name}
              </Typography>
              {row.verified && (
                <FontAwesomeIcon
                  icon={faCircleCheck}
                  style={{ color: SEAL_BLUE, width: 13, height: 13 }}
                />
              )}
              <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
                {row.sub}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ font: '600 10.5px ui-monospace,Menlo,monospace', color: '#848482' }}>
                {row.time}
              </Typography>
            </Stack>
            <Typography sx={{ font: '400 12.5px/1.5 ui-sans-serif,system-ui,sans-serif', mt: 0.375, color: '#1a1a1a' }}>
              {row.text}
            </Typography>
            <Typography sx={{ font: '600 9.5px ui-monospace,Menlo,monospace', letterSpacing: '.06em', color: '#848482', mt: 0.75 }}>
              {row.origin}
            </Typography>
          </Box>
          <Tooltip title="Bookmark this moment (B)">
            <IconButton
              size="small"
              onClick={() => openAnnotation(`${row.name} · ${row.time}`)}
              sx={{
                alignSelf: 'flex-start',
                border: '1px solid #c4c4c4',
                borderRadius: '6px',
                color: '#848482',
                p: '3px 8px',
                '&:hover': { color: '#1e3a5f', borderColor: '#1e3a5f', bgcolor: '#eef3f9' },
              }}
            >
              <FontAwesomeIcon icon={faFlag} size="2xs" />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
    </Box>
  )
}
