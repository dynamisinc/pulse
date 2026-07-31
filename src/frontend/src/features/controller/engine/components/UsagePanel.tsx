/**
 * features/controller/engine/components/UsagePanel.tsx
 * ---------------------------------------------------------------------------
 * The AI-generation usage flyout (feature: engine-telemetry-tuning, story 03c;
 * ADP-041). STAFF world — dark COBRA operator chrome matching
 * `EngineSettingsPanel`'s/`ReviewQueue`'s/`EngineControlBar`'s existing
 * `chrome` tokens, MUI 9 `sx`-only system props, FontAwesome icons only.
 *
 * The console's "USAGE" toolstrip tool (`ControllerConsole.tsx`) renders this
 * flyout keyed on `useToolstrip().isActive(ENGINE_USAGE_TOOL_ID)` — the SAME
 * one-flyout-at-a-time toolstrip contract `EngineSettingsPanel`/"Personas"
 * already use (`useRegisterSurfaceTool()` / `useToolstrip()`,
 * `@/features/staffShell/toolRegistry`). NOT a second toolstrip, modal, or
 * route.
 *
 * ## What this is, and what it deliberately is NOT (see the story's Out of
 * Scope)
 * A live-ops volume/cost view over `GET /api/engine/usage` (story 03a) — "what
 * is the engine spending, right now, on which models". NOT story 02's
 * post-exercise hotwash/tuning surface; NOT a budget cap, spend limit, or
 * throttle (observability only); NO auto-refresh polling (`TelemetryEvents`
 * has no `EventType` index — every read re-scans the exercise's rows, so a
 * manual `refresh()` is the only refresh mechanism, plus the SAME
 * refetch-on-OPEN-TRANSITION staleness discipline `EngineSettingsPanel` uses);
 * NO charting library (the bucket series renders as a small CSS bar strip
 * PLUS a real, screen-reader-readable list of the same numbers — the bars are
 * `aria-hidden`, decorative only).
 *
 * ## AC1 — the provider statement is NOT this panel's to compute
 * "Which provider is live right now" is answered ONCE, by `useEngineSettings()`
 * (`GET /api/engine/settings`, already the source `EngineSettingsPanel`
 * renders) — this component reads `effectiveProvider` (what is ACTUALLY
 * serving this exercise's bursts right now) / `provider` (the
 * startup-configured provider, unchanged by a runtime cut) /
 * `providerCutToFake` / `alreadyFake` DIRECTLY off that hook's result, and
 * NEVER re-derives any of them by comparison (WR-003 — the exact
 * mislabelled-posture bug class that discipline exists to prevent). This is
 * kept STRUCTURALLY separate from the historical, per-row `byModel[].provider`
 * below, which answers a DIFFERENT question — "what produced THESE PAST
 * calls" — from the event log alone; if the governed provider has since
 * changed, historical rows still roll up under whatever actually produced
 * them. Both are shown; neither stands in for the other.
 *
 * ## AC2 — volume
 * Totals (calls, the four token categories kept VISUALLY DISTINCT — never
 * summed into one number — latency, guard-result mix), a dense call-count
 * series (aggregate + per-model), and a per-provider/model breakdown table.
 * The bucket series renders COUNTS, never a per-minute RATE (SG-001 — the
 * final bucket may cover less real time than a full `bucketMinutes` span, so
 * a rate would understate the freshest, most-watched point by up to half).
 *
 * ## AC3 — cost (a SEPARATELY LABELLED section, never merged into volume)
 * `priced: false` renders an explicit "Unpriced" state — NEVER `$0`, which
 * would read as "this was free" (the `Fake` provider genuinely IS `$0` by
 * construction — that reads as a priced zero-rate model, not "unpriced").
 * When `cost.anyUnpriced` is `true`, `cost.pricedTotalCost` is labelled as a
 * FLOOR — the true total spend, not this number.
 *
 * ## AC8 — honest about what isn't in the numbers
 * `unparseableEvents > 0` renders a standing banner (never silently folded
 * into a lower-looking total) — a silently-low spend number is the worst
 * failure mode this panel could produce. A `byModel` row with an empty
 * `provider`/`model` (a thin/partly-null stored payload) renders as
 * "Unattributed" rather than a blank cell or a crash — the call still cost
 * money.
 *
 * ## AC6 — wall-clock, labelled (COR-053 staff carve-out)
 * The server already says `window.clock === "wall-clock"` — every timestamp
 * this panel shows is explicitly labelled "(wall-clock)" so no reader has to
 * guess which clock they're looking at (this is the one staff surface where
 * wall-clock, not scenario time, is the useful axis).
 *
 * ## AC7 — accessibility (NFR-001)
 * Every severity/status cue pairs an icon AND a text label with colour —
 * never colour alone: the provider-cut indicator, the guard-result mix
 * (pass/drop/re-roll/unknown, each an icon+text chip), the unpriced state,
 * and the unparseable-events banner. The decorative bar strip is
 * `aria-hidden`; the SAME numbers are always also present as plain, readable
 * text/rows. Every control is a native `<button>`. `Escape` closes the
 * flyout; on open, focus moves to the close button; on close, focus returns
 * to whatever opened it (mirrors `EngineSettingsPanel`'s focus contract).
 *
 * ## Two worlds (XC-002/SOC-003)
 * Staff-only, COBRA chrome throughout. Never imported by a participant
 * surface — see `../participantIsolation.test.ts`, which structurally
 * forbids any participant import of `features/controller/engine/**`.
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon, type FontAwesomeIconProps } from '@fortawesome/react-fontawesome'
import {
  faArrowRotateRight,
  faCircleCheck,
  faCircleInfo,
  faCircleQuestion,
  faCircleXmark,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useEngineSettings } from '../hooks/useEngineSettings'
import {
  ENGINE_USAGE_WINDOW_PRESETS_MINUTES,
  useEngineUsage,
  type EngineUsageDto,
  type EngineUsageGuardResult,
  type EngineUsageModel,
  type EngineUsageModelCost,
  type EngineUsageTotals,
} from '../hooks/useEngineUsage'

/** Stable toolstrip-registry id for the console's "USAGE" surface tool. */
export const ENGINE_USAGE_TOOL_ID = 'engine-usage'

