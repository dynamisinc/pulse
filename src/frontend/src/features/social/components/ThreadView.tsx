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
 * `authorPersonaId` to a `Persona` via `usePersonas()` (the participant-safe
 * read path — never `personaById`/`SEEDED_PERSONAS`) before assembling the
 * `PostView` `<PostCard>` renders. `<PostCard>` itself is never forked; the
 * focused post is visually enlarged only via `.focusedWrap`'s wrapper CSS.
 *
 * Tombstone (SOC-005/D1-009): the canonical `<Tombstone>` component (posts/05)
 * does not exist yet. A taken-down reply renders a MINIMAL, INTERIM inline
 * element here instead — plainly commented, not a reusable component — reading
 * exactly "This post is unavailable." Replace this with the real `<Tombstone>`
 * once posts/05 lands.
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
 * Isolation (COR-001/XC-002): `useExerciseContext().exerciseId` is read ONLY
 * to stamp the telemetry envelope, never as a query-scoping param — the
 * thread's actual scope is server-side (`useThread`'s resolution seam).
 *
 * WAVE-S3.1 INTEGRATION (orchestrator-owned — reactions/01 + amplification/01
 * + hashtags-trending/01 "integration seam"): every `<PostCard>` this
 * component renders (ancestors, the focused post, and each visible reply) now
 * goes through the internal `ThreadCard` wrapper, which calls `useReaction()`/
 * `useAmplify()` for THAT post and threads `likedByViewer`/`onLike`,
 * `onRepost`/`onQuote` (+ an inline `<QuoteComposer>`), and `onHashtagOpen`
 * into it — the exact same per-row-hook shape `Feed.tsx`'s `FeedRow` uses.
 * `useReaction`/`useAmplify` both gate on the bound session's `isReadOnly`
 * internally, so an observer session's like/repost/quote here are already
 * functional no-ops (D1-011) even though — a PRE-EXISTING gap, not
 * introduced by this pass — this component has never threaded the shell
 * `variant` into `<PostCard>` (every post here always renders the visually
 * "full" action row regardless of session type; `ThreadView.test.tsx` also
 * never wraps a `ShellContextProvider`, so adding that here is a separate,
 * threads-replies-owned fix, not this integration's seam).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { usePersonas, type Persona } from '@/features/personas'
import { PostCard, type ParticipantPostView, type PostView } from '@/features/social'
import { useThread, type ThreadReplyView } from '../hooks/useThread'
import { useReaction } from '../hooks/useReaction'
import { useAmplify } from '../hooks/useAmplify'
import { QuoteComposer } from './QuoteComposer'
import styles from './ThreadView.module.css'

export interface ThreadViewProps {
  /** The post id the thread is centered on. */
  readonly focusedPostId: string
  /** Opens the tapped hashtag's feed (SOC-040); the shell channel supplies
   * it. Omitted in isolation — hashtags stay inert links. */
  readonly onHashtagOpen?: (tag: string) => void
}

interface ThreadCardProps {
  readonly view: PostView
  readonly onHashtagOpen?: (tag: string) => void
}

/**
 * One thread post, wired with its OWN like/repost/quote state — the
 * Wave-S3.1 analog of `Feed.tsx`'s `FeedRow` (see module header). Not
 * memoized: unlike the feed's burst surface, a thread's post set is small and
 * static once resolved, so the `React.memo` guarantee isn't needed here.
 */
function ThreadCard({ view, onHashtagOpen }: ThreadCardProps) {
  const reaction = useReaction({ postId: view.id, initialLikeCount: view.counts.like })
  const amplify = useAmplify({ postId: view.id })
  const [quoting, setQuoting] = useState(false)

  const displayView: PostView = useMemo(
    () => ({ ...view, counts: { ...view.counts, like: reaction.likeCount } }),
    [view, reaction.likeCount],
  )

  const handleQuoteSubmit = (commentary: string) => {
    amplify.doQuote(commentary)
    setQuoting(false)
  }

  return (
    <>
      <PostCard
        post={displayView}
        likedByViewer={reaction.likedByViewer}
        onLike={reaction.canReact ? reaction.toggleLike : undefined}
        onRepost={amplify.canAmplify ? amplify.doRepost : undefined}
        onQuote={amplify.canAmplify ? () => setQuoting(true) : undefined}
        onHashtagOpen={onHashtagOpen}
      />
      {quoting && (
        <QuoteComposer
          authorName={view.author.displayName}
          onSubmit={handleQuoteSubmit}
          onCancel={() => setQuoting(false)}
        />
      )}
    </>
  )
}

/** Builds the `PostView` `<PostCard>` renders from a participant-safe post
 * view + its resolved author, or `undefined` if the author can't be resolved
 * yet (e.g. personas still loading) — the caller skips rendering that post
 * rather than passing `<PostCard>` an incomplete author. */
function toPostView(
  view: ParticipantPostView,
  personaMap: ReadonlyMap<string, Persona>,
): PostView | undefined {
  const author = personaMap.get(view.authorPersonaId)
  if (!author) return undefined
  return {
    id: view.id,
    author,
    text: view.text,
    media: view.media,
    linkPreview: view.linkPreview,
    counts: view.counts,
    scenarioTime: view.scenarioTime,
  }
}

export function ThreadView({ focusedPostId, onHashtagOpen }: ThreadViewProps) {
  const { ancestors, focused, replies, loading, error } = useThread(focusedPostId)
  const { personas } = usePersonas()
  const session = useSession()
  const { exerciseId, timeZone } = useExerciseContext()

  const personaMap = useMemo(
    () => new Map(personas.map(persona => [persona.id, persona])),
    [personas],
  )

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

  if (loading) {
    return (
      <section className={styles.thread} data-testid="thread-view" aria-label="Thread">
        <p className={styles.status}>Loading thread…</p>
      </section>
    )
  }

  if (error || !focused) {
    return (
      <section className={styles.thread} data-testid="thread-view" aria-label="Thread">
        <p className={styles.status}>Unable to load this thread.</p>
      </section>
    )
  }

  const focusedView = toPostView(focused, personaMap)

  return (
    <section className={styles.thread} data-testid="thread-view" aria-label="Thread">
      {ancestors.map(ancestor => {
        const view = toPostView(ancestor, personaMap)
        return view
          ? <ThreadCard key={view.id} view={view} onHashtagOpen={onHashtagOpen} />
          : null
      })}

      {focusedView && (
        <div className={styles.focusedWrap} data-testid="thread-focused">
          <ThreadCard view={focusedView} onHashtagOpen={onHashtagOpen} />
        </div>
      )}

      {replies.map(reply => (
        <ThreadReply
          key={reply.id}
          reply={reply}
          personaMap={personaMap}
          onHashtagOpen={onHashtagOpen}
        />
      ))}
    </section>
  )
}

interface ThreadReplyProps {
  readonly reply: ThreadReplyView
  readonly personaMap: ReadonlyMap<string, Persona>
  readonly onHashtagOpen?: (tag: string) => void
}

/** One reply row: the "Replying to @handle" label, then either the reply's
 * `<PostCard>` (via `ThreadCard`, wired with its own like/repost/quote state)
 * or - if it was taken down (SOC-005/D1-009) - the interim in-thread
 * tombstone (which never gets that wiring — there is nothing to react to). */
function ThreadReply({ reply, personaMap, onHashtagOpen }: ThreadReplyProps) {
  const repliedToAuthor = personaMap.get(reply.replyToPersonaId)
  const view = toPostView(reply, personaMap)

  return (
    <div className={styles.replyGroup} data-testid="thread-reply">
      {repliedToAuthor && (
        <p className={styles.replyingTo}>{`Replying to @${repliedToAuthor.handle}`}</p>
      )}
      {reply.status === 'taken-down' ? (
        // INTERIM tombstone - `<Tombstone>` (posts/05) does not exist yet.
        // Replace this element with the real component once it lands.
        <div className={styles.tombstone} data-testid="thread-tombstone">
          This post is unavailable.
        </div>
      ) : (
        view && <ThreadCard view={view} onHashtagOpen={onHashtagOpen} />
      )}
    </div>
  )
}
