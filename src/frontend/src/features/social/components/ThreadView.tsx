/**
 * features/social/components/ThreadView.tsx
 * ---------------------------------------------------------------------------
 * Flattened thread view (feature: threads-replies, story 01 "Flattened
 * thread view"; SOC-010, D1-006, XC-004). Participant world (Pulse Social
 * skin) — no COBRA, no themed MUI.
 *
 * D1-006 settled the "flattened vs nested" open question: a thread renders
 * X-style FLAT — the ancestor chain (however deep) above the focused post,
 * the focused post enlarged, then its direct replies below it, each labelled
 * "Replying to @handle". Nested/indented was built, reviewed, and explicitly
 * rejected (it truncates past ~3 levels on real content) — this component
 * never indents by depth; `ThreadView.module.css`'s `.thread` is a single
 * flex column.
 *
 * Reuses `<PostCard>` (posts/02) for EVERY post here — ancestors, the focused
 * post, and every visible reply — exactly the way a feed would: `useThread()`
 * hands back participant-safe view models (`ParticipantPostView`/
 * `ThreadReplyView`), and this component resolves each one's
 * `authorPersonaId` to a `Persona` through the channel's shared directory
 * (`useSocialDirectory()`, which wraps the participant-safe `usePersonas()` read — never
 * `personaById`/`SEEDED_PERSONAS`) before assembling the `PostView` `<PostCard>`
 * renders. `<PostCard>` itself is never forked; the focused post is visually enlarged
 * only via `.focusedWrap`'s wrapper CSS.
 *
 * Tombstone (SOC-005/D1-009): the canonical `<Tombstone>` component (posts/05)
 * does not exist yet. A taken-down reply renders a MINIMAL, INTERIM inline
 * element here instead — plainly commented, not a reusable component — reading
 * exactly "This post is unavailable." (a `role="note"`, icon + words, never colour
 * alone). Replace this with the real `<Tombstone>` once posts/05 lands.
 *
 * REPLY CONTEXT (demo-polish F4). Every card that is itself a reply — the focused
 * post, an ancestor, each direct reply — shows its OWN "Replying to @handle" line
 * (`post/PostReplyContext`, driven by the card's `inReplyTo`). `ThreadReply` used to
 * print a separate label above each reply and blank the card's `inReplyTo` to avoid
 * a duplicate; that is gone, so there is exactly one line. (A reply without
 * `inReplyTo` — a legacy body — gets one derived from `replyToPersonaId`.)
 *
 * THE REPLY COMPOSER (F4). Under the focused post, `<ReplyComposer>` ("Replying to
 * @handle", ring counter, attach tray) — ABSENT, not disabled, for a read-only or
 * persona-less session (D1-011). A reply you post is appended to this thread at
 * once (`useThread().appendReply`, de-duplicated against its realtime echo). The
 * reply button on the focused card focuses the composer; on any other card it opens
 * that post's thread (`onOpenThread`) with its composer focused (`replyIntent`).
 *
 * LIVE REPLIES (F4). For sessions that stream, `useThread` appends a reply that
 * arrives over realtime for the focused post BELOW the existing ones — no scroll
 * movement — raises the focused post's reply count, and a visually-hidden polite
 * live region announces "1 new reply" (it is mounted from the first render so the
 * change is announced). Replies never reach the feed's "new posts" pill; they land
 * here. An observer / read-only session does not stream (the same D1-011 rule that
 * hides the pill).
 *
 * Telemetry (XC-004): emits exactly one `'view'` event on mount (and again if
 * `focusedPostId` changes without a remount) via `buildAndEmit` — never the
 * raw build+emit form. `eventType: 'view'` requires
 * `actor.participantId`/`actor.sessionId` (the schema's conditional
 * `superRefine`) or the event is silently dropped; this always supplies
 * `actor.participantId` from the bound session (`useSession().accountId`).
 *
 * Scenario time (COR-053): every post's relative/absolute time renders inside
 * `<PostCard>` itself, via `useScenarioTime()` — this component never reads
 * wall-clock. The one wall-clock read here (`wallClockNowIso()`) is
 * telemetry-only, stamping the `view` event's `wallClockTime`, never rendered.
 *
 * ONE CAST READ, SHARED WITH THE CHANNEL (Copilot review, PR #460). The cast comes from
 * the channel's directory (`SocialChannel` mounts `SocialDirectoryProvider` above the
 * frame, which resolves it once); this component never reads one of its own. It used to
 * call `usePersonas()`, a per-caller fetch with no shared cache, which was a duplicate
 * `GET /personas` on every thread open AND a visible blank: the thread GET and that
 * private read are independent requests, so whenever the thread landed first `useThread`
 * said "loaded" ("Loading thread…" went away) while no author could be resolved yet, and
 * the whole body — ancestors, focused post, composer, replies — was empty, with no
 * indicator, until the private read finished. With the directory already loaded (every
 * in-app navigation to a thread) the cards render the moment the thread GET lands.
 * `useSocialDirectory()` fails closed outside a Social channel, so `<ThreadView>` must be
 * mounted under a `SocialDirectoryProvider`; in the app that is always so (its only mount
 * is `ThreadRoute`), and a test that mounts it directly wraps it in the provider. A silent
 * fallback to a private read was rejected on purpose: it is the very duplicate this
 * removes.
 * COLD DEEP LINK (a reload on a thread URL): the directory itself can still be loading when
 * the thread GET lands. While the focused author cannot be resolved for that reason the
 * thread keeps its "Loading thread…" state (never a blank body) and the cards render in the
 * step that clears it; if the directory read FAILS instead, the loading state ends in the
 * thread's existing "Unable to load this thread." state rather than spinning forever.
 *
 * Isolation (COR-001/XC-002): `useExerciseContext().exerciseId` is read ONLY
 * to stamp the telemetry envelope, never as a query-scoping param — the
 * thread's actual scope is server-side (`useThread`'s resolution seam).
 *
 * ENGAGEMENT WIRING LIVES IN THE CARD (demo-polish F0, DP-14). Until F0 every
 * `<PostCard>` here went through an internal `ThreadCard` wrapper that called
 * `useReaction()`/`useAmplify()` and threaded the like/repost/quote props (+ an
 * inline `<QuoteComposer>`) into the card. That wiring moved INTO `PostActions` (a
 * part of the card), which self-wires the same hooks — so ancestors, the focused
 * post and every visible reply render a bare `<PostCard>` and still have live
 * like/repost. Behaviour is unchanged. `onHashtagOpen` / `onOpenProfile` still
 * thread straight through. (A taken-down reply never mounts a card at all, so
 * there is nothing to react to — the tombstone below is unchanged.)
 *
 * READ-ONLY VARIANT (WR-003, COR-015/D1-011 — RESOLVED): this component now
 * reads the shell mount variant via `useShellContext()`, exactly like
 * `<Feed>`, and threads `cardVariant` (`affordancesAvailable(variant) ?
 * 'full' : 'readOnly'`) into every `<PostCard>` (ancestors, the focused post,
 * and each visible reply) — the visual "controls absent, counts inert"
 * treatment now matches `<Feed>`'s for an observer session, not just the
 * handlers' functional no-op.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBan } from '@fortawesome/free-solid-svg-icons'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Persona } from '@/features/personas'
import { PostCard, type ParticipantPostView, type PostView } from '@/features/social'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { toPostView } from '../services/feedService'
import { consumeReplyFocus, requestReplyFocus } from '../services/replyIntent'
import { useThread, type ThreadReplyView } from '../hooks/useThread'
import { useSocialDirectory } from '../layout/socialDirectory'
import { ReplyComposer } from './ReplyComposer'
import styles from './ThreadView.module.css'

/** Mirrors `Feed.tsx`'s local `CardVariant` — the two `<PostCard>` render
 * modes a shell variant maps to (COR-015/D1-011). */
