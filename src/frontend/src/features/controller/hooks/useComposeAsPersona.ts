/**
 * features/controller/hooks/useComposeAsPersona.ts
 * ---------------------------------------------------------------------------
 * The compose-as-persona state machine behind `<PersonaComposer>` (feature:
 * persona-operation, story 01; CTL-001, COR-018, COR-053, XC-004 - and demo-polish
 * C1, story 17 "Post as persona v2"). Staff world (Controller Console) - pure hook,
 * no UI, no COBRA.
 *
 * WHAT IT OWNS
 *   - Draft state: `text` + a character counter (`length` / `remaining` /
 *     `isOverLimit`), so an over-length post is blocked before it is fired.
 *   - The ATTACH TRAY (`tray`, `useAttachmentTray`): up to 4 images OR 1 video from an
 *     upload or the staff library, each with a REQUIRED alt text (NFR-001).
 *   - The staff-only ENGAGEMENT BASELINE form state (`baselineFields` /
 *     `baselineErrors` / `baseline`): optional integers 0..1,000,000 for Like /
 *     Repost / Reply; an invalid value blocks Fire.
 *   - The REPLY target (`options.replyTo`): when present the post is sent with
 *     `parentPostId`. The target is state held by the ROUTE (orchestrator-wired), not
 *     here; the hook only reads it, and asks the route to drop it (`onClearReply`)
 *     once the reply is out.
 *   - `publish()`, the single sanctioned path, and its visible outcome: `status`
 *     ('idle' | 'publishing' | 'success' | 'error'), `failure` and `lastPublished`.
 *
 * PUBLISH, behind the ONE `USE_MOCK_DATA` flip point (`@/core/config/mockData`):
 *   - MOCK: `composeAsPersona` (-> the shipped `createPost`): synchronous, sanitized,
 *     and the one place the mock emits the XC-004 `post` / `reply` event.
 *   - LIVE: AWAITS `publishAsPersonaLive` (-> `livePostActions.publishPost`, `POST
 *     /api/posts`, no client `exerciseId`). It does NOT also call `createPost`: the
 *     server is the SOLE XC-004 emitter for a live post, so exactly ONE event is
 *     emitted per post. (The former "accepted double-count" - one frontend event plus
 *     the server's - is retired now that attribution is server-derived.) The 201
 *     `StaffPostDto` is the source of the `Post` the console keeps (R-003 origin line,
 *     the own-tab store) and of the "Posted <scenario time>" line.
 *
 * NO FALSE SUCCESS. The old fire-and-forget `.catch(() => {})` is gone. A rejection
 * (live) or a thrown 400-equivalent (mock) leaves `status === 'error'` with a
 * classified `failure` (the server's own message when it sent one), KEEPS the whole
 * draft - text, tray, baseline, reply target - and never reaches the success state;
 * calling `publish()` again is the Retry. Success clears the draft (text, persisted
 * mirror, tray, baseline), drops the reply target, fires `onPublished(post)` and
 * stamps `status === 'success'`. While a publish is in flight the form is locked
 * (`isPublishing`), so nothing typed after pressing Post can be wiped by the success,
 * and a second ⌘+Enter is ignored.
 *
 * A POST THAT MAY ALREADY BE LIVE (an unreadable 2xx, a 504, or NO response at all)
 * is not a plain failure: re-sending could double-post breaking news. It is classified
 * 'unconfirmed' and the hook sets `awaitingDecision`: `publish()` (hence Post and
 * Ctrl/Cmd+Enter) is a no-op until the controller chooses `repostAnyway()` ("I checked
 * the feed - post again") or `discardUnconfirmed()` ("it went out"). The pending
 * question outlives the composer: a module-level map keyed like the draft brings it
 * back after a remount, and a response that lands while the composer is off-screen
 * (dock closed, another persona on screen) restores the draft, raises an app toast
 * ("status unknown - check the feed" for this kind) and leaves the question waiting.
 *
 * A RESPONSE ONLY SETTLES ITS OWN REQUEST. In-flight bookkeeping is per target (a
 * set, not one slot), and a success clears the route's reply target only if (a) the
 * composer that sent it is STILL the one on screen and (b) the target is STILL the one
 * the post answered. (a) matters because the route's target outlives no dock: once the
 * composer unmounts the route has already dropped the target, and anything it holds now
 * was set AFTER the post was sent - e.g. a fresh "Reply as" on another post - which an
 * old instance's late 201 must never wipe (it would turn that reply into a top-level post).
 *
 * A REPLY NEVER TURNS INTO A TOP-LEVEL POST ON REMOUNT. What persists across an unmount -
 * the "Post status unknown" question and the draft an off-screen failure restored - is
 * persisted TOGETHER WITH the reply it was sent for (`contextByKey`, which may say "no
 * reply"). The route drops its reply target when the dock closes or the persona changes,
 * so on a fresh mount the hook compares the two:
 *   - route target absent -> it asks the route to put the draft's reply back
 *     (`onRestoreReply`; the "Replying to @x" banner shows again);
 *   - they still differ (no restore callback, a different "Reply as", the controller cleared
 *     it) -> `replyMismatch` is set, Post / "post again" are blocked, and the composer says
 *     what the draft was. `matchDraftReply()` puts the original setting back;
 *     `keepCurrentReply()` (not offered for a pending "did it go out?" question, whose
 *     re-send must be the SAME request) accepts what is on screen.
 *
 * INPUTS, NOT IMPORTS (Wave-1 parallel-build contract):
 *   - `activePersona` - the persona to post AS - is a PROP from persona-operation/02's
 *     `useActivePersona()`. This hook does not import that feature; it only reads
 *     `activePersona.id`.
 *   - `actingHumanId` - the operating controller (COR-018) - is a PROP from
 *     console-shell/01's `useControllerIdentity()`. Not imported here.
 *
 * TIME (COR-053): `scenarioTime` is `scenarioNow().toISOString()` - the
 * participant-visible instant is always scenario time, never wall-clock. (The
 * console's dual-time FIRE readout is a staff-side display concern owned by the
 * component, not this hook.)
 *
 * ISOLATION (COR-001): `exerciseId`/`timeZone` from `useExerciseContext()` STAMP the
 * post/telemetry only - never a fetch-scoping param. `publishPost` drops
 * `exerciseId` from the wire body entirely; the server stamps scope from the session.
 *
 * DRAFT SURVIVES UNMOUNT (autonomy-safety story 06, Gate-1 WR-103). The console can
 * unmount `<PersonaComposer>` out from under an in-progress draft for reasons that are
 * NOT an explicit close intent - e.g. `ControllerConsole` closes the persona-dock host
 * when a DIFFERENT toolstrip tool activates (the ENGINE settings tool, story 06),
 * which is not the operator choosing to discard their text. A `useState('')` alone
 * would silently drop unsaved text in that case. So the draft TEXT is additionally
 * mirrored into a tiny module-level store keyed by `(exerciseId, personaId)`
 * (`draftByKey`, below) on every `setText`; a fresh mount for the SAME target seeds its
 * initial state from that store instead of `''`, and a successful publish clears the
 * stored entry so a sent post never reappears as a leftover draft. (Attachments are
 * NOT mirrored: a picked `File` cannot be persisted, and a library asset is one click
 * away again.)
 *
 * This does NOT change the EXPLICIT discard paths (Esc/X on the persona dock) - those
 * still lose the draft, which is the correct, expected behavior for an explicit close.
 * That discard is deliberately NOT wired inside this hook (this hook has no notion of
 * "the dock closed" - it only ever sees its own mount/unmount, which must NOT discard,
 * per the paragraph above). It is instead the CONSOLE's job: `ControllerConsole`'s
 * `closeDock` (the Esc/X handler `<PersonaDockHost>` calls) explicitly calls
 * `composeAsPersonaDraftStore.discardDraft(exerciseId, personaId)` before clearing its
 * own dock state, so an explicitly-dismissed draft never silently pre-fills a later
 * compose for the same persona.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import { registerSessionReset } from '@/core/auth/sessionReset'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { Persona } from '@/features/personas'
import type { EngagementBaseline, Post, ReplyTarget } from '@/features/social'
import {
  classifyPublishFailure,
  composeAsPersona,
  describeOffscreenFailure,
  parseBaselineField,
  publishAsPersonaLive,
  type ComposeAsPersonaInput,
  type PublishFailure,
} from '../services/composeService'
import { useAttachmentTray, type UseAttachmentTrayResult } from '../media/useAttachmentTray'

/** Default per-exercise character limit (mirrors the participant composer, SOC-001). */
export const DEFAULT_CHAR_LIMIT = 280