/** Accessible/section title for the usage flyout. */
export const ENGINE_USAGE_PANEL_TITLE = 'AI generation usage'

/** Flyout panel width — wider than the settings panel (a data-dense volume/cost view). */
const PANEL_WIDTH_PX = 460

/**
 * D5 dark operator-chrome tokens (matches `EngineSettingsPanel`'s/
 * `ReviewQueue`'s/`EngineControlBar`'s `chrome`).
 */
const chrome = {
  panel: '#0f1826',
  card: '#111c2b',
  cardBorder: '#1c2a3a',
  line: '#28384b',
  ink: '#e9eff7',
  inkMuted: '#9db1c8',
  inkFaint: '#63758b',
  blue: '#4d97d1',
  red: '#e42217',
  amber: '#f5a623',
  green: '#33a06f',
} as const

const WINDOW_LABELS: Record<number, string> = {
  1: '1 min',
  15: '15 min',
  60: '1 hr',
  240: '4 hr',
  1440: '24 hr',
}

function windowLabel(minutes: number): string {
  return WINDOW_LABELS[minutes] ?? `${minutes} min`
}

/** Formats a round-trip ISO wall-clock instant as a short local time, e.g. "14:32:05". */
function formatWallClockTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour12: false })
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

function formatTokens(value: number): string {
  return value.toLocaleString()
}

function formatMs(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`
}

function formatCurrency(value: number, currency: string): string {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`
}

/** An icon+text (never colour-only, NFR-001) chip for one guard-result value. */
function guardResultVisual(result: string): { icon: FontAwesomeIconProps['icon']; color: string; label: string } {
  switch (result) {
    case 'pass':
      return { icon: faCircleCheck, color: chrome.green, label: 'Pass' }
    case 'drop':
      return { icon: faCircleXmark, color: chrome.red, label: 'Drop' }
    case 're-roll':
      return { icon: faArrowRotateRight, color: chrome.amber, label: 'Re-roll' }
    case 'unknown':
      return { icon: faCircleQuestion, color: chrome.inkFaint, label: 'Unknown' }
    default:
      return { icon: faCircleQuestion, color: chrome.inkFaint, label: result }
  }
}

function GuardResultChip({ entry }: { entry: EngineUsageGuardResult }) {
  const visual = guardResultVisual(entry.result)
  return (
    <Stack
      direction="row"
      data-testid={`usage-guard-result-${entry.result}`}
      sx={{
        alignItems: 'center',
        gap: 0.5,
        px: 0.9,
        py: 0.4,
        border: `1px solid ${chrome.line}`,
        borderRadius: '6px',
        bgcolor: chrome.card,
      }}
    >
      <FontAwesomeIcon icon={visual.icon} color={visual.color} size="xs" aria-hidden="true" />
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: chrome.ink }}>
        {visual.label} — {formatCount(entry.calls)}
      </Typography>
    </Stack>
  )
}

