/**
 * features/controller/components/PersonaComposer.tsx
 * ---------------------------------------------------------------------------
 * The Controller Console's post-as-persona composer (feature: persona-
 * operation, story 01 — "Post as any persona into an enabled channel";
 * CTL-001, COR-018, COR-053, SOC-003, R-001/R-003/R-004). STAFF world
 * (COBRA) — `CobraTextField` + `CobraPrimaryButton`, FontAwesome icons only,
 * MUI 9 system props sx-only. Dense, desktop-first, keyboard-first.
 *
 * WHAT IT IS: the view over `useComposeAsPersona`. The controller speaks AS the
 * active persona; the published post is indistinguishable to participants from
 * any other post (it runs the shipped `createPost` pipeline), and only the
 * telemetry + this staff console know a controller sent it.
 *
 * IDENTITY HEADER (R-001/R-004): renders the ACTIVE PERSONA — the cross-surface
 * `<Avatar>` + display name + the canonical `<VerifiedMark>` seal (identical to
 * every participant surface; a trust signal must never be re-styled per world).
 * This is who the world sees. The operator (`callSign`) is shown ONLY in the
 * staff-side fire control / origin line — never as the post's author.
 *
 * FIRE CONTROL (dual-time, staff-only): shows BOTH the scenario instant
 * (exercise time zone, the ONLY thing that stamps the post, COR-053) AND the
 * real wall-clock instant (UTC) — the Cadence controller-facing convention.
 * Wall-clock is display-only here and NEVER reaches the participant post.
 *
 * ORIGIN LINE (R-003, staff-only): after a post fires, its provenance surfaces
 * as `originConsoleLabel(post)` → `SIMCELL · MANUAL`, alongside the operating
 * controller's `callSign` (COR-018). This is the SOC-003/XC-002 staff-only
 * signal — it is never emitted to a participant surface, which only ever
 * receives `toParticipantView` output.
 *
 * INPUTS, NOT IMPORTS (Wave-1 parallel-build contract): `activePersona`
 * (persona-operation/02), `actingHumanId` + `callSign` (console-shell/01) are
 * PROPS. This file imports NONE of those features. Its output seam,
 * `onPublished?(post)`, mirrors the shipped `Composer`'s `onPosted` exactly —
 * the integration step wires it to the feed store; this component never touches
 * a feed itself.
 */

import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow, formatScenarioTime } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { Avatar, VerifiedMark, originConsoleLabel, type Post } from '@/features/social'
import type { Persona } from '@/features/personas'
import { useComposeAsPersona } from '../hooks/useComposeAsPersona'
import styles from './PersonaComposer.module.css'

export interface PersonaComposerProps {
  /** The persona to post AS (persona-operation/02 input — never imported). */
  activePersona: Persona
  /** The operating controller behind the persona (COR-018; console-shell/01). */
  actingHumanId: string
  /** Human-readable console identity of the operating controller (e.g.
   * `SIMCELL-3`) — shown staff-side only, never as the post's author. */
  callSign: string
  /** Per-exercise character limit; defaults to the shipped 280. */
  charLimit?: number
  /** Fired with the created `Post` after a successful publish — mirrors the
   * shipped `Composer.onPosted`. The integration step wires it to the feed. */
  onPublished?: (post: Post) => void
}

