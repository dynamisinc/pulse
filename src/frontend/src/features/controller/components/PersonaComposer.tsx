/**
 * features/controller/components/PersonaComposer.tsx
 * ---------------------------------------------------------------------------
 * The Controller Console's post-as-persona composer (feature: persona-
 * operation, story 01 - "Post as any persona into an enabled channel";
 * CTL-001, COR-018, COR-053, SOC-003, R-001/R-003/R-004 - and demo-polish C1,
 * story 17 "Post as persona v2"). STAFF world (COBRA) - `CobraTextField` +
 * `CobraPrimaryButton` / `CobraSecondaryButton`, FontAwesome icons only, MUI 9
 * system props sx-only. Dense, desktop-first, keyboard-first.
 *
 * WHAT IT IS: the view over `useComposeAsPersona`. The controller speaks AS the
 * active persona; the published post is indistinguishable to participants from
 * any other post, and only the telemetry + this staff console know a controller
 * sent it.
 *
 * v2 CAPABILITIES (story 17)
 *   - ATTACH BY UPLOAD: up to 4 images OR 1 video via `core/media`'s upload client
 *     (per-file progress, cancel / remove, MP4 (H.264) hint, mixed image + video
 *     refused) - see `media/AttachmentTray`.
 *   - ATTACH FROM THE LIBRARY: `media/MediaLibraryPicker`, a keyboard-operable grid of
 *     the exercise's staff media library (file name + scenario upload time per tile).
 *     A picked video keeps its poster.
 *   - REQUIRED ALT TEXT per attachment (NFR-001): Post stays disabled until every
 *     item has one, and a sentence beside the button says what is outstanding.
 *   - REPLY AS PERSONA: when the route supplies `replyTo` the composer shows
 *     'Replying to @handle - "excerpt"' with a clear (x) control and posts with
 *     `parentPostId`. The target is state held by the ROUTE (orchestrator-wired via
 *     `dockSlots`); this component never owns it - `onClearReply` asks the route to
 *     drop it (the (x) control, and automatically after a reply goes out).
 *   - STARTING ENGAGEMENT: an optional collapsed like / repost / reply baseline
 *     (integers 0..1,000,000, presets); an invalid value blocks Fire inline.
 *   - PREVIEW before Fire: a labelled, bordered, monospaced STAFF frame (not a
 *     `PostCard`) showing author, text, media and the "Replying to" line.
 *   - VISIBLE OUTCOME: a rejected publish shows an error banner with the server's
 *     message and a Retry, keeps the draft, and never shows the success state;
 *     success shows "Posted" with the new post's scenario time. (The old swallowed
 *     `.catch(() => {})` is gone.) In live mode exactly ONE XC-004 event is emitted
 *     per post - the server's.
 *   - A POST THAT MAY ALREADY BE LIVE (unreadable 2xx, 504, or no response at all) is
 *     titled "Post status unknown", not "failed", and withholds the blind Retry: Post
 *     and Ctrl/Cmd+Enter stay disabled until the controller picks "Post again anyway..."
 *     -> "I checked the feed - post again", or "Discard draft (it went out)". Focus
 *     goes to the message, never to a button, so one stray Enter cannot double-post.
 *
 * IDENTITY HEADER (R-001/R-004): renders the ACTIVE PERSONA - the cross-surface
 * `<Avatar>` + display name + the canonical `<VerifiedMark>` seal (identical to
 * every participant surface; a trust signal must never be re-styled per world).
 * This is who the world sees. The operator (`callSign`) is shown ONLY in the
 * staff-side fire control / origin line - never as the post's author.
 *
 * FIRE CONTROL (dual-time, staff-only): shows BOTH the scenario instant
 * (exercise time zone, the ONLY thing that stamps the post, COR-053) AND the
 * real wall-clock instant (UTC) - the Cadence controller-facing convention.
 * Wall-clock is display-only here and NEVER reaches the participant post.
 *
 * ORIGIN LINE (R-003, staff-only): after a post fires, its provenance surfaces
 * as `originConsoleLabel(post)` -> `SIMCELL - MANUAL`, alongside the operating
 * controller's `callSign` (COR-018). This is the SOC-003/XC-002 staff-only
 * signal - it is never emitted to a participant surface, which only ever
 * receives `toParticipantView` output.
 *
 * KEYBOARD (NFR-001): Ctrl/Cmd+Enter fires from ANY control in the form; plain Enter
 * in an input (alt text, a baseline field) does NOT submit; Esc bubbles to the dock
 * (it closes the persona dock) - except while the library picker is open, where the
 * first Esc closes just the picker and returns focus to its button; every control is
 * reachable by Tab. State is never colour-only.
 *
 * INPUTS, NOT IMPORTS (Wave-1 parallel-build contract): `activePersona`
 * (persona-operation/02), `actingHumanId` + `callSign` (console-shell/01), and the
 * reply target are PROPS. This file imports NONE of those features. Its output seam,
 * `onPublished?(post)`, mirrors the shipped `Composer`'s `onPosted` exactly -
 * the integration step wires it to the feed store; this component never touches
 * a feed itself.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { IconButton } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleQuestion,
  faImages,
  faReply,
  faTriangleExclamation,
  faUpload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow, formatScenarioTime } from '@/core/clock'
import { ACCEPT_ANY_MEDIA, VIDEO_FORMAT_HINT } from '@/core/media'
import { wallClockNowIso } from '@/core/time/wallClock'
import {
  Avatar,
  VerifiedMark,
  originConsoleLabel,
  type Post,
  type ReplyTarget,
} from '@/features/social'
import type { Persona } from '@/features/personas'
import { useComposeAsPersona } from '../hooks/useComposeAsPersona'
import { AttachmentTray } from '../media/AttachmentTray'
import { MediaLibraryPicker } from '../media/MediaLibraryPicker'
import { useLibraryAssetLookup } from '../media/useLibraryAssetLookup'
import { EngagementBaselineSection } from './EngagementBaselineSection'
import { PersonaComposerPreview } from './PersonaComposerPreview'
import styles from './PersonaComposer.module.css'

export interface PersonaComposerProps {
  /** The persona to post AS (persona-operation/02 input - never imported).
   * Typed on the narrower, two-world-common `Persona`: the composer renders
   * name/handle/avatar/verified and never the staff-only `personaType`, so it
   * declares the fields it actually reads. `useActivePersona()` hands it a
   * `StaffPersona`, which is assignable. */
  activePersona: Persona
  /** The operating controller behind the persona (COR-018; console-shell/01). */
  actingHumanId: string
  /** Human-readable console identity of the operating controller (e.g.
   * `SIMCELL-3`) - shown staff-side only, never as the post's author. */
  callSign: string
  /** Per-exercise character limit; defaults to the shipped 280. */
  charLimit?: number
  /** Fired with the created `Post` after a successful publish - mirrors the
   * shipped `Composer.onPosted`. The integration step wires it to the feed. */
  onPublished?: (post: Post) => void
  /** When supplied, the post is a REPLY to this target (`parentPostId`). The target
   * is state held by the route (orchestrator-wired through `dockSlots`), never by
   * this component. Clearing it returns the composer to a normal post. */
  replyTo?: ReplyTarget
  /** Asks the route to drop the reply target - from the (x) control, and after a
   * reply has been posted. Without it the (x) control is not offered. */
  onClearReply?: () => void
}