// ---------------------------------------------------------------------------
// The unsaved-draft-survives-unmount store (Gate-1 WR-103)
// ---------------------------------------------------------------------------

/** `"exerciseId::personaId" -> in-progress draft text`. Absent = no draft (the common case). */
const draftByKey = new Map<string, string>()

/**
 * `"exerciseId::personaId" -> the 'unconfirmed' failure of a post that MAY ALREADY be
 * live` (an unreadable 2xx, a 504, no response at all). The draft it belongs to is kept
 * (that is the point), so a remount for the same target - the dock closed and reopened,
 * or a response that landed while the composer was off-screen - must come back still
 * asking "did it go out?" rather than offering a plain Post that could double-post.
 * Cleared when the controller decides (post again anyway / discard), when a later send
 * succeeds or is refused, and by the explicit Esc/X discard.
 */
const unconfirmedByKey = new Map<string, PublishFailure>()

/**
 * What a persisted draft was written FOR. `replyTo === undefined` means "a top-level post",
 * which is just as worth remembering: a draft written as a plain post must not become a
 * reply because the controller pressed "Reply as..." before reopening the dock. Only set
 * alongside an unconfirmed question or an off-screen-restored draft (see the module header);
 * absent = unknown (no guard).
 */
interface DraftContext {
  readonly replyTo: ReplyTarget | undefined
}
const contextByKey = new Map<string, DraftContext>()

