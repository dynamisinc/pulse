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
 * back after a remount, and a response that lands while NO composer for that persona is on
 * screen (dock closed, another persona on screen) restores the draft, raises an app toast
 * ("status unknown - check the feed" for this kind) and leaves the question waiting. (If a
 * remounted composer has ADOPTED the request - see the next paragraphs - it shows the banner
 * instead and no toast is raised: one outcome, one place.)
 *
 * ONE REQUEST IN FLIGHT PER TARGET, FOR THE WHOLE SESSION - NOT PER HOOK INSTANCE. Post create
 * is not idempotent (#455), and the dock can unmount a composer while its request is still out
 * (the ENGINE / USAGE flyout takes the dock over and the draft is kept; the live gateway may hold
 * a POST for 230 s). If the guard lived in the instance, reopening that persona would hand a
 * fresh, empty guard to a composer seeded with the SAME draft - and Post would send it twice. So
 * in-flight ownership is a module-level map keyed by the target (`inFlightByKey`, beside the
 * draft / question / context stores), and every request is its own object (its identity is the
 * token): a response releases ONLY the entry it created, never a newer one for the same key, and
 * a response for persona A can never unlock persona B. `send` (hence Post, Ctrl/Cmd+Enter and
 * "post again") is a no-op while the key has an entry, whichever instance asks. ONE REQUEST PER
 * TARGET, ALWAYS: an entry ends only with its own response, the request's own deadline
 * (`publishAsPersonaLive` ends the POST at `PUBLISH_TIMEOUT_MS`, just past the gateway's 230 s,
 * and a request with no response is an 'unconfirmed' outcome - so a hung POST can not lock the
 * persona until sign-out), or sign-out. The explicit Esc / X does NOT end it (last paragraph).
 *
 * ADOPTING A REQUEST. A composer that MOUNTS (or switches target) onto a key with a request in
 * flight starts locked - `status: 'publishing'`, `isPublishing` true, so the composer shows the
 * same "Posting..." state as the sender - and ADOPTS that request. It did not send it, so it
 * does not run the sender's closure; when the request settles it takes the outcome over from the
 * module stores the sender has by then made final (the same idea as the target-change effect,
 * which re-seeds from them):
 *   - success: the draft is gone (the sender discarded it if it was still what was sent), the
 *     "Posted ..." state shows, and the route's reply target is cleared only if it is STILL the
 *     one the post answered (the rule in the next paragraph);
 *   - unconfirmed: the "Post status unknown" question comes back (`awaitingDecision`) with the
 *     draft and the reply it was written for (after an ENGINE / USAGE takeover that reply was
 *     already put back on the route at mount; after Esc / X it is not - see the last paragraph);
 *   - any other failure: the persisted draft comes back with the classified failure banner.
 * The settlement reaches it through a small module-level subscribe / notify (`subscribeSettlement`)
 * that a mounted adopter joins in a layout effect and leaves on unmount, and the outcome is also
 * written ON the request object, so an adopter that mounts a hair before the response lands still
 * finds it on subscribing. The instance that SENT the request never adopts it (its own closure
 * handles the response, wherever it is by then), and `onPublished` is only ever the sender's.
 *
 * A RESPONSE ONLY SETTLES ITS OWN REQUEST. A success clears the route's reply target only if (a)
 * a composer is STILL on screen for it - the sender if it has not moved, otherwise the adopter -
 * and (b) the target is STILL the one the post answered. (a) matters because the route's target
 * outlives no dock: once the composer unmounts the route has already dropped the target, and
 * anything it holds now was set AFTER the post was sent - e.g. a fresh "Reply as" on another post
 * - which a late 201 must never wipe (it would turn that reply into a top-level post).
 *
 * An adopter can not see (a) with its eyes shut - the route's target on a reopened dock is either
 * one RESTORED from the draft's recorded reply or one the controller deliberately picked, and the
 * two look the same. So it applies (b) twice. WHEN IT ADOPTS it captures the reply the draft was
 * recorded for (`contextByKey`; absent when that record is gone, e.g. the controller cleared the
 * reply while the post was out). When the response lands it clears the route's target only if that
 * captured reply IS the post this request answered AND the route still holds exactly that target.
 * A target the controller re-picked over a record that no longer says "reply to that post" is the
 * controller's own and survives the late 201.
 *
 * A REPLY NEVER TURNS INTO A TOP-LEVEL POST ON REMOUNT. Everything that persists across an
 * unmount - the "Post status unknown" question, the draft an off-screen failure restored, and a
 * plain typed draft that survived a non-explicit close (the ENGINE / USAGE flyout taking the dock
 * over) - is persisted TOGETHER WITH the reply it was written for (`contextByKey`, which may say
 * "no reply"): recorded on every keystroke while a reply target is set, and at an unconfirmed /
 * off-screen failure. While this composer stays on screen the record FOLLOWS the route's target
 * (the controller choosing "Reply as" on another post is a deliberate retarget), except while a
 * "did it go out?" question is open, which is pinned to the request it is about. The route drops
 * its reply target when the dock closes or the persona changes, so on a fresh mount the hook
 * compares the two:
 *   - route target absent -> it asks the route to put the draft's reply back
 *     (`onRestoreReply`; the "Replying to @x" banner shows again);
 *   - they still differ (no restore callback, a different "Reply as", the controller cleared
 *     it) -> `replyMismatch` is set, Post / "post again" are blocked, and the composer says
 *     what the draft was. `matchDraftReply()` puts the original setting back;
 *     `keepCurrentReply()` accepts what is on screen - not offered for a pending "did it go
 *     out?" question, whose re-send must be the SAME request, unless the post it replied to was
 *     taken down (that request can never be re-sent, so "post as a new post instead" is the way
 *     out; the two-step "post again anyway" still follows).
 *
 * A RESPONSE AFTER SIGN-OUT CHANGES NOTHING. `reset()` (sign-out) bumps a module-level session
 * epoch and `send` captures it: a response that lands in a LATER epoch - the previous user's
 * request resolving after `endSession` - persists nothing, raises no toast and calls neither
 * `onClearReply` nor `onPublished`, so it can not re-create the previous user's draft, question
 * or reply for the next sign-in on the same tab. `reset()` also FORGETS every in-flight entry, so
 * the next session's composer for the same key is not locked by the previous user's request; and
 * because a response only releases the entry it created (and a previous-session response returns
 * before touching anything), the old response can not delete a newer session's entry for that key.
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
 *
 * AN EXPLICIT DISCARD DISCARDS THE DRAFT, NOT THE REQUEST. Esc / X forgets the text, the question
 * and the reply context, but a request that is already out is still out: the persona stays LOCKED
 * until that request settles, bounded by `PUBLISH_TIMEOUT_MS`. The cost - the controller can not
 * post as that persona for up to ~4 minutes after Esc / X while a hung request finishes - is the
 * price of never having two requests live on one key (a second one could settle first, and the
 * first one's late answer would then overwrite its question, draft or reply context). A composer
 * reopened after Esc / X is therefore an ADOPTER like any other (see "adopting a request"): locked
 * and read-only, with Post, Ctrl/Cmd+Enter and "post again" sending nothing, and it takes the
 * outcome over when the request settles - a success shows "Posted"; an unconfirmed outcome brings
 * back the "Post status unknown" question with the text that was sent; a failure brings back the
 * text and the failure banner. (The draft is empty in the meantime: it was discarded.)
 *
 * THE REPLY AFTER Esc / X IS NOT PUT BACK ON THE ROUTE. The discard also forgot the reply context,
 * and the controller dropped that reply on purpose, so `takeOver` deliberately has NO auto-restore
 * (`onRestoreReply`) - it would undo an explicit act. The reply the request carried comes back
 * only as the DRAFT'S RECORDED REPLY, in both the unconfirmed and the plain-failure case. If the
 * route holds no such target the composer shows "This draft was a reply to @a" with "Reply to @a
 * again", and Post / Retry / "post again" stay blocked until the controller chooses - so a reply
 * is never sent as a top-level post. (A post that was NOT a reply has nothing to choose, and
 * Retry works at once.) The ENGINE / USAGE takeover differs only in that its context survives, so
 * the reply is put back on the route at mount.
 *
 * A LOCKED COMPOSER IS READ-ONLY IN THE HOOK, NOT JUST IN THE DOM. While a request for the target
 * is out, `setText`, `setBaselineField` and the tray's editing calls (`addFiles`,
 * `setLibrarySelection`, `setAlt`, `remove`) do nothing, for any consumer: nothing typed after
 * Post can reach the persisted draft, the reply context or the tray, and the draft a success
 * clears or a failure restores is exactly what was sent.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
 * reply because the controller pressed "Reply as..." before reopening the dock. Set alongside
 * an unconfirmed question, an off-screen-restored draft, and a typed draft while a reply
 * target is set (see the module header); absent = unknown (no guard).
 */
interface DraftContext {
  readonly replyTo: ReplyTarget | undefined
}
const contextByKey = new Map<string, DraftContext>()

/**
 * Bumped by {@link reset} (sign-out). A request captures it when it is sent; a response that lands
 * after the epoch moved belongs to a previous session and is ignored (see the module header).
 */
let sessionEpoch = 0

/** How a request ended - what an ADOPTING composer takes over (see the module header). */
type SettledOutcome =
  | { readonly kind: 'success'; readonly post: Post }
  | { readonly kind: 'failure'; readonly failure: PublishFailure }

/**
 * One publish request that is out and has not been answered. Every `send` creates its OWN object,
 * and the object's identity is the request's token: a response releases only the entry it created.
 */
interface InFlightRequest {
  /** The target (`draftKey`) it was sent for. */
  readonly key: string
  /** The session epoch it was sent in; a response in a later epoch changes nothing. */
  readonly epoch: number
  /** The hook instance that sent it (`useId`): that instance's closure handles the response. */
  readonly sender: string
  /** The reply it carried (`undefined` = a top-level post). */
  readonly replyTo: ReplyTarget | undefined
  /** Set once, when the response lands (after the stores are final); read by an adopter. */
  outcome: SettledOutcome | undefined
}

/**
 * `"exerciseId::personaId" -> the request in flight for that target`. SESSION-WIDE, not per hook
 * instance: the dock can unmount a composer while its request is still out, and the composer
 * that mounts next for the same persona must not be able to send the same draft again. At most
 * one entry per key (`send` refuses while there is one). Emptied by {@link reset}.
 */
const inFlightByKey = new Map<string, InFlightRequest>()

/** `key -> the adopting composers waiting for that target's request to settle`. */
const settlementListeners = new Map<string, Set<() => void>>()

/**
 * Subscribes `listener` to the settlement of the request in flight for `key` - a composer that
 * ADOPTED it joins here. {@link settleRequest} calls the listeners once the module stores are
 * final, so a listener reads the settled state. Returns an unsubscribe.
 */
function subscribeSettlement(key: string, listener: () => void): () => void {
  let listeners = settlementListeners.get(key)
  if (listeners === undefined) {
    listeners = new Set()
    settlementListeners.set(key, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = settlementListeners.get(key)
    current?.delete(listener)
    if (current?.size === 0) settlementListeners.delete(key)
  }
}

/** An adopting composer is on screen for `key` (so a failure needs no off-screen toast). */
function hasAdopter(key: string): boolean {
  return (settlementListeners.get(key)?.size ?? 0) > 0
}

/** Releases `request`'s own entry - never a newer request's for the same key. */
function releaseInFlight(request: InFlightRequest): void {
  if (inFlightByKey.get(request.key) === request) inFlightByKey.delete(request.key)
}

/** Records how `request` ended, then wakes the composers subscribed to its key (the adopters). */
function settleRequest(request: InFlightRequest, outcome: SettledOutcome): void {
  request.outcome = outcome
  for (const listener of [...(settlementListeners.get(request.key) ?? [])]) listener()
}

/**
 * A request a composer ADOPTED, with the reply the draft was recorded for at the moment it did.
 * The record can disappear or change afterwards (the controller clears the reply while the post
 * is out), and "was this target restored from the draft, or re-picked by the controller?" can only
 * be answered from what the draft said WHEN ADOPTION STARTED.
 */
interface AdoptedRequest {
  readonly request: InFlightRequest
  /** `contextByKey.get(key)?.replyTo?.postId` at adoption; `undefined` = no reply recorded. */
  readonly draftReplyPostId: string | undefined
}

/** Adoption of the request in flight for `key`, if any (the caller rules out its own request). */
function adoptionOf(key: string): AdoptedRequest | undefined {
  const request = inFlightByKey.get(key)
  return request === undefined
    ? undefined
    : { request, draftReplyPostId: contextByKey.get(key)?.replyTo?.postId }
}

/** What a composer that mounts (or switches) onto `key` starts from: locked, asking, or idle. */
function seedStateFor(key: string): { status: PublishStatus; failure: PublishFailure | undefined } {
  // A request in flight wins over a pending question (a "post again anyway" is a request too).
  if (inFlightByKey.has(key)) return { status: 'publishing', failure: undefined }
  const pending = unconfirmedByKey.get(key)
  return pending !== undefined
    ? { status: 'error', failure: pending }
    : { status: 'idle', failure: undefined }
}

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
 * unmount; see the module header). A no-op if there was no draft. It does NOT touch a request
 * that is already in flight: the draft goes, the lock stays (see the module header).
 */
function discardDraft(exerciseId: string, personaId: string): void {
  const key = draftKey(exerciseId, personaId)
  draftByKey.delete(key)
  unconfirmedByKey.delete(key)
  contextByKey.delete(key)
}

/**
 * Forgets EVERY persisted draft, "did it go out?" question, reply context and in-flight entry.
 * Called when the session ends (`core/auth/endSession`): the next staff user on the same tab must
 * not inherit the previous one's unsent text, unresolved question or locked composer. Also the
 * test reset.
 */
function reset(): void {
  sessionEpoch += 1
  inFlightByKey.clear()
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
//
// The unregister is tied to Vite's hot replacement of THIS module, so a dev session does not
// accumulate one stale reset per edit (Gate-2 A S-NEW-4).
registerSessionReset(reset, import.meta.hot)

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
  /**
   * The ids of posts taken down in this session. Lets the hook tell that the post a persisted
   * draft was written as a reply to is gone (`ReplyMismatch.originalRemoved`), so a pending
   * "did it go out?" question about it can be answered with "post as a new post instead".
   */
  readonly removedPostIds?: ReadonlySet<string>
}

/**
 * A persisted draft whose reply setting no longer matches the route's. `original` is what the
 * draft was written for (`undefined` = a top-level post); `current` is what the route holds now.
 */
export interface ReplyMismatch {
  readonly original: ReplyTarget | undefined
  readonly current: ReplyTarget | undefined
  /** The post the draft replied to has been taken down: that request can never be re-sent. */
  readonly originalRemoved: boolean
  /**
   * `keepCurrentReply()` is available: always, except for a pending "did it go out?" question
   * whose original request could still be re-sent (see the module header).
   */
  readonly canKeepCurrent: boolean
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
    removedPostIds,
  } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const personaId = activePersona.id
  const targetKey = draftKey(exerciseId, personaId)

  const [text, setTextState] = useState(() => getPersistedDraft(exerciseId, personaId))
  const tray = useAttachmentTray()
  const [baselineFields, setBaselineFields] = useState(EMPTY_BASELINE_FIELDS)
  // A target with a request already in flight (sent by a composer that has since unmounted)
  // starts LOCKED, and this instance ADOPTS that request: see the module header.
  const instanceId = useId()
  const [status, setStatus] = useState<PublishStatus>(() => seedStateFor(targetKey).status)
  const [failure, setFailure] = useState<PublishFailure | undefined>(
    () => seedStateFor(targetKey).failure,
  )
  const [adopted, setAdopted] = useState<AdoptedRequest | undefined>(() => adoptionOf(targetKey))
  const [lastPublished, setLastPublished] = useState<Post | null>(null)
  // What the persisted draft (if any) was written for - see `contextByKey`.
  const [draftContext, setDraftContext] = useState<DraftContext | undefined>(() =>
    contextByKey.get(targetKey),
  )
  // The target whose "put the draft's reply back" attempt has run (S-NEW-1: until it has, a
  // restorable mismatch is not announced - the restore usually resolves it before paint).
  const [restoreAttemptedFor, setRestoreAttemptedFor] = useState<string | null>(null)

  // The target a response belongs to must still be the one on screen when it lands. (What is in
  // flight is NOT instance state: `inFlightByKey` is session-wide, see the module header.)
  const targetRef = useRef(targetKey)
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
  const onClearReplyRef = useRef(onClearReply)
  useEffect(() => {
    onClearReplyRef.current = onClearReply
  }, [onClearReply])

  // If the compose TARGET changes (a different exercise or persona - NOT merely a
  // remount for the SAME one, which the lazy initializers above already handle),
  // adopt THAT target's own persisted draft instead of carrying over whatever was
  // mid-typed for the previous target, and drop every transient outcome (an error
  // banner or "Posted" line for persona A must not follow the controller to B). One
  // extra render on a genuine target change is an acceptable, standard trade for
  // staying lint-clean (`react-hooks/refs` forbids reading/writing a ref during
  // render, even for this "adjust state" pattern).
  //
  // NOT on the first run for the target this instance MOUNTED with: the lazy initializers
  // seeded everything already, and a passive effect can run a frame AFTER the DOM is on screen
  // (it did in tests, under load: `findBy*` resolved on the DOM, the file was picked, and then
  // this effect emptied the tray - or reset a publish already in flight to 'idle'). Resetting
  // state a user may already have changed is the bug, not the safety it was meant to be.
  const { clear: clearTray } = tray
  const seededKeyRef = useRef(targetKey)
  useEffect(() => {
    const key = draftKey(exerciseId, personaId)
    targetRef.current = key
    if (seededKeyRef.current !== key) {
      seededKeyRef.current = key
      setTextState(getPersistedDraft(exerciseId, personaId))
      // A request still in flight for the new target locks this composer and is adopted (unless
      // this very instance sent it: its own closure handles the response). A post that may
      // already be live comes back asking, not as a fresh draft.
      const seed = seedStateFor(key)
      const adoption = adoptionOf(key)
      const adoptable = adoption !== undefined && adoption.request.sender !== instanceId
      setAdopted(adoptable ? adoption : undefined)
      setStatus(seed.status)
      setFailure(seed.failure)
      setLastPublished(null)
      setBaselineFields(EMPTY_BASELINE_FIELDS)
      clearTray()
      setDraftContext(contextByKey.get(key))
    }
    // The draft comes back with the reply it was written for. The route dropped its target
    // when the dock closed / the persona changed, so ask it to put that target back (a
    // PASSIVE effect on purpose: the route's own bookkeeping of the active persona is only
    // current by now). If it cannot, `replyMismatch` blocks the send instead.
    const context = contextByKey.get(key)
    if (context?.replyTo !== undefined && latestReplyToRef.current === undefined) {
      onRestoreReplyRef.current?.(context.replyTo)
    }
    setRestoreAttemptedFor(key)
  }, [exerciseId, personaId, clearTray, instanceId])

  // ADOPTION: while this composer waits on a request it did not send, take the outcome over when
  // it settles. The sender has made the module stores final by then (draft discarded or kept,
  // question recorded, reply context set), so this re-reads them - the same idea as the
  // target-change effect above. A LAYOUT effect so the subscription exists before any response can
  // land after the commit (the toast decision looks for adopters), and the first call catches an
  // outcome that was written between render and subscribe.
  //
  // That window - the adopter rendered 'publishing' but is not subscribed yet - is where the sender
  // could see "no adopter" and toast while this composer also shows the banner a moment later (two
  // signals for one outcome). It needs a render that is separated from its commit by a task, i.e.
  // a concurrent / transition render; for a discrete update (a click, a keypress, a mount) render,
  // commit and layout effects run in ONE task and no response can land in between. The cost if it
  // ever does is one redundant toast, never a lost or doubled outcome.
  useLayoutEffect(() => {
    if (adopted === undefined || adopted.request.key !== targetKey) return
    const { request, draftReplyPostId } = adopted
    let taken = false
    const takeOver = () => {
      const outcome = request.outcome
      if (outcome === undefined || taken) return
      taken = true
      setAdopted(undefined)
      setDraftContext(contextByKey.get(targetKey))
      // Locked, so the text is still what was sent unless the sender found the draft gone.
      setTextState(getPersistedDraft(exerciseId, personaId))
      if (outcome.kind === 'failure') {
        setFailure(outcome.failure)
        setLastPublished(null)
        setStatus('error')
        return
      }
      clearTray()
      setBaselineFields(EMPTY_BASELINE_FIELDS)
      setFailure(undefined)
      setLastPublished(outcome.post)
      setStatus('success')
      // Only if the draft was recorded as a reply to the post this request answered WHEN WE
      // ADOPTED IT (else the target on screen is one the controller picked over a record that is
      // gone) AND the route still holds exactly that target (Gate-2 A M-1; see the module header).
      if (
        request.replyTo !== undefined
        && draftReplyPostId === request.replyTo.postId
        && latestReplyToRef.current?.postId === request.replyTo.postId
      ) {
        onClearReplyRef.current?.()
      }
    }
    const unsubscribe = subscribeSettlement(targetKey, takeOver)
    takeOver()
    return unsubscribe
  }, [adopted, targetKey, exerciseId, personaId, clearTray])

  // Mirrors every keystroke into the persisted-draft store (Gate-1 WR-103) -
  // see the module header. Cheap (a few Map writes). The reply the draft is being written FOR
  // goes with it, so a typed reply that survives a non-explicit dock close comes back as one.
  const setText = useCallback(
    (value: string) => {
      // Locked while a request for this target is out (see the module header): the registry,
      // not this instance's state, is the truth, so a stale render can not slip a write through.
      if (inFlightByKey.has(draftKey(exerciseId, personaId))) return
      setTextState(value)
      setPersistedDraft(exerciseId, personaId, value)
      const key = draftKey(exerciseId, personaId)
      // A pending "did it go out?" question owns its context.
      if (unconfirmedByKey.has(key)) return
      if (value === '') {
        contextByKey.delete(key)
        setDraftContext(undefined)
        return
      }
      const current = latestReplyToRef.current
      const recorded = contextByKey.get(key)
      // Record when there is nothing yet, or refresh the same reply. A DIFFERENT recorded
      // reply is an unresolved mismatch (a draft reopened under another "Reply as"): typing must
      // not quietly accept it - that is the controller's choice in the notice.
      const sameOrNone = recorded === undefined || recorded.replyTo?.postId === current?.postId
      if (current !== undefined && sameOrNone) {
        const next: DraftContext = { replyTo: current }
        contextByKey.set(key, next)
        setDraftContext(next)
      }
    },
    [exerciseId, personaId],
  )

  // While this composer STAYS on screen, a change of the route's reply target is the controller's
  // own gesture ("Reply as" on another post, the clear control): the draft's recorded reply
  // follows it. Adoption of a persisted draft (mount / persona / exercise change) is NOT followed -
  // that is where a mismatch is detected - and neither is a change while a "did it go out?"
  // question is open, which stays pinned to the request it is about.
  const followedKeyRef = useRef(targetKey)
  const followedReplyRef = useRef(replyTo?.postId)
  useEffect(() => {
    if (followedKeyRef.current !== targetKey) {
      followedKeyRef.current = targetKey
      followedReplyRef.current = replyTo?.postId
      return
    }
    if (followedReplyRef.current === replyTo?.postId) return
    followedReplyRef.current = replyTo?.postId
    if (unconfirmedByKey.has(targetKey)) return
    if (replyTo === undefined) {
      contextByKey.delete(targetKey)
      setDraftContext(undefined)
    } else if (contextByKey.has(targetKey) || (draftByKey.get(targetKey) ?? '') !== '') {
      const next: DraftContext = { replyTo }
      contextByKey.set(targetKey, next)
      setDraftContext(next)
    }
  }, [targetKey, replyTo])

  const setBaselineField = useCallback(
    (field: BaselineField, value: string) => {
      if (inFlightByKey.has(targetKey)) return // locked while a request is out
      setBaselineFields(current => ({ ...current, [field]: value }))
    },
    [targetKey],
  )

  // The tray the consumer sees: the same tray, with its EDITING calls locked while a request for
  // this target is out. (Upload progress, `clear` and the read-only fields pass straight through.)
  const guardedTray = useMemo<UseAttachmentTrayResult>(
    () => ({
      ...tray,
      addFiles: files => (inFlightByKey.has(targetKey) ? false : tray.addFiles(files)),
      setLibrarySelection: (ids, lookup) => {
        if (!inFlightByKey.has(targetKey)) tray.setLibrarySelection(ids, lookup)
      },
      setAlt: (key, alt) => {
        if (!inFlightByKey.has(targetKey)) tray.setAlt(key, alt)
      },
      remove: key => {
        if (!inFlightByKey.has(targetKey)) tray.remove(key)
      },
    }),
    [tray, targetKey],
  )

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
  // `blockingMismatch` is the truth and gates every send; `replyMismatch` is what is ANNOUNCED
  // - it holds back a mismatch the restore (the adoption effect, right after the first render) is
  // about to resolve, so the alert is not inserted and removed in one commit (S-NEW-1).
  const originalRemoved =
    draftContext?.replyTo !== undefined && removedPostIds?.has(draftContext.replyTo.postId) === true
  const blockingMismatch = useMemo<ReplyMismatch | undefined>(
    () =>
      draftContext !== undefined && draftContext.replyTo?.postId !== replyTo?.postId
        ? {
          original: draftContext.replyTo,
          current: replyTo,
          originalRemoved,
          canKeepCurrent: !awaitingDecision || originalRemoved,
        }
        : undefined,
    [draftContext, replyTo, originalRemoved, awaitingDecision],
  )
  const restorePending =
    blockingMismatch !== undefined
    && onRestoreReply !== undefined
    && blockingMismatch.original !== undefined
    && blockingMismatch.current === undefined
    && !originalRemoved
    && restoreAttemptedFor !== targetKey
  const replyMismatch = restorePending ? undefined : blockingMismatch
  const canPublish =
    hasContent &&
    !isOverLimit &&
    tray.blocker === undefined &&
    parsedBaseline.valid &&
    !isPublishing &&
    !awaitingDecision &&
    blockingMismatch === undefined &&
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
    // closure - a forced submit must still no-op when it shouldn't fire. The in-flight check
    // reads the SESSION-WIDE registry: a request sent by a composer that has since unmounted
    // still blocks this one (post create is not idempotent).
    if (inFlightByKey.has(targetKey)) return
    if (awaitingDecision && !force) return
    if (force && !awaitingDecision) return
    if (blockingMismatch !== undefined || replyTargetRemoved) return
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
    // This request's own registry entry: its identity is the token that lets the response release
    // ONLY itself. `epoch` is the session it belongs to: if the user signed out while it was in
    // flight, its response is the PREVIOUS user's and must change nothing (see the module header).
    const request: InFlightRequest = {
      key: targetKey,
      epoch: sessionEpoch,
      sender: instanceId,
      replyTo: sentReplyTo,
      outcome: undefined,
    }
    const fromAPreviousSession = () => request.epoch !== sessionEpoch

    const succeed = (post: Post) => {
      if (fromAPreviousSession()) return
      releaseInFlight(request)
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
      // The stores are final: a composer that ADOPTED this request takes the outcome over (it
      // applies the same reply-target rule below to its own route callbacks).
      settleRequest(request, { kind: 'success', post })
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
      if (fromAPreviousSession()) return
      releaseInFlight(request)
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
        // A DIFFERENT, newer draft is the controller's own and is left alone - defensive: writes
        // are locked while a request is out, so the persisted draft is '' or what was sent.)
        // (After an EXPLICIT discard the draft is '' here, so the text comes back too: the post
        // did not necessarily go out and the controller discarded before they could know. A
        // composer reopened meanwhile is an adopter and picks the text, question and banner up
        // from these stores when it takes the outcome over.)
        const persisted = getPersistedDraft(exerciseId, personaId)
        if (persisted === '' || persisted === text) {
          setPersistedDraft(exerciseId, personaId, text)
          contextByKey.set(targetKey, sentContext)
        }
        // ... and say so out loud - unless a composer that adopted this request is on screen:
        // it shows the banner, and a toast on top would be the same outcome twice.
        if (!hasAdopter(targetKey)) {
          const notify = classified.kind === 'unconfirmed' ? toast.warning : toast.error
          notify(describeOffscreenFailure(handle, classified), { autoClose: 10_000 })
        }
        settleRequest(request, { kind: 'failure', failure: classified })
        return
      }
      if (classified.kind === 'unconfirmed') setDraftContext(sentContext)
      setFailure(classified)
      setLastPublished(null)
      setStatus('error')
      settleRequest(request, { kind: 'failure', failure: classified })
    }

    inFlightByKey.set(targetKey, request)
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
    instanceId,
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
    blockingMismatch,
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

  /**
   * Accepts the current reply setting for the draft. Refused for a pending "did it go out?"
   * question - the re-send must be the SAME request - unless the post it replied to was taken
   * down: that request can never be re-sent, so the way out is a new post. (The two-step "post
   * again anyway" still follows; the question itself is not answered by this.)
   */
  const keepCurrentReply = useCallback(() => {
    if (awaitingDecision && !originalRemoved) return
    contextByKey.delete(targetKey)
    setDraftContext(undefined)
  }, [awaitingDecision, originalRemoved, targetKey])

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
    tray: guardedTray,
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
