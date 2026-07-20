/**
 * features/controller/engine/console/EngineControlBar.tsx
 * ---------------------------------------------------------------------------
 * The engine-control chrome strip (feature: engine-review-cockpit, integration
 * seam; ADP-042, D5 §2 "Engine control" + §3 "NEEDS YOU action bar", D5-014/2.7,
 * NFR-001). STAFF world — dark COBRA operator chrome (matches `ReviewQueue`'s
 * D5 tokens), MUI 9 `sx`-only system props, FontAwesome icons only. Mounted at
 * the top of the console work area by `ControllerConsole`.
 *
 * Renders, left to right:
 *  a. The ALWAYS-VISIBLE kill switch (ADP-042) — cycles Live -> Suggest-only ->
 *     STOP ENGINE -> Live via `useEngineControl().setMode`. Text + icon + a
 *     status dot; the dot is a SUPPLEMENT to the text label, never the sole
 *     signal (NFR-001).
 *  b. The degrade-mode indicator — text + icon, shown only while
 *     `useEngineControl().degraded` is true (a mock provider-degraded clamp to
 *     Suggest). A small dev-only affordance toggles it for demoing the
 *     composition with `DraftTimerDriver` (optional per the integration spec).
 *  c. The CTL-034 demand meter (`useDemandMeter`) — "N / 6" + a fill bar, amber
 *     past budget, with a tooltip stating it measures DEMAND, never controller
 *     performance (D5-014/2.7).
 *  d. The inline "N need review / N timers <60s" indicator — reads the SAME
 *     `useReviewQueue()` the docked `<ReviewQueue>` reads (D5-014/2.1
 *     counts-consistency; the store is a singleton, so both calls agree by
 *     construction). Empty state "All clear".
 *  e. `<SwampedModeToggle>` — self-contained, lead-gated.
 */

import { useMemo } from 'react'
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBolt,
  faCircleCheck,
  faGaugeHigh,
  faPowerOff,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { SwampedModeToggle } from '../components/SwampedModeToggle'
import { useDemandMeter } from '../hooks/useDemandMeter'
import { useEngineControl, type EngineMode } from '../hooks/useEngineControl'
import { useReviewQueue } from '../hooks/useReviewQueue'

/** D5 dark operator-chrome tokens (matches `ReviewQueue`'s `chrome`). Staff-only. */
const chrome = {
  bg: '#0a1017',
  panel: '#0f1826',
  line: '#28384b',
  ink: '#e9eff7',
  inkMuted: '#9db1c8',
  inkFaint: '#63758b',
  blue: '#4d97d1',
  red: '#e42217',
  amber: '#f5a623',
  green: '#33a06f',
} as const

/** The kill switch's cycle order + display copy (D5 §2 "Live / Suggest-only / STOP ENGINE"). */
const MODE_CYCLE: readonly EngineMode[] = ['live', 'suggest-only', 'stop']

const MODE_COPY: Readonly<Record<EngineMode, { label: string; tone: string }>> = {
  live: { label: 'ENGINE · LIVE', tone: chrome.green },
  'suggest-only': { label: 'ENGINE · SUGGEST-ONLY', tone: chrome.amber },
  stop: { label: 'ENGINE · STOPPED', tone: chrome.red },
}

function nextMode(mode: EngineMode): EngineMode {
  const index = MODE_CYCLE.indexOf(mode)
  return MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? 'live'
}