/** A handle with exactly one leading '@' stripped (the composer's banner adds its own). */
function bareHandleOf(target: ReplyTarget): string {
  return target.authorHandle.startsWith('@') ? target.authorHandle.slice(1) : target.authorHandle
}

function draftKey(exerciseId: string, personaId: string): string {
  return `${exerciseId}::${personaId}`
}

function getPersistedDraft(exerciseId: string, personaId: string): string {
  return draftByKey.get(draftKey(exerciseId, personaId)) ?? ''
}

/** Empty text is never worth remembering - treat it as "no draft" (keeps the map small). */
function setPersistedDraft(exerciseId: string, personaId: string, text: string): void {
  const key = draftKey(exerciseId, personaId)
  if (text === '') {
    draftByKey.delete(key)
  } else {
    draftByKey.set(key, text)
  }
}

/**
 * Explicitly discards a persisted draft - the EXPLICIT close (Esc/X) path,
 * called by `ControllerConsole`'s `closeDock` (never by this hook's own
 * unmount; see the module header). A no-op if there was no draft.
 */
function discardDraft(exerciseId: string, personaId: string): void {
  const key = draftKey(exerciseId, personaId)
  draftByKey.delete(key)
  unconfirmedByKey.delete(key)
  contextByKey.delete(key)
}

/**
 * Forgets EVERY persisted draft, "did it go out?" question and reply context. Called when the
 * session ends (`core/auth/endSession`): the next staff user on the same tab must not inherit
 * the previous one's unsent text or unresolved question. Also the test reset.
 */
function reset(): void {
  draftByKey.clear()
  unconfirmedByKey.clear()
  contextByKey.clear()
}

/**
 * The module-singleton persisted-draft store. Exposed for the discard path, the sign-out reset
 * and the test reset (`resetForTests` is the same operation under its older name).
 */
export const composeAsPersonaDraftStore = { discardDraft, reset, resetForTests: reset }

