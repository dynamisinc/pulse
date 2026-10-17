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
 *     signal (NFR-001). The "Live" position's label is additionally suffixed
 *     with the TRUE effective autonomy level — "ENGINE · LIVE (SUGGEST)" vs.
 *     "ENGINE · LIVE (DELAYED-AUTO)" vs. "ENGINE · LIVE (GENERATION STOPPED)"
 *     — read from `useEngineSettings()` (feature: autonomy-safety, story 06),
 *     NEVER assumed. This fixes the audit finding that "Live" used to
 *     unconditionally imply Delayed-auto (`useEngineControl.ts`'s
 *     `deriveEffective`) while the real backend exercise default has been
 *     permanently Suggest — LIVE and SUGGEST-ONLY were behaviourally
 *     identical. The suffix is read from the FULL `autonomy` snapshot
 *     (`generationStopped` checked FIRST, then `effectiveLevel`), never
 *     re-derived from `exerciseDefaultLevel` + `safetyClampActive` — that
 *     inference is the exact bug class this fix exists to close, so a clamp
 *     active on a Delayed-auto base still shows "(SUGGEST)" here, honestly.
 *     Passing the flattened, nullable `effectiveLevel` alone would conflate
 *     "settings not loaded yet" with "generation fully stopped" (both read
 *     `null`) — so `labelFor` takes the whole snapshot (or `null` while
 *     genuinely not yet loaded) and checks `generationStopped` explicitly
 *     rather than inferring it from a null level.
 *
 *     STALENESS. The kill switch mutates the SAME server-side autonomy state
 *     `useEngineSettings()` describes, entirely outside that hook — so this
 *     component calls `engineSettings.refetch()` whenever
 *     `engineControl.modeSettledCount`/`degraded` changes (skipping the
 *     initial mount, to avoid a redundant duplicate of the hook's own first
 *     GET), closing the window where tripping the kill switch would leave
 *     this label reporting a clamp that's no longer (or newly) accurate.
 *     Deliberately NOT `engineControl.mode`: `setMode` flips `mode`
 *     optimistically and SYNCHRONOUSLY, in the SAME call that fires the live
 *     kill-switch POST, so a watcher keyed on `mode` would refetch settings
 *     WHILE that POST is still in-flight — and the settings GET (one filter)
 *     is favoured to win that race against the POST (mutation + validation +
 *     a telemetry write), making the stale read the LIKELIER ordering, not a
 *     corner case. That race was CR-101 — a Critical. `modeSettledCount`
 *     (`useEngineControl`'s module header) is a settle SIGNAL, bumped only
 *     once the live request has actually concluded (both `.then` and
 *     `.catch`), so watching it instead of `mode` is what makes the refetch
 *     observe the POST rather than race it. See the in-component comment
 *     above the effect below for the full mechanics — do not "simplify" this
 *     dependency array back to `mode`; that reintroduces CR-101.
 *     TOUCH (mobile-tablet story 15, D5-025, TABLET-AMENDMENT §5; Tom, 10/16). On a COARSE
 *     pointer (`useCoarsePointer()`, never a width) the one transition that is NOT a
 *     one-tap-safe direction, STOP -> Live (re-arming the engine), opens a small confirm dialog
 *     first: "Re-arm the engine?" with Cancel / Re-arm to Live. STOPPING stays ONE TAP (Live ->
 *     Suggest-only -> STOP are direct), because stopping is the safe direction and must never be
 *     slowed. The dialog is a plain MUI `Dialog` (modal: focus trapped, Esc and Cancel close it,
 *     focus returns to the kill switch, `aria-modal` so the console's Ctrl+K stands aside),
 *     opens with focus on the dialog itself (never a button), is centred (so away from the
 *     switch), has 44px buttons 16px apart with the confirm at the far edge, ignores taps for
 *     400ms after opening (`useArmedConfirm`) and fires once. With a fine pointer the cycle is
 *     the unchanged one-click cycle. The switch itself is a 44px box on touch.
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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBolt,
  faCircleCheck,
  faGaugeHigh,
  faPowerOff,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import {
  ARMING_SX,
  CONFIRM_GAP_PX,
  destructiveTouchSx,
  touchTargetSx,
  useArmedConfirm,
  useCoarsePointer,
} from '../../components/confirm'
import { SwampedModeToggle } from '../components/SwampedModeToggle'
import { useDemandMeter } from '../hooks/useDemandMeter'
import { useEngineControl, type EngineMode } from '../hooks/useEngineControl'
import { useEngineSettings, type EngineSettingsAutonomy } from '../hooks/useEngineSettings'
import { useReviewQueue } from '../hooks/useReviewQueue'
// D5 dark operator-chrome tokens (matches `ReviewQueue`'s `chrome`). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'
import { useCanControl } from '../../access'

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

/**
 * The displayed label for `mode` — the "Live" position ALONE gets a suffix
 * naming the TRUE effective autonomy posture, read verbatim off
 * `useEngineSettings()`'s FULL autonomy snapshot; Suggest-only/Stopped
 * already say exactly what they mean and are left unsuffixed.
 *
 * `autonomy === null` (settings not loaded yet, live mode only) renders with
 * NO suffix — a guess would be worse than silence. `generationStopped` is
 * checked EXPLICITLY, before `effectiveLevel` — a flattened, nullable
 * `effectiveLevel` alone cannot distinguish "not loaded" from "fully
 * stopped" (both would read `null`); collapsing them would reproduce the
 * exact pre-fix ambiguous label at the one moment the server is routing at
 * NO level.
 */
function labelFor(mode: EngineMode, autonomy: EngineSettingsAutonomy | null): string {
  const base = MODE_COPY[mode].label
  if (mode !== 'live' || !autonomy) return base
  if (autonomy.generationStopped) return `${base} (GENERATION STOPPED)`
  if (autonomy.effectiveLevel === 'delayed-auto') return `${base} (DELAYED-AUTO)`
  if (autonomy.effectiveLevel === 'suggest') return `${base} (SUGGEST)`
  // DELIBERATE ASYMMETRY, documented rather than left accidental: this is a
  // contract violation (story 05 documents `effectiveLevel` as `null` IFF
  // `generationStopped` is `true`; reaching here means a non-stopped
  // snapshot reported no effective level at all). `<EngineSettingsPanel>`
  // names this loudly ("CONTRACT VIOLATION: ...") in its own full-text
  // autonomy-effective-label, since that panel IS the diagnostic surface for
  // this state. This compact kill-switch pill stays silent (unsuffixed)
  // rather than guessing OR cramming that same sentence into a small badge —
  // an operator who needs the detail opens the panel, which is already
  // reachable one click away and always shows the honest long-form text.
  return base
}

/**
 * The engine mode as the SERVER reports it (story 11 H-1), for the read-only readout that stands
 * in for the kill switch on a non-controller's console. Built from the settings snapshot, never
 * from the local kill-switch store (which seeds 'live' and only knows THIS console's presses):
 * stopped, else a clamp with no degraded reason (the kill switch's Suggest-only), else live.
 * `null` before the first read: a guess would be worse than silence.
 */
function serverModeOf(autonomy: EngineSettingsAutonomy | null): EngineMode | null {
  if (!autonomy) return null
  if (autonomy.generationStopped) return 'stop'
  if (autonomy.safetyClampActive && autonomy.degradedReason === null) return 'suggest-only'
  return 'live'
}

/**
 * The STOP -> Live re-arm confirm (touch only). Mounted only while open, so "open" is "mounted".
 * Cancel/Esc close it without changing the mode; Re-arm to Live fires `onConfirm` once, after the
 * 400ms arming delay.
 */
function RearmConfirmDialog({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const { armed, guard } = useArmedConfirm({ open: true, enabled: true })
  return (
    <Dialog
      open
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="engine-rearm-dialog"
    >
      <DialogTitle id={titleId} sx={{ fontSize: 15, fontWeight: 800 }}>
        Re-arm the engine?
      </DialogTitle>
      <DialogContent>
        <Typography id={bodyId} component="div" sx={{ fontSize: 13, lineHeight: 1.5 }}>
          The engine is STOPPED. Switching it to LIVE lets it generate again, at the autonomy level
          set in Engine settings.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: `${CONFIRM_GAP_PX}px` }}>
        <CobraSecondaryButton
          onClick={onCancel}
          sx={touchTargetSx}
          data-testid="engine-rearm-cancel"
        >
          Cancel
        </CobraSecondaryButton>
        <CobraPrimaryButton
          startIcon={<FontAwesomeIcon icon={faPowerOff} aria-hidden="true" />}
          onClick={guard(onConfirm)}
          aria-disabled={!armed}
          onContextMenu={event => event.preventDefault()}
          sx={{ ...touchTargetSx, ...destructiveTouchSx, ...ARMING_SX }}
          data-testid="engine-rearm-confirm"
        >
          Re-arm to Live
        </CobraPrimaryButton>
      </DialogActions>
    </Dialog>
  )
}

export function EngineControlBar() {
  // Story 11 (DF-14): the bar's write toggles are absent for a non-controller; its readouts stay.
  const canControl = useCanControl()
  const engineControl = useEngineControl()
  const coarse = useCoarsePointer()
  const [confirmingRearm, setConfirmingRearm] = useState(false)
  const engineSettings = useEngineSettings()
  // Destructured so the effect below can depend on the STABLE `refetch`
  // reference directly (see that effect's comment) rather than the whole
  // `engineSettings` object, which is a fresh literal every render.
  const { refetch: refetchEngineSettings } = engineSettings
  const demand = useDemandMeter()
  const { pendingCount, timersUnder60sCount } = useReviewQueue()

  const autonomy = engineSettings.settings?.autonomy ?? null
  const modeCopy = MODE_COPY[engineControl.mode]
  const modeLabel = labelFor(engineControl.mode, autonomy)
  const nextModeLabel = labelFor(nextMode(engineControl.mode), autonomy)
  const demandFraction = useMemo(
    () => Math.min(1, demand.demand / Math.max(1, demand.budget)),
    [demand.demand, demand.budget],
  )
  const allClear = pendingCount === 0 && timersUnder60sCount === 0
  const serverMode = serverModeOf(autonomy)
  const readoutTone = serverMode === null ? chrome.inkMuted : MODE_COPY[serverMode].tone
  const readoutLabel =
    serverMode === null
      ? 'ENGINE · READING…'
      : `${labelFor(serverMode, autonomy)}${autonomy?.degradedReason ? ' (DEGRADED)' : ''}`

  // The kill switch mutates the SAME server-side autonomy state
  // `engineSettings` describes, entirely outside that hook, so this label
  // must refetch to stay accurate. Watching raw `engineControl.mode` would be
  // WRONG — `setMode` flips `mode` optimistically and SYNCHRONOUSLY, in the
  // same call that fires the live kill-switch POST, so a watcher on `mode`
  // refetches settings WHILE that POST is still in-flight; the settings GET
  // is favoured to win that race, applying a PRE-trip snapshot as
  // authoritative with nothing ever refetching again (`mode` won't change
  // again on its own).
  //
  // Fixed by watching `modeSettledCount` (bumped in BOTH the `.then` and
  // `.catch` of the live POST, `useEngineControl`'s module header) instead of
  // `mode` — a settle SIGNAL, not the optimistic value itself, so this only
  // fires once the kill-switch request has actually concluded. `degraded` is
  // still watched directly: `degrade()`/`restore()` are synchronous, mock-only
  // clamps with no live round trip, so there is no settle race for them.
  // Skips the very first run (the hook's own mount effect already fetched
  // once) — only a subsequent settle/degraded CHANGE re-triggers it.
  // `refetchEngineSettings` (not the whole `engineSettings` object) is the
  // correct third dependency here: `useEngineSettings()` returns a FRESH
  // object literal on every render (so the object itself is never a safe
  // effect dependency — it would self-trigger on the very refetch this effect
  // causes), but `refetch` is `useCallback`-memoized against only
  // `exerciseId`, so its reference stays stable across re-renders and store
  // notifications alike, changing only on a genuine exercise switch. No
  // `eslint-disable` needed — `degraded`/`modeSettledCount` are the only
  // MEANINGFUL triggers, and `refetchEngineSettings` is listed because it is
  // what the effect calls, not because it is expected to change.
  // The re-arm confirm only makes sense while the engine is STOPPED. If the mode leaves 'stop'
  // underneath it (a server-synced or other controller's re-arm), drop the dialog so a stale
  // "Re-arm to Live" cannot fire a second POST.
  const isStopped = engineControl.mode === 'stop'
  useEffect(() => {
    if (!isStopped) setConfirmingRearm(false)
  }, [isStopped])

  const skippedInitialRefetch = useRef(false)
  useEffect(() => {
    if (!skippedInitialRefetch.current) {
      skippedInitialRefetch.current = true
      return
    }
    refetchEngineSettings()
  }, [engineControl.degraded, engineControl.modeSettledCount, refetchEngineSettings])

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
      {/* a. Kill switch — always visible to a controller, text + icon + dot (never color-only). */}
      {canControl && <Box
        component="button"
        type="button"
        data-testid="engine-kill-switch"
        data-mode={engineControl.mode}
        aria-label={`${modeLabel} — activate to switch to ${nextModeLabel}`}
        aria-haspopup={coarse && engineControl.mode === 'stop' ? 'dialog' : undefined}
        onClick={() => {
          // Touch: STOP -> Live asks first. Every other step (including STOPPING) is one tap.
          if (coarse && engineControl.mode === 'stop') {
            setConfirmingRearm(true)
            return
          }
          engineControl.setMode(nextMode(engineControl.mode))
        }}
        sx={{
          ...(coarse ? touchTargetSx : {}),
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
        {modeLabel}
        <Box
          aria-hidden="true"
          sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: modeCopy.tone, flex: 'none' }}
        />
      </Box>}
      {/* a'. Story 11 H-1: a non-controller sees the server's engine mode, not a switch. */}
      {!canControl && (
        <Box
          component="span"
          role="status"
          data-testid="engine-mode-readout"
          data-mode={serverMode ?? 'unknown'}
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
            border: `1px solid ${readoutTone}`,
            borderRadius: '20px',
          }}
        >
          <FontAwesomeIcon icon={faPowerOff} color={readoutTone} aria-hidden="true" />
          {readoutLabel}
          <Box
            aria-hidden="true"
            sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: readoutTone, flex: 'none' }}
          />
        </Box>
      )}

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
          {canControl && <Box
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
          </Box>}
        </Stack>
      ) : import.meta.env.DEV && canControl ? (
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

      {confirmingRearm && canControl && isStopped && (
        <RearmConfirmDialog
          onCancel={() => setConfirmingRearm(false)}
          onConfirm={() => {
            setConfirmingRearm(false)
            engineControl.setMode('live')
          }}
        />
      )}
    </Stack>
  )
}
