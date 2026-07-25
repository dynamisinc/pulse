/**
 * features/controller/engine/components/EngineSettingsPanel.tsx
 * ---------------------------------------------------------------------------
 * The engine SETTINGS flyout (feature: autonomy-safety, story 06; ADP-025/
 * NFR-005, D5 §2 "Engine control", NFR-001). STAFF world — dark COBRA operator
 * chrome matching `ReviewQueue`/`EngineControlBar`'s existing `chrome` tokens,
 * MUI 9 `sx`-only system props, FontAwesome icons only.
 *
 * The console's "ENGINE" toolstrip tool (`ControllerConsole.tsx`) renders this
 * flyout keyed on `useToolstrip().isActive(ENGINE_SETTINGS_TOOL_ID)` — the
 * EXISTING one-flyout-at-a-time toolstrip contract (`useRegisterSurfaceTool()`
 * / `useToolstrip()`, `@/features/staffShell/toolRegistry`), mirroring the
 * "Personas" tool's own registration in the same file. This is NOT a second
 * toolstrip, modal, or route.
 *
 * SHOWS (read-only where noted, `useEngineSettings()`, story 05's
 * `GET /api/engine/settings`):
 *  - the exercise AUTONOMY DEFAULT (Suggest / Delayed-auto) — a two-position
 *    control the controller flips, optimistic + revert-on-rejection;
 *  - the TRUE effective level (WR-003) — labelled from `effectiveLevel`,
 *    NEVER re-derived from `exerciseDefaultLevel` + `safetyClampActive`,
 *    since that inference is the exact historical bug this feature exists to
 *    fix (see `useEngineSettings`'s module header);
 *  - the TIER-POLICY MODE (Standard / Ambient / auto-by-purpose) — the same
 *    optimistic pattern;
 *  - the active PROVIDER + tier-to-model mapping, READ-ONLY — this panel
 *    never grows a deployment/model field anywhere (preserves story 05's
 *    governed-config boundary);
 *  - the `inMemoryStateNote` honestly, always — a restart resets the posture,
 *    and that fact is never hidden.
 *
 * 403 HANDLING (story 05 AC6/#297). Once `useEngineSettings().forbidden` is
 * `true` (a mutating call came back 403 — assigned staff but not a
 * controller), both controls render disabled with an explanatory note rather
 * than presenting a control that looks live but silently fails.
 *
 * A11Y (NFR-001): every state (autonomy level, tier mode, clamp/stopped note,
 * errors) is TEXT, never colour alone. Every control is a native `<button>`
 * (tab-reachable, Enter/Space-activate for free). The selected autonomy/tier
 * segment carries a check-glyph + "(current)" IN ADDITION TO its colour/border
 * treatment (Gate-1 S-002) — `aria-pressed` already covers assistive tech, but
 * a sighted user must not depend on colour alone either. `Escape` closes the
 * flyout; on open, focus moves to the close button; on close, focus returns
 * to whatever opened it (mirrors `PersonaDockHost`'s focus contract).
 *
 * STALENESS (Gate-1 CR-001): every time this flyout OPENS (the transition,
 * not "each render while open"), it calls `useEngineSettings().refetch()` —
 * an operator is about to look at this snapshot, so it must not be serving a
 * fetch-once-per-page-load cache that predates a kill-switch trip or a
 * server-side degrade. A failed initial GET also gets a visible "Retry"
 * affordance that calls the SAME `refetch()` (Gate-1 WR-004) — a transient
 * blip is not a permanent dead end.
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faCircleInfo,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import {
  useEngineSettings,
  type AutonomyDefaultLevel,
  type TierPolicyMode,
} from '../hooks/useEngineSettings'

/** Stable toolstrip-registry id for the console's "ENGINE" surface tool. */
export const ENGINE_SETTINGS_TOOL_ID = 'engine-settings'

/** Accessible/section title for the engine settings flyout. */
export const ENGINE_SETTINGS_PANEL_TITLE = 'Engine settings'

/** Flyout panel width — matches `PersonaDockHost`'s scale. */
const PANEL_WIDTH_PX = 380

/** D5 dark operator-chrome tokens (matches `ReviewQueue`'s/`EngineControlBar`'s `chrome`). */
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