type CardVariant = 'full' | 'readOnly'

export interface ThreadViewProps {
  /** The post id the thread is centered on. */
  readonly focusedPostId: string
  /** Opens the tapped hashtag's feed (SOC-040); the shell channel supplies
   * it. Omitted in isolation — hashtags stay inert links. */
  readonly onHashtagOpen?: (tag: string) => void
  /**
   * Opens the tapped AUTHOR's profile (SOC-050); the shell channel supplies
   * it, and threads it to EVERY card here — ancestors, the focused post, and
   * each visible reply — so the tap-through works from inside an open thread,
   * not only from the feed. Omitted in isolation — the author identity stays
   * inert text (no focusable no-op, WR-002).
   */
  readonly onOpenProfile?: (personaId: string) => void
  /**
   * Opens ANOTHER post's thread - an ancestor or a reply tapped inside this one.
   * The shell supplies it. Omitted in isolation: those cards then have no open
   * target, and their reply button stays inert (the focused post's reply button
   * still focuses the composer).
   */
  readonly onOpenThread?: (id: string) => void
}

/** Builds the `PostView` `<PostCard>` renders from a participant-safe post
 * view + its resolved author, or `undefined` if the author can't be resolved
 * yet (e.g. personas still loading) — the caller skips rendering that post
 * rather than passing `<PostCard>` an incomplete author. Delegates to the
 * shared `feedService.toPostView`, which carries every contract-v2 member. */
function resolvePostView(
  view: ParticipantPostView,
  personaMap: ReadonlyMap<string, Persona>,
): PostView | undefined {
  const author = personaMap.get(view.authorPersonaId)
  if (!author) return undefined
  return toPostView(view, author)
}