/** Strips a leading '@' so a handle renders with exactly one. */
function bareHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle
}

export function PersonaComposer({
  activePersona,
  actingHumanId,
  callSign,
  charLimit,
  onPublished,
  replyTo,
  onClearReply,
}: PersonaComposerProps) {
  const { timeZone } = useExerciseContext()

  const compose = useComposeAsPersona({
    activePersona,
    actingHumanId,
    ...(onPublished !== undefined ? { onPublished } : {}),
    ...(charLimit !== undefined ? { charLimit } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(onClearReply !== undefined ? { onClearReply } : {}),
  })
  const { tray } = compose
  const locked = compose.isPublishing

  const lookupLibraryAsset = useLibraryAssetLookup()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const retryButtonRef = useRef<HTMLButtonElement | null>(null)
  const unconfirmedMessageRef = useRef<HTMLSpanElement | null>(null)
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryPanelRef = useRef<HTMLDivElement | null>(null)
  const libraryPanelId = useId()
  const blockersId = useId()
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Step 2 of "Post again anyway...": armed once the controller has said they will check.
  const [repostArmed, setRepostArmed] = useState(false)

  // Opening the picker moves focus INTO it (the checked filter option), so a keyboard
  // user lands where the next Tab is the grid.
  useEffect(() => {
    if (!libraryOpen) return
    libraryPanelRef.current
      ?.querySelector<HTMLElement>('input[type="radio"]:checked')
      ?.focus()
  }, [libraryOpen])

  // Focus must never fall to <body> when a publish finishes: pressing Post leaves the
  // (now disabled, or about-to-be-removed) button focused. Success hands focus to the
  // text field for the next post; a failure hands it to Retry (or the text field).
  //
  // The exception is a post that MAY ALREADY BE LIVE: focus goes to the banner's MESSAGE
  // (tabIndex -1) and never to a button, so the stray second Enter of a double-press
  // lands on plain text instead of re-posting. The same happens when the controller
  // steps between "Post again anyway..." and "I checked the feed" - the new button is
  // one deliberate Tab away.
  const { status, lastPublished, failure, awaitingDecision } = compose
  useEffect(() => {
    if (status !== 'success' && status !== 'error') return
    if (awaitingDecision) {
      unconfirmedMessageRef.current?.focus()
      return
    }
    const active = document.activeElement
    const focusLost =
      active === null ||
      active === document.body ||
      (active instanceof HTMLButtonElement && active.disabled)
    if (!focusLost) return
    const retry = retryButtonRef.current
    const target = status === 'error' && retry !== null && !retry.disabled
      ? retry
      : textInputRef.current
    target?.focus()
  }, [status, lastPublished, failure, awaitingDecision])

  // A new outcome starts the two-step confirm over.
  useEffect(() => {
    setRepostArmed(false)
  }, [failure])

  const armRepost = (armed: boolean) => {
    setRepostArmed(armed)
    // The clicked button is replaced by the next step's: park focus on the message.
    unconfirmedMessageRef.current?.focus()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    compose.publish()
  }

  // Keyboard-first (NFR-001): Ctrl/Cmd+Enter fires from ANY control in the form. A
  // plain Enter inside an <input> (alt text, a baseline field, a filter radio) must
  // not trigger the browser's implicit submit - a stray Enter must never post.
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') return
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      compose.publish()
      return
    }
    if (event.target instanceof HTMLInputElement) event.preventDefault()
  }

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Reset so picking the same file again (after removing it) still fires `change`.
    event.target.value = ''
    if (files.length > 0) tray.addFiles(files)
  }

  // Esc inside the picker closes just the picker (a second Esc, outside it, reaches
  // the dock and closes that). Stopping propagation keeps the dock's draft-discarding
  // Esc handler from firing on the first press.
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setLibraryOpen(false)
    libraryButtonRef.current?.focus()
  }

  return (
    <form
      className={styles.composer}
      data-testid="persona-composer"
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      aria-label="Post as persona"
      noValidate
    >
      <PersonaIdentity persona={activePersona} />

      {replyTo !== undefined && (
        <div className={styles.replyBanner} role="status" data-testid="reply-banner">
          <FontAwesomeIcon icon={faReply} aria-hidden="true" />
          <span className={styles.replyText}>
            Replying to{' '}
            <span className={styles.replyHandle}>@{bareHandle(replyTo.authorHandle)}</span>
            {' '}&mdash; &quot;{replyTo.excerpt}&quot;
          </span>
          {onClearReply !== undefined && (
            <IconButton
              size="small"
              aria-label="Clear reply target"
              disabled={locked}
              onClick={onClearReply}
            >
              <FontAwesomeIcon icon={faXmark} size="sm" />
            </IconButton>
          )}
        </div>
      )}

      <CobraTextField
        label={`${replyTo !== undefined ? 'Reply' : 'Post'} as ${activePersona.displayName}`}
        value={compose.text}
        onChange={e => compose.setText(e.target.value)}
        multiline
        minRows={3}
        fullWidth
        inputRef={textInputRef}
        slotProps={{ htmlInput: { readOnly: locked } }}
      />

      <section className={styles.attach} aria-label="Attachments">
        <div className={styles.attachActions}>
          <CobraSecondaryButton
            ref={uploadButtonRef}
            type="button"
            size="small"
            disabled={locked}
            startIcon={<FontAwesomeIcon icon={faUpload} />}
            sx={{ paddingLeft: '12px', paddingRight: '12px' }}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload
          </CobraSecondaryButton>
          <CobraSecondaryButton
            ref={libraryButtonRef}
            type="button"
            size="small"
            disabled={locked}
            aria-expanded={libraryOpen}
            aria-controls={libraryPanelId}
            startIcon={<FontAwesomeIcon icon={faImages} />}
            sx={{ paddingLeft: '12px', paddingRight: '12px' }}
            onClick={() => setLibraryOpen(open => !open)}
          >
            From library
          </CobraSecondaryButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ANY_MEDIA}
            className={styles.srOnly}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="persona-composer-file-input"
            onChange={handleFilesPicked}
          />
        </div>
        <p className={styles.hint}>
          Up to 4 images or 1 video. Video: {VIDEO_FORMAT_HINT}. Each needs alt text.
        </p>

        {libraryOpen && (
          <div
            ref={libraryPanelRef}
            id={libraryPanelId}
            className={styles.libraryPanel}
            data-testid="library-panel"
            // While a post is in flight the tray must not change under it.
            inert={locked}
            onKeyDown={handlePanelKeyDown}
          >
            <MediaLibraryPicker
              kind={tray.libraryLimits.kind}
              max={tray.libraryLimits.max}
              selectedIds={tray.libraryIds}
              onChange={ids => {
                if (!locked) tray.setLibrarySelection(ids, lookupLibraryAsset)
              }}
            />
          </div>
        )}

        <AttachmentTray
          tray={tray}
          locked={locked}
          onEmpty={() => uploadButtonRef.current?.focus()}
        />
      </section>

      <EngagementBaselineSection
        fields={compose.baselineFields}
        errors={compose.baselineErrors}
        baseline={compose.baseline}
        onChange={compose.setBaselineField}
        locked={locked}
      />

      <PersonaComposerPreview
        persona={activePersona}
        text={compose.text}
        items={tray.items}
        {...(replyTo !== undefined ? { replyTo } : {})}
        {...(compose.baseline !== undefined ? { baseline: compose.baseline } : {})}
      />

      {compose.status === 'error' && compose.failure !== undefined && (
        compose.awaitingDecision ? (
          <div className={styles.errorBanner} role="alert" data-testid="publish-unconfirmed">
            <FontAwesomeIcon icon={faCircleQuestion} aria-hidden="true" />
            <div className={styles.errorText}>
              <span className={styles.errorTitle}>
                Post status unknown{compose.failure.status !== undefined
                  ? ` (HTTP ${compose.failure.status})`
                  : ''}
              </span>
              <span
                ref={unconfirmedMessageRef}
                tabIndex={-1}
                className={styles.errorMessage}
                data-testid="publish-error-message"
              >
                {compose.failure.message}
              </span>
              <span>Your draft is kept. Post is paused until you choose.</span>
              <div className={styles.bannerActions}>
                {repostArmed ? (
                  <>
                    <CobraSecondaryButton
                      type="button"
                      size="small"
                      sx={{ paddingLeft: '12px', paddingRight: '12px' }}
                      onClick={() => compose.repostAnyway()}
                    >
                      I checked the feed — post again
                    </CobraSecondaryButton>
                    <CobraLinkButton
                      type="button"
                      size="small"
                      sx={{ paddingLeft: '12px', paddingRight: '12px' }}
                      onClick={() => armRepost(false)}
                    >
                      Back
                    </CobraLinkButton>
                  </>
                ) : (
                  <>
                    <CobraSecondaryButton
                      type="button"
                      size="small"
                      sx={{ paddingLeft: '12px', paddingRight: '12px' }}
                      onClick={() => armRepost(true)}
                    >
                      Post again anyway…
                    </CobraSecondaryButton>
                    <CobraSecondaryButton
                      type="button"
                      size="small"
                      sx={{ paddingLeft: '12px', paddingRight: '12px' }}
                      onClick={() => {
                        compose.discardUnconfirmed()
                        // The choice button is about to disappear: hand focus on.
                        textInputRef.current?.focus()
                      }}
                    >
                      Discard draft (it went out)
                    </CobraSecondaryButton>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.errorBanner} role="alert" data-testid="publish-error">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            <div className={styles.errorText}>
              <span className={styles.errorTitle}>
                Post failed{compose.failure.status !== undefined
                  ? ` (HTTP ${compose.failure.status})`
                  : ''}
              </span>
              <span data-testid="publish-error-message">{compose.failure.message}</span>
              <span>Your draft is kept.</span>
            </div>
            <CobraSecondaryButton
              ref={retryButtonRef}
              type="button"
              size="small"
              disabled={!compose.canPublish}
              sx={{ paddingLeft: '12px', paddingRight: '12px' }}
              onClick={() => compose.publish()}
            >
              Retry
            </CobraSecondaryButton>
          </div>
        )
      )}

      {compose.status === 'success' && compose.lastPublished !== null && (
        <p className={styles.success} role="status" data-testid="publish-success">
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
          <span className={styles.successLabel}>Posted</span>
          <span className={styles.successTime} data-testid="publish-success-time">
            {formatScenarioTime(compose.lastPublished.scenarioTime, timeZone, {
              format: 'absolute',
            })}
          </span>
        </p>
      )}

      <div className={styles.fireControl}>
        <FireClock timeZone={timeZone} callSign={callSign} />
        <div className={styles.fireActions}>
          {compose.isPublishing && (
            <span className={styles.publishing} role="status" data-testid="publishing">
              Posting...
            </span>
          )}
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
          <CobraPrimaryButton
            type="submit"
            disabled={!compose.canPublish}
            aria-label="Post"
            aria-describedby={compose.blockers.length > 0 ? blockersId : undefined}
          >
            Post
          </CobraPrimaryButton>
        </div>
      </div>

      {compose.blockers.length > 0 && (
        <ul id={blockersId} className={styles.blockers} data-testid="publish-blockers">
          {compose.blockers.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}

      {compose.lastPublished !== null && (
        <p className={styles.originLine} data-testid="origin-line" role="status">
          <span className={styles.originLabel} data-testid="origin-label">
            {originConsoleLabel(compose.lastPublished)}
          </span>
          <span>&middot; {callSign}</span>
        </p>
      )}
    </form>
  )
}

interface PersonaIdentityProps {
  persona: Persona
}

/**
 * The console composer's identity header (R-001/R-004) - who the WORLD sees the
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
 * SCENARIO time (exercise zone - the only instant that stamps the post,
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