// Sign-out forgets every draft, question and reply context (Gate-2 A L-5): they are module
// singletons that live as long as the TAB, so without this the next staff user on the same tab
// would inherit the previous one's unsent text and "Post status unknown" question. Registered
// with `core/auth` (which cannot import this feature) rather than called from `endSession`.
registerSessionReset(reset)

// ---------------------------------------------------------------------------
// Engagement baseline form state
// ---------------------------------------------------------------------------

/** The three baseline counters, in the product's order everywhere (R-002 is reply, repost, like;
 * the console form lists them Like / Repost / Reply as the story names them). */
export const BASELINE_FIELDS = ['like', 'repost', 'reply'] as const

/** One of the three baseline counters. */
export type BaselineField = (typeof BASELINE_FIELDS)[number]

const EMPTY_BASELINE_FIELDS: Readonly<Record<BaselineField, string>> = {
  like: '',
  repost: '',
  reply: '',
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** Options for {@link useComposeAsPersona}. */
export interface UseComposeAsPersonaOptions {
  /** The persona to post AS (persona-operation/02 input - never imported). */
  readonly activePersona: Persona
  /** The operating controller behind the persona (COR-018; console-shell/01 input). */
  readonly actingHumanId: string
  /** Per-exercise character limit; defaults to {@link DEFAULT_CHAR_LIMIT}. */
  readonly charLimit?: number
  /** Called with the created `Post` after a successful publish. Mirrors the
   * shipped `Composer`'s `onPosted` seam - the composer never touches a feed. */
  readonly onPublished?: (post: Post) => void
  /** Makes the post a reply to this target (`parentPostId`). Route-held state. */
  readonly replyTo?: ReplyTarget
  /** Asks the route to drop the reply target (after a successful reply). */
  readonly onClearReply?: () => void
  /**
   * Asks the route to PUT BACK the reply target a persisted draft was written for (the route
   * dropped it when the dock closed). Without it a remounted draft whose reply is missing is
   * blocked (`replyMismatch`) instead of restored.
   */
  readonly onRestoreReply?: (target: ReplyTarget) => void
  /**
   * The current reply target was taken down after it was set: Post is blocked (a reply to a
   * removed post can never succeed) and `blockers` says why. Route / composer supplied.
   */
  readonly replyTargetRemoved?: boolean
}

/**
 * A persisted draft whose reply setting no longer matches the route's. `original` is what the
 * draft was written for (`undefined` = a top-level post); `current` is what the route holds now.
 */
export interface ReplyMismatch {
  readonly original: ReplyTarget | undefined
  readonly current: ReplyTarget | undefined
}

/** Where the last publish attempt stands. */
export type PublishStatus = 'idle' | 'publishing' | 'success' | 'error'

/** The compose surface `<PersonaComposer>` binds to. */
export interface UseComposeAsPersonaResult {
  readonly text: string
  readonly setText: (value: string) => void
  readonly charLimit: number
  /** Code-point length of the current text (emoji-aware). */
  readonly length: number
  /** `charLimit - length` - negative when over the limit. */
  readonly remaining: number
  /** Text is longer than the limit - publish is blocked. */
  readonly isOverLimit: boolean
  /** All conditions met to publish (content, within limit, tray ready, baseline valid, idle). */
  readonly canPublish: boolean
  /** Why Fire is disabled, in words (empty when it is enabled, or when nothing was started). */
  readonly blockers: readonly string[]
  /** Sanitizes + publishes and reports the outcome via `status`. A no-op unless `canPublish`. */
  readonly publish: () => void
  /**
   * True when the last attempt MAY already be live (unreadable 2xx, 504, no response):
   * `publish` is a no-op until the controller picks `repostAnyway` or `discardUnconfirmed`.
   */
  readonly awaitingDecision: boolean
  /** "I checked the feed - post again": re-sends the kept draft past the gate. */
  readonly repostAnyway: () => void
  /** "Discard draft (it went out)": drops the draft, the gate and the answered reply target. */
  readonly discardUnconfirmed: () => void
  /**
   * Set while a persisted draft's reply setting differs from the route's (see the module
   * header). Post and "post again" are blocked until it is resolved.
   */
  readonly replyMismatch: ReplyMismatch | undefined
  /** Puts the draft's ORIGINAL reply setting back (restores its target, or clears the current). */
  readonly matchDraftReply: () => void
  /** Accepts what is on screen as the draft's reply setting. A no-op while awaiting a decision. */
  readonly keepCurrentReply: () => void

  /** The attach tray (uploads + library picks, alt text, limits). */
  readonly tray: UseAttachmentTrayResult

  /** The raw baseline inputs (strings, so a half-typed value is representable). */
  readonly baselineFields: Readonly<Record<BaselineField, string>>
  /** Inline message per invalid baseline field. */
  readonly baselineErrors: Readonly<Partial<Record<BaselineField, string>>>
  /** The parsed baseline to send; `undefined` when none is set (or any value is invalid). */
  readonly baseline: EngagementBaseline | undefined
  readonly setBaselineField: (field: BaselineField, value: string) => void

  readonly status: PublishStatus
  /** True while a live publish is in flight (the form is locked). */
  readonly isPublishing: boolean
  /** Set only in the 'error' status: what failed, and what that proves. */
  readonly failure: PublishFailure | undefined
  /** Set only in the 'success' status: the post that went out. */
  readonly lastPublished: Post | null
}

/**
 * The compose-as-persona state + publish machine. See the module header for the
 * full contract; `<PersonaComposer>` is its only intended consumer.
 */
export function useComposeAsPersona(
  options: UseComposeAsPersonaOptions,
): UseComposeAsPersonaResult {
  const {
    activePersona,
    actingHumanId,
    charLimit = DEFAULT_CHAR_LIMIT,
    onPublished,
    replyTo,
    onClearReply,
    onRestoreReply,
    replyTargetRemoved = false,
  } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const personaId = activePersona.id
  const targetKey = draftKey(exerciseId, personaId)

  const [text, setTextState] = useState(() => getPersistedDraft(exerciseId, personaId))
  const tray = useAttachmentTray()
  const [baselineFields, setBaselineFields] = useState(EMPTY_BASELINE_FIELDS)
  const [status, setStatus] = useState<PublishStatus>(() =>
    unconfirmedByKey.has(targetKey) ? 'error' : 'idle',
  )
  const [failure, setFailure] = useState<PublishFailure | undefined>(() =>
    unconfirmedByKey.get(targetKey),
  )
  const [lastPublished, setLastPublished] = useState<Post | null>(null)
  // What the persisted draft (if any) was written for - see `contextByKey`.
  const [draftContext, setDraftContext] = useState<DraftContext | undefined>(() =>
    contextByKey.get(targetKey),
  )

  // The target a response belongs to must still be the one on screen when it lands.
  const targetRef = useRef(targetKey)
  // Targets with a request in flight. A SET (not one slot): a completion removes only
  // ITS OWN target, so A's response can never unlock B's in-flight request.
  const inFlight = useRef(new Set<string>())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // The reply target the route holds RIGHT NOW. A response only drops the target it was
  // sent for: if the controller picked a different "Reply as" while a post was in
  // flight, the new target must survive the old post's success.
  const latestReplyToRef = useRef(replyTo)
  useEffect(() => {
    latestReplyToRef.current = replyTo
  }, [replyTo])
  const onRestoreReplyRef = useRef(onRestoreReply)
  useEffect(() => {
    onRestoreReplyRef.current = onRestoreReply
  }, [onRestoreReply])

  // If the compose TARGET changes (a different exercise or persona - NOT merely a
  // remount for the SAME one, which the lazy initializer above already handles),
  // adopt THAT target's own persisted draft instead of carrying over whatever was
  // mid-typed for the previous target, and drop every transient outcome (an error
  // banner or "Posted" line for persona A must not follow the controller to B). One
  // extra render on a genuine target change is an acceptable, standard trade for
  // staying lint-clean (`react-hooks/refs` forbids reading/writing a ref during
  // render, even for this "adjust state" pattern).
  const { clear: clearTray } = tray
  useEffect(() => {
    targetRef.current = draftKey(exerciseId, personaId)
    // Deliberately re-seeds on every mount too (redundant with, but never in
    // conflict with, the lazy initializer above - same value either way).
    setTextState(getPersistedDraft(exerciseId, personaId))
    // A post that may already be live comes back asking, not as a fresh draft.
    const pending = unconfirmedByKey.get(draftKey(exerciseId, personaId))
    setStatus(pending !== undefined ? 'error' : 'idle')
    setFailure(pending)
    setLastPublished(null)
    setBaselineFields(EMPTY_BASELINE_FIELDS)
    clearTray()
    // The draft comes back with the reply it was written for. The route dropped its target
    // when the dock closed / the persona changed, so ask it to put that target back (a
    // PASSIVE effect on purpose: the route's own bookkeeping of the active persona is only
    // current by now). If it cannot, `replyMismatch` blocks the send instead.
    const context = contextByKey.get(draftKey(exerciseId, personaId))
    setDraftContext(context)
    if (context?.replyTo !== undefined && latestReplyToRef.current === undefined) {
      onRestoreReplyRef.current?.(context.replyTo)
    }
  }, [exerciseId, personaId, clearTray])

  // Mirrors every keystroke into the persisted-draft store (Gate-1 WR-103) -
  // see the module header. Cheap (a single Map write).
  const setText = useCallback(
    (value: string) => {
      setTextState(value)
      setPersistedDraft(exerciseId, personaId, value)
    },
    [exerciseId, personaId],
  )

  const setBaselineField = useCallback((field: BaselineField, value: string) => {
    setBaselineFields(current => ({ ...current, [field]: value }))
  }, [])

  // Code-point length so a multi-byte emoji counts as one character (X-style).
  const length = useMemo(() => [...text].length, [text])
  const remaining = charLimit - length
  const isOverLimit = remaining < 0
  const hasText = text.trim().length > 0

  // The baseline: each field parsed on its own; ONE invalid field blocks Fire and the
  // parsed object is withheld, so a half-valid baseline is never sent.
  const parsedBaseline = useMemo(() => {
    const errors: Partial<Record<BaselineField, string>> = {}
    const values: { like?: number; repost?: number; reply?: number } = {}
    for (const field of BASELINE_FIELDS) {
      const result = parseBaselineField(baselineFields[field])
      if (!result.ok) errors[field] = result.error
      else if (result.value !== undefined) values[field] = result.value
    }
    const valid = Object.keys(errors).length === 0
    const baseline: EngagementBaseline | undefined =
      valid && Object.keys(values).length > 0 ? values : undefined
    return { errors, valid, baseline }
  }, [baselineFields])

  const isPublishing = status === 'publishing'
  // The last attempt MAY have gone out (unreadable 2xx, 504, no response): Post - and
  // Ctrl/Cmd+Enter - stay disabled until the controller chooses "post again anyway" or
  // "discard, it went out". A single stray Enter must never double-post breaking news.
  const awaitingDecision = status === 'error' && failure?.kind === 'unconfirmed'
  const hasContent = hasText || tray.items.length > 0
  // A persisted draft must go out with the reply setting it was written for (see header).
  const replyMismatch = useMemo<ReplyMismatch | undefined>(
    () =>
      draftContext !== undefined && draftContext.replyTo?.postId !== replyTo?.postId
        ? { original: draftContext.replyTo, current: replyTo }
        : undefined,
    [draftContext, replyTo],
  )
  const canPublish =
    hasContent &&
    !isOverLimit &&
    tray.blocker === undefined &&
    parsedBaseline.valid &&
    !isPublishing &&
    !awaitingDecision &&
    replyMismatch === undefined &&
    !replyTargetRemoved

  const blockers = useMemo<string[]>(() => {
    const reasons: string[] = []
    if (awaitingDecision) {
      reasons.push('Post is paused: choose "Post again anyway" or "Discard draft" above.')
    }
    if (replyMismatch !== undefined) {
      reasons.push(
        replyMismatch.original !== undefined
          ? `This draft was a reply to @${bareHandleOf(replyMismatch.original)}: restore that `
            + 'reply (or choose what to do with the draft) above.'
          : 'This draft was a new post, not a reply: clear the reply target (or choose what to '
            + 'do with the draft) above.',
      )
    }
    if (replyTargetRemoved) {
      reasons.push('The post you are replying to was taken down. Clear the reply to post.')
    }
    if (isOverLimit) reasons.push(`Remove ${-remaining} characters to post.`)
    if (tray.blocker !== undefined) reasons.push(tray.blocker)
    if (!parsedBaseline.valid) {
      reasons.push('Fix the Starting engagement values: whole numbers from 0 to 1,000,000.')
    }
    return reasons
  }, [
    awaitingDecision,
    replyMismatch,
    replyTargetRemoved,
    isOverLimit,
    remaining,
    tray.blocker,
    parsedBaseline.valid,
  ])

  const { baseline } = parsedBaseline
  const trayMedia = tray.media

  /**
   * The one send path. `force` bypasses ONLY the "did the last one go out?" gate and is
   * reserved for the controller's explicit "I checked the feed - post again".
   */
  const send = useCallback((force: boolean) => {
    // Re-derive the guard locally rather than trust a stale `canPublish`
    // closure - a forced submit must still no-op when it shouldn't fire.
    if (inFlight.current.has(targetKey)) return
    if (awaitingDecision && !force) return
    if (force && !awaitingDecision) return
    if (replyMismatch !== undefined || replyTargetRemoved) return
    if (trayMedia === undefined) return
    if (text.trim().length === 0 && trayMedia.length === 0) return
    if ([...text].length > charLimit) return
    if (!parsedBaseline.valid) return

    const input: ComposeAsPersonaInput = {
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      authorPersonaId: personaId,
      actingHumanId,
      text,
      ...(trayMedia.length > 0 ? { media: trayMedia } : {}),
      ...(replyTo !== undefined ? { parentPostId: replyTo.postId } : {}),
      ...(baseline !== undefined ? { engagementBaseline: baseline } : {}),
    }

    const sentReplyTo = replyTo
    const handle = activePersona.handle
    const stillOnScreen = () => mountedRef.current && targetRef.current === targetKey

    const succeed = (post: Post) => {
      inFlight.current.delete(targetKey)
      unconfirmedByKey.delete(targetKey)
      // The draft is gone whether or not the composer is still mounted - but only if
      // it is still what was sent (a remount may already hold a newer draft).
      if (getPersistedDraft(exerciseId, personaId) === text) discardDraft(exerciseId, personaId)
      if (stillOnScreen()) {
        setDraftContext(contextByKey.get(targetKey))
        setTextState('')
        clearTray()
        setBaselineFields(EMPTY_BASELINE_FIELDS)
        setFailure(undefined)
        setLastPublished(post)
        setStatus('success')
      }
      // Drop the route's reply target only if (a) THIS composer is still the one on screen
      // and (b) the target is STILL the one this post answered. An unmounted instance's late
      // success must not wipe a target the route holds NOW: the route already dropped the
      // one this post answered when the dock closed or the persona changed, so whatever it
      // holds was set later (Gate-2 A M-1).
      if (
        stillOnScreen()
        && sentReplyTo !== undefined
        && latestReplyToRef.current?.postId === sentReplyTo.postId
      ) {
        onClearReply?.()
      }
      onPublished?.(post)
    }

    const fail = (error: unknown) => {
      inFlight.current.delete(targetKey)
      const classified = classifyPublishFailure(error)
      // What a remounted composer must know about this request: the reply it carried (or
      // that it carried none).
      const sentContext: DraftContext = { replyTo: sentReplyTo }
      if (classified.kind === 'unconfirmed') {
        unconfirmedByKey.set(targetKey, classified)
        contextByKey.set(targetKey, sentContext)
      } else {
        unconfirmedByKey.delete(targetKey)
      }

      if (!stillOnScreen()) {
        // The composer is gone (dock closed / another persona on screen): nobody is
        // looking at an error banner, so make the failure impossible to miss and put
        // the text back - WITH the reply it was written for - where a reopened composer
        // will find it.
        // (A draft that is still exactly what was sent - the dock was closed without discarding
        // it, e.g. the ENGINE flyout took it over - is the same draft: it gets the context too.
        // A DIFFERENT, newer draft is the controller's own and is left alone.)
        const persisted = getPersistedDraft(exerciseId, personaId)
        if (persisted === '' || persisted === text) {
          setPersistedDraft(exerciseId, personaId, text)
          contextByKey.set(targetKey, sentContext)
        }
        const notify = classified.kind === 'unconfirmed' ? toast.warning : toast.error
        notify(describeOffscreenFailure(handle, classified), { autoClose: 10_000 })
        return
      }
      if (classified.kind === 'unconfirmed') setDraftContext(sentContext)
      setFailure(classified)
      setLastPublished(null)
      setStatus('error')
    }

    inFlight.current.add(targetKey)
    setFailure(undefined)
    setLastPublished(null)

    if (USE_MOCK_DATA) {
      // MOCK: synchronous, the local `createPost` pipeline (the mock's own telemetry).
      let post: Post
      try {
        post = composeAsPersona(input)
      } catch (error) {
        fail(error)
        return
      }
      succeed(post)
      return
    }

    // LIVE: await the real POST. The server is the sole XC-004 emitter - no
    // `createPost` here (no double count). A rejection is shown, never swallowed.
    setStatus('publishing')
    publishAsPersonaLive(input).then(succeed, fail)
  }, [
    targetKey,
    awaitingDecision,
    exerciseId,
    timeZone,
    personaId,
    activePersona.handle,
    actingHumanId,
    text,
    charLimit,
    trayMedia,
    clearTray,
    parsedBaseline.valid,
    baseline,
    replyTo,
    replyMismatch,
    replyTargetRemoved,
    onClearReply,
    onPublished,
  ])

  const publish = useCallback(() => send(false), [send])
  const repostAnyway = useCallback(() => send(true), [send])

  /** "Discard draft (it went out)": the controller checked the feed and the post is there. */
  const discardUnconfirmed = useCallback(() => {
    if (!awaitingDecision) return
    // The reply the unresolved request carried - survives a remount (it is persisted).
    const sentReplyTo = contextByKey.get(targetKey)?.replyTo
    unconfirmedByKey.delete(targetKey)
    discardDraft(exerciseId, personaId)
    setDraftContext(undefined)
    setTextState('')
    clearTray()
    setBaselineFields(EMPTY_BASELINE_FIELDS)
    setFailure(undefined)
    setLastPublished(null)
    setStatus('idle')
    if (sentReplyTo !== undefined && latestReplyToRef.current?.postId === sentReplyTo.postId) {
      onClearReply?.()
    }
  }, [awaitingDecision, targetKey, exerciseId, personaId, clearTray, onClearReply])

  /** Puts the draft's original reply setting back (see `ReplyMismatch`). */
  const matchDraftReply = useCallback(() => {
    if (draftContext === undefined) return
    if (draftContext.replyTo !== undefined) onRestoreReplyRef.current?.(draftContext.replyTo)
    else onClearReply?.()
  }, [draftContext, onClearReply])

  /** Accepts the current reply setting for the draft - never for a pending "did it go out?". */
  const keepCurrentReply = useCallback(() => {
    if (awaitingDecision) return
    contextByKey.delete(targetKey)
    setDraftContext(undefined)
  }, [awaitingDecision, targetKey])

  return {
    text,
    setText,
    charLimit,
    length,
    remaining,
    isOverLimit,
    canPublish,
    blockers,
    publish,
    awaitingDecision,
    repostAnyway,
    discardUnconfirmed,
    replyMismatch,
    matchDraftReply,
    keepCurrentReply,
    tray,
    baselineFields,
    baselineErrors: parsedBaseline.errors,
    baseline,
    setBaselineField,
    status,
    isPublishing,
    failure,
    lastPublished,
  }
}