export function EngineControlBar() {
  const engineControl = useEngineControl()
  const demand = useDemandMeter()
  const { pendingCount, timersUnder60sCount } = useReviewQueue()

  const modeCopy = MODE_COPY[engineControl.mode]
  const demandFraction = useMemo(
    () => Math.min(1, demand.demand / Math.max(1, demand.budget)),
    [demand.demand, demand.budget],
  )
  const allClear = pendingCount === 0 && timersUnder60sCount === 0

  return (
    <Stack
      direction="row"
      data-testid="engine-control-bar"
      sx={{
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1.25,
        px: 2,
        py: 1,
        bgcolor: chrome.bg,
        borderBottom: `1px solid ${chrome.line}`,
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      {/* a. Kill switch — always visible, text + icon + dot (never color-only). */}
      <Box
        component="button"
        type="button"
        data-testid="engine-kill-switch"
        data-mode={engineControl.mode}
        aria-label={`${modeCopy.label} — activate to switch to ${MODE_COPY[nextMode(engineControl.mode)].label}`}
        onClick={() => engineControl.setMode(nextMode(engineControl.mode))}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: chrome.ink,
          bgcolor: chrome.panel,
          border: `1px solid ${modeCopy.tone}`,
          borderRadius: '20px',
          cursor: 'pointer',
          '&:hover': { borderColor: chrome.blue },
        }}
      >
        <FontAwesomeIcon icon={faPowerOff} color={modeCopy.tone} aria-hidden="true" />
        {modeCopy.label}
        <Box
          aria-hidden="true"
          sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: modeCopy.tone, flex: 'none' }}
        />
      </Box>

      {/* b. Degrade-mode indicator — text + icon, only while degraded. Default healthy. */}
      {engineControl.degraded ? (
        <Stack
          direction="row"
          data-testid="engine-degraded-indicator"
          role="status"
          sx={{ alignItems: 'center', gap: 0.6, px: 1, py: 0.4, border: `1px solid ${chrome.amber}`, borderRadius: '20px' }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
          <Typography component="span" sx={{ fontSize: 10.5, fontWeight: 700, color: chrome.amber }}>
            PROVIDER DEGRADED — clamped to Suggest
          </Typography>
          <Box
            component="button"
            type="button"
            data-testid="engine-degraded-restore"
            onClick={() => engineControl.restore()}
            sx={{
              fontSize: 10,
              fontWeight: 700,
              color: chrome.blue,
              bgcolor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Restore
          </Box>
        </Stack>
      ) : import.meta.env.DEV ? (
        // Dev-only affordance: `degrade()` trips a safety clamp, so it must not
        // be reachable by an operator in a real (production) exercise build.
        <Box
          component="button"
          type="button"
          data-testid="engine-degraded-simulate"
          onClick={() => engineControl.degrade('generation provider degraded (mock)')}
          sx={{
            fontSize: 10,
            fontWeight: 600,
            color: chrome.inkFaint,
            bgcolor: 'transparent',
            border: `1px dashed ${chrome.line}`,
            borderRadius: '20px',
            px: 1,
            py: 0.35,
            cursor: 'pointer',
            '&:hover': { color: chrome.inkMuted, borderColor: chrome.inkMuted },
          }}
        >
          Simulate degraded (dev)
        </Box>
      ) : null}

      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: chrome.line }} />

      {/* c. CTL-034 demand meter — demand, never controller performance. */}
      <Tooltip title="Decisions the engine is demanding per minute — this measures DEMAND on the engine's design, never controller performance.">
        <Stack
          direction="row"
          data-testid="demand-meter"
          data-over-budget={demand.overBudget ? 'true' : 'false'}
          sx={{ alignItems: 'center', gap: 0.6 }}
        >
          <FontAwesomeIcon
            icon={faGaugeHigh}
            color={demand.overBudget ? chrome.amber : chrome.inkMuted}
            aria-hidden="true"
          />
          <Typography
            component="span"
            data-testid="demand-meter-count"
            sx={{
              fontSize: 11,
              fontWeight: 700,
              color: demand.overBudget ? chrome.amber : chrome.inkMuted,
            }}
          >
            {demand.demand} / {demand.budget}
          </Typography>
          <Box sx={{ width: 46, height: 5, borderRadius: 3, bgcolor: chrome.line, overflow: 'hidden' }}>
            <Box
              data-testid="demand-meter-bar"
              sx={{
                height: '100%',
                width: `${Math.round(demandFraction * 100)}%`,
                bgcolor: demand.overBudget ? chrome.amber : chrome.blue,
              }}
            />
          </Box>
        </Stack>
      </Tooltip>

      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: chrome.line }} />

      {/* d. Inline needs-review indicator — SAME useReviewQueue() source as the queue. */}
      <Stack
        direction="row"
        data-testid="needs-review-indicator"
        role="status"
        aria-live="polite"
        sx={{ alignItems: 'center', gap: 0.6 }}
      >
        <FontAwesomeIcon
          icon={allClear ? faCircleCheck : faBolt}
          color={allClear ? chrome.green : chrome.blue}
          aria-hidden="true"
        />
        <Typography component="span" sx={{ fontSize: 11, fontWeight: 700, color: allClear ? chrome.green : chrome.ink }}>
          {allClear
            ? 'All clear'
            : `${pendingCount} need review · ${timersUnder60sCount} timer${timersUnder60sCount === 1 ? '' : 's'} <60s`}
        </Typography>
      </Stack>

      <Box sx={{ flex: 1 }} />

      {/* e. Swamped mode — self-contained, lead-gated. */}
      <SwampedModeToggle />
    </Stack>
  )
}