export function ThreadView({
  focusedPostId,
  onHashtagOpen,
  onOpenProfile,
  onOpenThread,
}: ThreadViewProps) {
  const session = useSession()
  const { exerciseId, timeZone } = useExerciseContext()

  // WR-003 (COR-015/D1-011): mirrors `<Feed>`/`<Profile>` exactly — the shell
  // variant decides whether every `<PostCard>` this thread renders (ancestors,
  // focused post, replies) gets the interactive action row or the
  // absent-controls/inert-counts read-only treatment.
  const { variant } = useShellContext()
  const affordances = affordancesAvailable(variant)
  const cardVariant: CardVariant = affordances ? 'full' : 'readOnly'

  // The reply box exists only for a session that can write AS a persona (D1-011:
  // absent, never disabled).
  const canReply = affordances && !session.isReadOnly && session.personaId !== undefined

  // Live reply append streams for the same sessions the feed's pill does.
  const { ancestors, focused, replies, loading, error, newReplyCount, appendReply } = useThread(
    focusedPostId,
    {
      live: affordances,
      ...(session.personaId !== undefined ? { viewerPersonaId: session.personaId } : {}),
    },
  )
  // The channel's shared cast (see ONE CAST READ in the module header): no read of its own.
  const { personas, loading: directoryLoading, error: directoryError } = useSocialDirectory()

  const personaMap = useMemo(
    () => new Map(personas.map(persona => [persona.id, persona])),
    [personas],
  )

  // The reply composer's text area: focused when a card's reply button was the way
  // into this thread (`replyIntent`), and by the focused card's own reply button.
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const focusComposer = useCallback(() => {
    composerInputRef.current?.focus()
  }, [])

  // The reply intent is spent only when it can be honoured. "Loaded" is not enough:
  // the composer needs the focused author's persona too (the directory is a separate
  // read that, on a cold deep link, can still be loading when the thread GET lands), so
  // wait until the composer is actually mounted. A thread that FAILED to load never will,
  // so the request is dropped then (it must not linger and fire on a later visit). Where
  // no composer will ever exist (read-only / persona-less) it is consumed and ignored.
  const loadedId = focused?.id
  const loadedAuthorId = focused?.authorPersonaId
  const composerMountable = loadedAuthorId !== undefined && personaMap.has(loadedAuthorId)
  useEffect(() => {
    if (loading) return
    if (error || loadedId === undefined) {
      consumeReplyFocus(focusedPostId)
      return
    }
    // Still holding the PREVIOUS thread (the host re-centered without a remount).
    if (loadedId !== focusedPostId) return
    if (canReply && !composerMountable) return
    if (consumeReplyFocus(focusedPostId) && canReply) composerInputRef.current?.focus()
  }, [loading, error, loadedId, focusedPostId, canReply, composerMountable])

  // Reply on ANOTHER post's card: open that post's thread to reply there.
  const openThreadToReply = useCallback((postId: string) => {
    if (onOpenThread === undefined) return
    requestReplyFocus(postId)
    onOpenThread(postId)
  }, [onOpenThread])

  // Emit-once-per-focused-post guard (mirrors Feed.tsx): the effect double-
  // invokes under React StrictMode (dev) and re-runs whenever any dep changes,
  // but a thread-open 'view' should fire ONCE per focused post — and again only
  // when the caller re-centers this component on a DIFFERENT post without a
  // remount. Keying the ref on focusedPostId gives exactly that.
  const emittedForRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (emittedForRef.current === focusedPostId) return
    emittedForRef.current = focusedPostId
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'thread', entityId: focusedPostId },
    })
  }, [focusedPostId, exerciseId, timeZone, session.accountId])

  // The polite "N new replies" region is the FIRST child of the one <section> in every
  // state, so it is the same DOM node from the first render (loading included) and a
  // later change is announced. Nothing below depends on its position.
  const liveRegion = (
    <p
      className={styles.srOnly}
      role="status"
      aria-live="polite"
      data-testid="thread-live-region"
    >
      {newReplyCount === 0
        ? ''
        : `${newReplyCount} new ${newReplyCount === 1 ? 'reply' : 'replies'}`}
    </p>
  )

  // A status-only thread (loading / unavailable): the SAME <section> and live region as the
  // full render below, so the polite region is one DOM node across every state.
  const statusOnly = (text: string) => (
    <section className={styles.thread} data-testid="thread-view" aria-label="Thread">
      {liveRegion}
      <p className={styles.status}>{text}</p>
    </section>
  )

  if (loading) return statusOnly('Loading thread…')

  // A failed thread GET is reported at once: it is never held behind a directory that is
  // still loading, which could not change the outcome.
  if (error || !focused) return statusOnly('Unable to load this thread.')

  const focusedView = resolvePostView(focused, personaMap)

  // COLD DEEP LINK (a reload on a thread URL): the directory is a separate read and can
  // still be in flight when the thread GET lands, so no author can be resolved yet. That
  // is still LOADING -- the same state the reader was already looking at -- not a blank
  // body, so it holds until the cast lands and the cards then render in the step that
  // clears it. If the cast read FAILS instead, the loading state ends (it must never spin)
  // in this thread's existing "unavailable" state: with no cast there is no author to show.
  if (focusedView === undefined) {
    if (directoryLoading) return statusOnly('Loading thread…')
    if (directoryError !== undefined) return statusOnly('Unable to load this thread.')
  }

  return (
    <section className={styles.thread} data-testid="thread-view" aria-label="Thread">
      {liveRegion}

      {ancestors.map(ancestor => {
        const view = resolvePostView(ancestor, personaMap)
        return view
          ? (
            <PostCard
              key={view.id}
              post={view}
              variant={cardVariant}
              onOpen={onOpenThread}
              onReply={onOpenThread !== undefined ? openThreadToReply : undefined}
              onHashtagOpen={onHashtagOpen}
              onOpenProfile={onOpenProfile}
            />
          )
          : null
      })}

      {focusedView && (
        <div className={styles.focusedWrap} data-testid="thread-focused">
          <PostCard
            post={focusedView}
            variant={cardVariant}
            onReply={canReply ? focusComposer : undefined}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        </div>
      )}

      {canReply && focusedView && (
        <div className={styles.composerWrap} data-testid="thread-reply-composer">
          {/* Keyed by the thread: moving to another post gives a fresh composer (and
              its draft), and a publish still in flight from the old one is bound to
              ITS thread, so a late 201 can never append under the wrong post. */}
          <ReplyComposer
            key={focused.id}
            parentPostId={focused.id}
            parentHandle={focusedView.author.handle}
            onPosted={view => appendReply(view, focused.id)}
            inputRef={composerInputRef}
          />
        </div>
      )}

      {replies.map(reply => (
        <ThreadReply
          key={reply.id}
          reply={reply}
          focusedPostId={focused.id}
          personaMap={personaMap}
          variant={cardVariant}
          onOpenThread={onOpenThread}
          onReply={onOpenThread !== undefined ? openThreadToReply : undefined}
          onHashtagOpen={onHashtagOpen}
          onOpenProfile={onOpenProfile}
        />
      ))}
    </section>
  )
}