const AUTONOMY_OPTIONS: ReadonlyArray<{ value: AutonomyDefaultLevel; label: string }> = [
  { value: 'suggest', label: 'Suggest' },
  { value: 'delayed-auto', label: 'Delayed-auto' },
]

const TIER_POLICY_OPTIONS: ReadonlyArray<{ value: TierPolicyMode; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'auto', label: 'Auto (by purpose)' },
]

/** Human copy for an effective/default autonomy level — text, never colour alone. */
function autonomyLevelCopy(level: AutonomyDefaultLevel): string {
  return level === 'delayed-auto' ? 'Delayed-auto' : 'Suggest'
}

/**
 * A segmented-control option's content — a check glyph + "(current)" suffix
 * on the SELECTED option, in addition to (never instead of) `aria-pressed`
 * and the colour/border treatment (Gate-1 S-002: the selected segment must
 * not be conveyed by colour/border alone for a sighted user either).
 */
function SegmentLabel({ label, selected }: { label: string; selected: boolean }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
      {selected && <FontAwesomeIcon icon={faCheck} aria-hidden="true" />}
      <Box component="span">{label}{selected ? ' (current)' : ''}</Box>
    </Stack>
  )
}

export interface EngineSettingsPanelProps {
  /** Whether the flyout is open — the console owns this via `useToolstrip().isActive(...)`. */
  open: boolean
  /** Closes the flyout (toggles the toolstrip tool off). */
  onClose: () => void
}

/**
 * Renders the ENGINE settings flyout while `open`. Reads/writes through
 * `useEngineSettings()` — see that hook's module header for the mock/live +
 * optimistic-revert contract this component relies on.
 */