/**
 * A decorative call-count bar strip (`aria-hidden`) ABOVE a real, readable
 * list of the same bucket numbers — the chart never carries information a
 * screen reader can't also get from plain text (NFR-001), and always shows
 * COUNTS, never a per-bucket rate (SG-001, this file's module header).
 */
function BucketSeries({ usage, label }: { usage: EngineUsageDto; label: string }) {
  const buckets = usage.buckets
  const maxCalls = buckets.reduce((max, b) => Math.max(max, b.calls), 0)

  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: chrome.inkMuted }}>
        {label}
      </Typography>
      <Stack
        direction="row"
        aria-hidden="true"
        sx={{ alignItems: 'flex-end', gap: '2px', height: 40, overflow: 'hidden' }}
      >
        {buckets.map((bucket, i) => (
          <Box
            key={`${bucket.startWallClock}-${i}`}
            sx={{
              flex: 1,
              minWidth: 2,
              height: maxCalls > 0 ? `${Math.max(4, (bucket.calls / maxCalls) * 100)}%` : '4%',
              bgcolor: bucket.calls > 0 ? chrome.blue : chrome.line,
              borderRadius: '1px',
            }}
          />
        ))}
      </Stack>
      <Box
        component="details"
        data-testid="usage-bucket-detail"
        sx={{ fontSize: 10.5, color: chrome.inkMuted }}
      >
        <Box component="summary" sx={{ cursor: 'pointer', color: chrome.blue, fontWeight: 700 }}>
          {buckets.length} buckets of {usage.window.bucketMinutes} min each — view exact counts
        </Box>
        <Stack component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0, maxHeight: 160, overflowY: 'auto', gap: '2px' }}>
          {buckets.map((bucket, i) => (
            <Box component="li" key={`${bucket.startWallClock}-row-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <span>{formatWallClockTime(bucket.startWallClock)}</span>
              <span>{formatCount(bucket.calls)} calls</span>
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}

/**
 * `testIdPrefix` is OPTIONAL and only supplied by the top-level (aggregate)
 * call site — the per-model rows below render the SAME breakdown without a
 * `data-testid`, so `usage-tokens-*` unambiguously names the window's
 * aggregate totals in tests rather than colliding with every model row.
 */
interface TokenBreakdownProps {
  readonly totals: EngineUsageTotals
  readonly testIdPrefix?: string
}

function TokenBreakdown({ totals, testIdPrefix }: TokenBreakdownProps) {
  const rows: ReadonlyArray<{ label: string; value: number }> = [
    { label: 'Input', value: totals.inputTokens },
    { label: 'Output', value: totals.outputTokens },
    { label: 'Cache-read', value: totals.cacheReadInputTokens },
    { label: 'Cache-creation', value: totals.cacheCreationInputTokens },
  ]
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.25 }}>
      {rows.map(row => {
        const slug = row.label.toLowerCase().replace(/\s|-/g, '-')
        return (
          <Stack
            key={row.label}
            data-testid={testIdPrefix ? `${testIdPrefix}-${slug}` : undefined}
            sx={{ minWidth: 90 }}
          >
            <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkFaint }}>
              {row.label.toUpperCase()}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: chrome.ink }}>
              {formatTokens(row.value)}
            </Typography>
          </Stack>
        )
      })}
    </Stack>
  )
}

/** One provider+model volume row — honest about an empty (unattributed) provider/model. */
function ModelVolumeRow({ model }: { model: EngineUsageModel }) {
  const isUnattributed = model.provider === '' && model.model === ''
  return (
    <Stack
      data-testid="usage-model-row"
      sx={{ gap: 0.4, p: 1, border: `1px solid ${chrome.line}`, borderRadius: '7px', bgcolor: chrome.card }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: chrome.ink }}>
          {isUnattributed ? (
            <>
              <FontAwesomeIcon icon={faCircleQuestion} color={chrome.inkFaint} aria-hidden="true" />{' '}
              Unattributed (thin/partial payload)
            </>
          ) : (
            `${model.provider || '(no provider recorded)'} — ${model.model || '(no model recorded)'}`
          )}
        </Typography>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: chrome.blue }}>
          {formatCount(model.totals.calls)} calls
        </Typography>
      </Stack>
      <TokenBreakdown totals={model.totals} />
      <Typography sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
        Latency — total {formatMs(model.totals.latency.totalMs)}, avg {formatMs(model.totals.latency.averageMs)}, max{' '}
        {formatMs(model.totals.latency.maxMs)}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {model.guardResults.map(g => (
          <GuardResultChip key={g.result} entry={g} />
        ))}
      </Stack>
    </Stack>
  )
}

/** One provider+model cost row — `priced: false` renders "Unpriced", never `$0`. */
function ModelCostRow({ row, currency }: { row: EngineUsageModelCost; currency: string }) {
  const isUnattributed = row.provider === '' && row.model === ''
  const name = isUnattributed
    ? 'Unattributed (thin/partial payload)'
    : `${row.provider || '(no provider recorded)'} — ${row.model || '(no model recorded)'}`

  return (
    <Stack
      data-testid="usage-cost-row"
      sx={{ gap: 0.4, p: 1, border: `1px solid ${chrome.line}`, borderRadius: '7px', bgcolor: chrome.card }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: chrome.ink }}>{name}</Typography>
      {row.priced ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.25 }}>
          <Typography sx={{ fontSize: 11, color: chrome.inkMuted }}>
            Input {formatCurrency(row.inputCost ?? 0, currency)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: chrome.inkMuted }}>
            Output {formatCurrency(row.outputCost ?? 0, currency)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: chrome.inkMuted }}>
            Cache-read {formatCurrency(row.cacheReadCost ?? 0, currency)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: chrome.inkMuted }}>
            Cache-creation {formatCurrency(row.cacheCreationCost ?? 0, currency)}
          </Typography>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: chrome.ink }}>
            Total {formatCurrency(row.totalCost ?? 0, currency)}
          </Typography>
        </Stack>
      ) : (
        <Stack direction="row" data-testid="usage-cost-unpriced" sx={{ alignItems: 'center', gap: 0.5 }}>
          <FontAwesomeIcon icon={faCircleQuestion} color={chrome.amber} aria-hidden="true" />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: chrome.amber }}>
            UNPRICED — no price-table entry for this model. Token counts above are real; no cost is
            asserted.
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}

export interface UsagePanelProps {
  /** Whether the flyout is open — the console owns this via `useToolstrip().isActive(...)`. */
  open: boolean
  /** Closes the flyout (toggles the toolstrip tool off). */
  onClose: () => void
}

/**
 * Renders the USAGE flyout while `open`. Reads through `useEngineUsage()`
 * (volume/cost) and `useEngineSettings()` (AC1's provider statement — see
 * this file's module header for why the two must never be conflated).
 */
export function UsagePanel({ open, onClose }: UsagePanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const openerRef = useRef<Element | null>(null)

  const { usage, loading, error, windowMinutes, setWindowMinutes, refresh } = useEngineUsage()
  const { settings: engineSettings } = useEngineSettings()

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement
      closeButtonRef.current?.focus()
      return
    }
    const opener = openerRef.current
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus()
    }
    openerRef.current = null
  }, [open])

  // Refetch on every OPEN TRANSITION (not "while open") — mirrors
  // `EngineSettingsPanel`'s staleness discipline. There is no polling
  // interval (module header) so this is the ONE automatic refresh point
  // beyond the manual button.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      refresh()
    }
    wasOpenRef.current = open
  }, [open, refresh])

  if (!open) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  // AC1 — read DIRECTLY off useEngineSettings(), never re-derived. See this
  // file's module header.
  const providerStatement = engineSettings
    ? engineSettings.providerCutToFake
      ? `LIVE PROVIDER: ${engineSettings.effectiveProvider} (cut from ${engineSettings.provider})`
      : `LIVE PROVIDER: ${engineSettings.effectiveProvider}`
    : null

  return (
    <Box
      data-testid="engine-usage-panel"
      role="region"
      aria-label={ENGINE_USAGE_PANEL_TITLE}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH_PX,
        bgcolor: chrome.panel,
        color: chrome.ink,
        borderLeft: `1px solid ${chrome.line}`,
        boxShadow: '-16px 0 40px rgba(0, 0, 0, 0.14)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.75,
          py: 1.5,
          borderBottom: `1px solid ${chrome.line}`,
          flex: 'none',
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: chrome.ink }}>
          {ENGINE_USAGE_PANEL_TITLE.toUpperCase()}
        </Typography>
        <Box
          component="button"
          type="button"
          ref={closeButtonRef}
          data-testid="engine-usage-close"
          aria-label="Close AI generation usage panel"
          onClick={onClose}
          sx={{
            border: 'none',
            bgcolor: 'transparent',
            color: chrome.inkMuted,
            cursor: 'pointer',
            p: 0.5,
            display: 'flex',
          }}
        >
          <FontAwesomeIcon icon={faXmark} size="sm" />
        </Box>
      </Stack>

      <Stack sx={{ flex: 1, minHeight: 0, overflowY: 'auto', gap: 1.75, p: 1.75 }}>
        {/* AC1 — the provider statement, sourced ONLY from useEngineSettings(). */}
        {providerStatement && (
          <Stack
            data-testid="usage-provider-statement"
            direction="row"
            role="status"
            aria-live="polite"
            sx={{ alignItems: 'flex-start', gap: 0.6 }}
          >
            <FontAwesomeIcon
              icon={engineSettings?.providerCutToFake ? faTriangleExclamation : faCircleInfo}
              color={engineSettings?.providerCutToFake ? chrome.amber : chrome.blue}
              aria-hidden="true"
            />
            <Typography
              sx={{
                fontSize: 11.5,
                fontWeight: 700,
                color: engineSettings?.providerCutToFake ? chrome.amber : chrome.ink,
                lineHeight: 1.4,
              }}
            >
              {providerStatement}
            </Typography>
          </Stack>
        )}

        {/* Window selector + manual refresh — NO auto-refresh polling (module header). */}
        <Stack sx={{ gap: 0.75 }}>
          <Stack direction="row" role="group" aria-label="Usage window" sx={{ gap: 0.6, flexWrap: 'wrap' }}>
            {ENGINE_USAGE_WINDOW_PRESETS_MINUTES.map(minutes => {
              const selected = windowMinutes === minutes
              return (
                <Box
                  key={minutes}
                  component="button"
                  type="button"
                  data-testid={`usage-window-${minutes}`}
                  aria-pressed={selected}
                  onClick={() => setWindowMinutes(minutes)}
                  sx={{
                    px: 1,
                    py: 0.5,
                    fontSize: 11,
                    fontWeight: 700,
                    color: selected ? chrome.ink : chrome.inkMuted,
                    bgcolor: selected ? chrome.card : 'transparent',
                    border: `1px solid ${selected ? chrome.blue : chrome.line}`,
                    borderRadius: '7px',
                    cursor: 'pointer',
                    '&:hover': { borderColor: chrome.blue },
                  }}
                >
                  {windowLabel(minutes)}
                </Box>
              )
            })}
            <Box
              component="button"
              type="button"
              data-testid="usage-refresh"
              onClick={() => refresh()}
              disabled={loading}
              sx={{
                px: 1,
                py: 0.5,
                fontSize: 11,
                fontWeight: 700,
                color: chrome.blue,
                bgcolor: 'transparent',
                border: `1px solid ${chrome.line}`,
                borderRadius: '7px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              <FontAwesomeIcon icon={faArrowRotateRight} aria-hidden="true" /> Refresh
            </Box>
          </Stack>

          {loading && (
            <Typography data-testid="engine-usage-loading" role="status" aria-live="polite" sx={{ fontSize: 11, color: chrome.inkFaint }}>
              Loading engine usage…
            </Typography>
          )}

          {error && (
            <Stack
              data-testid="engine-usage-error"
              direction="row"
              role="alert"
              sx={{ alignItems: 'flex-start', gap: 0.75, p: 1, border: `1px solid ${chrome.red}`, borderRadius: '7px' }}
            >
              <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.red} aria-hidden="true" />
              <Stack sx={{ gap: 0.5, flex: 1 }}>
                <Typography sx={{ fontSize: 11.5, color: chrome.ink }}>{error}</Typography>
                <Box
                  component="button"
                  type="button"
                  data-testid="engine-usage-retry"
                  onClick={() => refresh()}
                  sx={{
                    alignSelf: 'flex-start',
                    fontSize: 11,
                    fontWeight: 700,
                    color: chrome.blue,
                    bgcolor: 'transparent',
                    border: 'none',
                    p: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Retry
                </Box>
              </Stack>
            </Stack>
          )}
        </Stack>

        {usage && (
          <>
            {/* AC6 — wall-clock, labelled explicitly. */}
            <Typography data-testid="usage-window-label" sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
              Window: {formatWallClockTime(usage.window.fromWallClock)}–{formatWallClockTime(usage.window.toWallClock)}{' '}
              (wall-clock, {usage.window.bucketMinutes} min buckets)
            </Typography>

            {/* AC8 — unparseable rows are never silently folded into a lower total. */}
            {usage.unparseableEvents > 0 && (
              <Stack
                data-testid="usage-unparseable-banner"
                direction="row"
                role="alert"
                sx={{ alignItems: 'flex-start', gap: 0.6, p: 1, border: `1px solid ${chrome.amber}`, borderRadius: '7px' }}
              >
                <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
                <Typography sx={{ fontSize: 10.5, color: chrome.amber, lineHeight: 1.4 }}>
                  {formatCount(usage.unparseableEvents)}{' '}
                  event{usage.unparseableEvents === 1 ? '' : 's'} in this window could not be
                  read and are excluded from every number below — real usage may be higher than
                  shown.
                </Typography>
              </Stack>
            )}

            <Box sx={{ height: '1px', bgcolor: chrome.line }} />

            {/* VOLUME */}
            <Stack sx={{ gap: 1 }}>
              <Typography
                component="h3"
                sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
              >
                VOLUME
              </Typography>

              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                <Stack data-testid="usage-total-calls">
                  <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkFaint }}>
                    CALLS
                  </Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: chrome.ink }}>
                    {formatCount(usage.totals.calls)}
                  </Typography>
                </Stack>
                <Stack data-testid="usage-total-latency">
                  <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkFaint }}>
                    LATENCY (AVG / MAX)
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: chrome.ink }}>
                    {formatMs(usage.totals.latency.averageMs)} /{' '}
                    {formatMs(usage.totals.latency.maxMs)}
                  </Typography>
                </Stack>
              </Stack>

              <TokenBreakdown totals={usage.totals} testIdPrefix="usage-tokens" />

              <Stack sx={{ gap: 0.5 }}>
                <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkFaint }}>
                  GUARD-RESULT MIX
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  {usage.guardResults.map(g => (
                    <GuardResultChip key={g.result} entry={g} />
                  ))}
                </Stack>
              </Stack>

              <BucketSeries usage={usage} label="CALLS OVER TIME (this window's total)" />

              <Stack sx={{ gap: 0.6 }}>
                <Typography sx={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkFaint }}>
                  BY PROVIDER / MODEL
                </Typography>
                {usage.byModel.length === 0 ? (
                  <Typography sx={{ fontSize: 11, color: chrome.inkFaint }}>
                    No calls in this window.
                  </Typography>
                ) : (
                  usage.byModel.map((model, i) => (
                    <ModelVolumeRow key={`${model.provider}-${model.model}-${i}`} model={model} />
                  ))
                )}
              </Stack>
            </Stack>

            <Box sx={{ height: '1px', bgcolor: chrome.line }} />

            {/* COST — a SEPARATELY LABELLED section (AC3), never mixed into volume above. */}
            <Stack sx={{ gap: 1 }} data-testid="usage-cost-section">
              <Typography
                component="h3"
                sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
              >
                COST
              </Typography>

              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 0.75 }}>
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: chrome.ink }}>
                  {formatCurrency(usage.cost.pricedTotalCost, usage.cost.currency)}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
                  {usage.cost.anyUnpriced
                    ? '(priced subtotal — a FLOOR, excludes unpriced models below)'
                    : '(priced total)'}
                </Typography>
              </Stack>

              {usage.cost.anyUnpriced && (
                <Stack
                  data-testid="usage-cost-floor-note"
                  direction="row"
                  sx={{ alignItems: 'flex-start', gap: 0.6 }}
                >
                  <FontAwesomeIcon icon={faCircleInfo} color={chrome.amber} aria-hidden="true" />
                  <Typography sx={{ fontSize: 10.5, color: chrome.amber, lineHeight: 1.4 }}>
                    At least one model below has no price-table entry — the figure above is NOT
                    the total spend for this window.
                  </Typography>
                </Stack>
              )}

              {usage.cost.byModel.map((row, i) => (
                <ModelCostRow key={`${row.provider}-${row.model}-${i}`} row={row} currency={usage.cost.currency} />
              ))}
            </Stack>
          </>
        )}

        {!usage && !loading && !error && (
          <Typography sx={{ fontSize: 11, color: chrome.inkFaint }}>No usage data yet.</Typography>
        )}
      </Stack>
    </Box>
  )
}