interface ThreadReplyProps {
  readonly reply: ThreadReplyView
  /** The thread's focused post: what a reply without `inReplyTo` is replying to. */
  readonly focusedPostId: string
  readonly personaMap: ReadonlyMap<string, Persona>
  /** WR-003: threaded through to the reply's `<PostCard>` (COR-015/D1-011). */
  readonly variant: CardVariant
  readonly onOpenThread?: (id: string) => void
  readonly onReply?: (id: string) => void
  readonly onHashtagOpen?: (tag: string) => void
  readonly onOpenProfile?: (personaId: string) => void
}

/** One reply row: the reply's `<PostCard>` - which carries its own "Replying to
 * @handle" line - or, if it was taken down (SOC-005/D1-009), the interim in-thread
 * tombstone (which never mounts a card: there is nothing to react to). */
function ThreadReply({
  reply,
  focusedPostId,
  personaMap,
  variant,
  onOpenThread,
  onReply,
  onHashtagOpen,
  onOpenProfile,
}: ThreadReplyProps) {
  const resolved = resolvePostView(reply, personaMap)
  // Contract replies carry `inReplyTo`; for a body that does not, name the replied-to
  // author from `replyToPersonaId` so the card still shows its context line.
  const repliedToHandle = personaMap.get(reply.replyToPersonaId)?.handle
  const view = resolved !== undefined && resolved.inReplyTo === undefined && repliedToHandle
    ? { ...resolved, inReplyTo: { postId: focusedPostId, authorHandle: repliedToHandle } }
    : resolved

  return (
    <div className={styles.replyGroup} data-testid="thread-reply">
      {reply.status === 'taken-down' ? (
        // INTERIM tombstone - `<Tombstone>` (posts/05) does not exist yet.
        // Replace this element with the real component once it lands.
        <div className={styles.tombstone} data-testid="thread-tombstone" role="note">
          <FontAwesomeIcon icon={faBan} aria-hidden="true" />
          <span>This post is unavailable.</span>
        </div>
      ) : (
        view && (
          <PostCard
            post={view}
            variant={variant}
            onOpen={onOpenThread}
            onReply={onReply}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        )
      )}
    </div>
  )
}