export function PersonaComposer({
  activePersona,
  actingHumanId,
  callSign,
  charLimit,
  onPublished,
}: PersonaComposerProps) {
  const { timeZone } = useExerciseContext()

  // Keep the last-fired post so its staff-only provenance (R-003) can surface
  // on the console via `originConsoleLabel` — and so `onPublished` still runs.
  const [lastPublished, setLastPublished] = useState<Post | null>(null)
  const handlePublished = useCallback(
    (post: Post) => {
      setLastPublished(post)
      onPublished?.(post)
    },
    [onPublished],
  )

  const compose = useComposeAsPersona({
    activePersona,
    actingHumanId,
    onPublished: handlePublished,
    ...(charLimit !== undefined ? { charLimit } : {}),
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    compose.publish()
  }

  // Keyboard-first (NFR-001): Ctrl/Cmd+Enter fires without leaving the field.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      compose.publish()
    }
  }

  return (
    <form
      className={styles.composer}
      data-testid="persona-composer"
      onSubmit={handleSubmit}
      aria-label="Post as persona"
    >
      <PersonaIdentity persona={activePersona} />

      <CobraTextField
        label={`Post as ${activePersona.displayName}`}
        value={compose.text}
        onChange={e => compose.setText(e.target.value)}
        onKeyDown={handleKeyDown}
        multiline
        minRows={3}
        fullWidth
        slotProps={{ htmlInput: { 'aria-label': 'Post text' } }}
      />

      <div className={styles.fireControl}>
        <FireClock timeZone={timeZone} callSign={callSign} />
        <div className={styles.fireActions}>
          <span
            className={
              compose.isOverLimit ? `${styles.counter} ${styles.counterOver}` : styles.counter
            }
            data-testid="char-counter"
            data-state={compose.isOverLimit ? 'over' : 'normal'}
            role="status"
            aria-live="polite"
            aria-label={
              compose.isOverLimit
                ? `${Math.abs(compose.remaining)} characters over the limit`
                : `${compose.remaining} characters remaining`
            }
          >
            {compose.remaining}
          </span>
          <CobraPrimaryButton type="submit" disabled={!compose.canPublish} aria-label="Post">
            Post
          </CobraPrimaryButton>
        </div>
      </div>

      {lastPublished !== null && (
        <p className={styles.originLine} data-testid="origin-line" role="status">
          <span className={styles.originLabel} data-testid="origin-label">
            {originConsoleLabel(lastPublished)}
          </span>
          <span>· {callSign}</span>
        </p>
      )}
    </form>
  )
}

interface PersonaIdentityProps {
  persona: Persona
}

/**
 * The console composer's identity header (R-001/R-004) — who the WORLD sees the
 * post come from. Uses the cross-surface `<Avatar>`/`<VerifiedMark>` primitives
 * verbatim so the persona reads identically here and on every participant
 * surface (a trust signal is never re-themed per world).
 */
function PersonaIdentity({ persona }: PersonaIdentityProps) {
  return (
    <div className={styles.identity} data-testid="persona-identity">
      <Avatar persona={persona} size={40} />
      <span className={styles.identityText}>
        <span className={styles.displayName}>
          {persona.displayName}
          {persona.verified && <VerifiedMark size={15} />}
        </span>
        <span className={styles.handle}>@{persona.handle}</span>
      </span>
    </div>
  )
}

interface FireClockProps {
  timeZone: string
  callSign: string
}

/** Ticks every second so the dual-time readout stays live at the fire control. */
const FIRE_CLOCK_TICK_MS = 1000

/**
 * The staff-only dual-time readout at the fire control (Cadence convention):
 * SCENARIO time (exercise zone — the only instant that stamps the post,
 * COR-053) plus the real WALL-clock instant (UTC). Wall-clock is display-only
 * and never reaches a participant surface.
 */
function FireClock({ timeZone, callSign }: FireClockProps) {
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), FIRE_CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const scenario = formatScenarioTime(scenarioNow(), timeZone, { format: 'absolute' })
  const wall = formatWallClockUtc(wallClockNowIso())

  return (
    <div className={styles.dualTime} data-testid="dual-time">
      <span className={styles.timeRow}>
        <span className={styles.timeLabel}>SCENARIO</span>
        <span className={styles.timeValue} data-testid="dual-time-scenario">{scenario}</span>
      </span>
      <span className={styles.timeRow}>
        <span className={styles.timeLabel}>WALL·UTC</span>
        <span className={styles.timeValue} data-testid="dual-time-wall">{wall}</span>
      </span>
      <span className={styles.timeRow}>
        <span className={styles.timeLabel}>OPERATOR</span>
        <span className={styles.timeValue}>{callSign}</span>
      </span>
    </div>
  )
}

/** Formats a wall-clock ISO instant as a UTC (Zulu) clock reading, e.g.
 * `14:32:07Z`. UTC is unambiguous for a staff wall-clock readout. */
function formatWallClockUtc(iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return ''
  const rendered = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(instant)
  return `${rendered}Z`
}