export function EngineSettingsPanel({ open, onClose }: EngineSettingsPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const openerRef = useRef<Element | null>(null)
  const { settings, loading, error, forbidden, setAutonomyDefault, setTierPolicyMode, refetch } =
    useEngineSettings()

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

  // Gate-1 CR-001 — refetch on every OPEN TRANSITION (not "while open"), so
  // an operator opening this panel never sees a snapshot that predates a
  // kill-switch trip or a server-side degrade that happened while it was
  // closed.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      refetch()
    }
    wasOpenRef.current = open
  }, [open, refetch])

  if (!open) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  const autonomy = settings?.autonomy ?? null
  // `effectiveLevel` is `null` IFF `generationStopped` is `true` (story 05's
  // contract) — so a full stop is read straight off `generationStopped`,
  // never inferred from a null level in isolation.
  const effectiveLabel = autonomy
    ? autonomy.generationStopped
      ? 'Generation is fully stopped — no autonomy level is currently in effect.'
      : autonomy.effectiveLevel
        ? `Currently running at: ${autonomyLevelCopy(autonomy.effectiveLevel).toUpperCase()}`
        // Gate-1 S-004: this is UNREACHABLE under story 05's contract
        // (`effectiveLevel` is `null` IFF `generationStopped` is `true`) — if
        // ever seen, it names itself as a contract violation rather than
        // reading as an ordinary, silent state.
        : 'CONTRACT VIOLATION: no effective level reported while generation is not stopped.'
    : null
  // CLAMP DETECTION — derived ONLY from `safetyClampActive` (kill switch OR
  // degraded mode), NEVER by comparing `effectiveLevel` to
  // `exerciseDefaultLevel`. Those two can read EQUAL while still clamped
  // (e.g. base already `suggest` + a `drop-to-suggest` kill-switch clamp) —
  // inferring "no clamp" from level equality would silently hide an active
  // clamp, the exact posture-mislabel bug class this feature exists to fix,
  // just relocated from the LIVE/SUGGEST-ONLY label to this indicator.
  const clampNote =
    autonomy && !autonomy.generationStopped && autonomy.safetyClampActive
      ? autonomy.degradedReason
        ? `A safety clamp is active (${autonomy.degradedReason}) — only an explicit restore lifts it.`
        : 'A safety clamp is active on this exercise — only an explicit restore lifts it.'
      : null

  return (
    <Box
      data-testid="engine-settings-panel"
      role="region"
      aria-label={ENGINE_SETTINGS_PANEL_TITLE}
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
          {ENGINE_SETTINGS_PANEL_TITLE.toUpperCase()}
        </Typography>
        <Tooltip title="Close">
          <IconButton
            ref={closeButtonRef}
            data-testid="engine-settings-close"
            size="small"
            aria-label="Close engine settings panel"
            onClick={onClose}
            sx={{ color: chrome.inkMuted }}
          >
            <FontAwesomeIcon icon={faXmark} size="sm" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack sx={{ flex: 1, minHeight: 0, overflowY: 'auto', gap: 1.75, p: 1.75 }}>
        {loading && (
          <Typography data-testid="engine-settings-loading" sx={{ fontSize: 12, color: chrome.inkFaint }}>
            Loading engine settings…
          </Typography>
        )}

        {!loading && !settings && error && (
          <Stack
            data-testid="engine-settings-load-error"
            direction="row"
            role="alert"
            sx={{ alignItems: 'flex-start', gap: 0.75, p: 1, border: `1px solid ${chrome.red}`, borderRadius: '7px' }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.red} aria-hidden="true" />
            <Stack sx={{ gap: 0.5, flex: 1 }}>
              <Typography sx={{ fontSize: 11.5, color: chrome.ink }}>{error}</Typography>
              {/* Gate-1 WR-004: a failed initial GET is not a permanent dead
                  end — this calls the SAME refetch() the open-transition
                  effect above uses. */}
              <Box
                component="button"
                type="button"
                data-testid="engine-settings-retry"
                onClick={() => refetch()}
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

        {settings && autonomy && (
          <>
            {/* Autonomy default — the two-position control. */}
            <Stack sx={{ gap: 0.75 }}>
              <Typography
                component="h3"
                sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
              >
                AUTONOMY DEFAULT
              </Typography>
              <Stack
                direction="row"
                role="group"
                aria-label="Exercise autonomy default"
                sx={{ gap: 0.75 }}
              >
                {AUTONOMY_OPTIONS.map(option => {
                  const selected = autonomy.exerciseDefaultLevel === option.value
                  return (
                    <Box
                      key={option.value}
                      component="button"
                      type="button"
                      data-testid={`autonomy-default-${option.value}`}
                      aria-pressed={selected}
                      disabled={forbidden}
                      onClick={() => setAutonomyDefault(option.value)}
                      sx={{
                        flex: 1,
                        px: 1,
                        py: 0.6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: selected ? chrome.ink : chrome.inkMuted,
                        bgcolor: selected ? chrome.card : 'transparent',
                        border: `1px solid ${selected ? chrome.blue : chrome.line}`,
                        borderRadius: '7px',
                        cursor: forbidden ? 'not-allowed' : 'pointer',
                        opacity: forbidden ? 0.5 : 1,
                        '&:hover': forbidden ? undefined : { borderColor: chrome.blue },
                      }}
                    >
                      <SegmentLabel label={option.label} selected={selected} />
                    </Box>
                  )
                })}
              </Stack>

              {effectiveLabel && (
                <Typography
                  data-testid="autonomy-effective-label"
                  role="status"
                  aria-live="polite"
                  sx={{ fontSize: 11, color: chrome.inkMuted }}
                >
                  {effectiveLabel}
                </Typography>
              )}
              {clampNote && (
                <Stack
                  data-testid="autonomy-clamp-note"
                  direction="row"
                  sx={{ alignItems: 'flex-start', gap: 0.6 }}
                >
                  <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
                  <Typography sx={{ fontSize: 10.5, color: chrome.amber, lineHeight: 1.4 }}>
                    {clampNote}
                  </Typography>
                </Stack>
              )}
              {autonomy.swampedMode && (
                <Typography sx={{ fontSize: 10.5, color: chrome.inkFaint }}>
                  Swamped mode is on for this exercise (timeout auto-send is active).
                </Typography>
              )}
            </Stack>

            <Box sx={{ height: '1px', bgcolor: chrome.line }} />

            {/* Tier-policy mode. */}
            <Stack sx={{ gap: 0.75 }}>
              <Typography
                component="h3"
                sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
              >
                TIER POLICY
              </Typography>
              <Stack direction="row" role="group" aria-label="Tier-policy mode" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                {TIER_POLICY_OPTIONS.map(option => {
                  const selected = settings.tierPolicyMode === option.value
                  return (
                    <Box
                      key={option.value}
                      component="button"
                      type="button"
                      data-testid={`tier-policy-${option.value}`}
                      aria-pressed={selected}
                      disabled={forbidden}
                      onClick={() => setTierPolicyMode(option.value)}
                      sx={{
                        px: 1,
                        py: 0.6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: selected ? chrome.ink : chrome.inkMuted,
                        bgcolor: selected ? chrome.card : 'transparent',
                        border: `1px solid ${selected ? chrome.blue : chrome.line}`,
                        borderRadius: '7px',
                        cursor: forbidden ? 'not-allowed' : 'pointer',
                        opacity: forbidden ? 0.5 : 1,
                        '&:hover': forbidden ? undefined : { borderColor: chrome.blue },
                      }}
                    >
                      <SegmentLabel label={option.label} selected={selected} />
                    </Box>
                  )
                })}
              </Stack>
            </Stack>

            {forbidden && (
              <Stack
                data-testid="engine-settings-readonly-note"
                direction="row"
                role="status"
                sx={{ alignItems: 'flex-start', gap: 0.6, p: 1, border: `1px solid ${chrome.amber}`, borderRadius: '7px' }}
              >
                <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
                <Typography sx={{ fontSize: 10.5, color: chrome.amber, lineHeight: 1.4 }}>
                  Read-only — only controller-role staff can change engine settings for this
                  exercise.
                </Typography>
              </Stack>
            )}

            {error && !forbidden && (
              <Stack
                data-testid="engine-settings-action-error"
                direction="row"
                role="alert"
                sx={{ alignItems: 'flex-start', gap: 0.6, p: 1, border: `1px solid ${chrome.red}`, borderRadius: '7px' }}
              >
                <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.red} aria-hidden="true" />
                <Typography sx={{ fontSize: 10.5, color: chrome.ink, lineHeight: 1.4 }}>
                  {error}
                </Typography>
              </Stack>
            )}

            <Box sx={{ height: '1px', bgcolor: chrome.line }} />

            {/* Read-only provider + tier mapping — never editable here. */}
            <Stack sx={{ gap: 0.5 }}>
              <Typography
                component="h3"
                sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: chrome.inkMuted }}
              >
                PROVIDER &amp; TIERS (READ-ONLY)
              </Typography>
              <Typography data-testid="engine-settings-provider" sx={{ fontSize: 12, color: chrome.ink }}>
                Provider: <Box component="span" sx={{ fontWeight: 700 }}>{settings.provider}</Box>
              </Typography>
              {settings.tiers.length === 0 && (
                <Typography sx={{ fontSize: 11, color: chrome.inkFaint }}>
                  No governed tiers are configured for this environment.
                </Typography>
              )}
              {settings.tiers.map(tier => (
                <Typography
                  key={tier.tier}
                  data-testid={`engine-settings-tier-row-${tier.tier.toLowerCase()}`}
                  sx={{ fontSize: 11, color: chrome.inkMuted }}
                >
                  {tier.tier}: {tier.model || '(no model configured)'}
                  {tier.deployment ? ` · deployment "${tier.deployment}"` : ' · no deployment configured'}
                  {tier.zdrCapable ? ' · ZDR-capable' : ''}
                </Typography>
              ))}
            </Stack>

            {/* In-memory state — surfaced honestly, never hidden. */}
            <Stack
              data-testid="engine-settings-in-memory-note"
              direction="row"
              sx={{ alignItems: 'flex-start', gap: 0.6, p: 1, bgcolor: chrome.card, borderRadius: '7px' }}
            >
              <FontAwesomeIcon icon={faCircleInfo} color={chrome.blue} aria-hidden="true" />
              <Typography sx={{ fontSize: 10.5, color: chrome.inkMuted, lineHeight: 1.4 }}>
                {settings.inMemoryStateNote}
              </Typography>
            </Stack>
          </>
        )}
      </Stack>
    </Box>
  )
}
