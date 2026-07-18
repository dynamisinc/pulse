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
 */

import { useEffect, useMemo } from 'react'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { usePersonas, type Persona } from '@/features/personas'
import { PostCard, type ParticipantPostView, type PostView } from '@/features/social'
import { useThread, type ThreadReplyView } from '../hooks/useThread'
import styles from './ThreadView.module.css'

export interface ThreadViewProps {
  /** The post id the thread is centered on. */
  readonly focusedPostId: string
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

export function ThreadView({ focusedPostId }: ThreadViewProps) {
  const { ancestors, focused, replies, loading, error } = useThread(focusedPostId)
  const { personas } = usePersonas()
  const session = useSession()
  const { exerciseId, timeZone } = useExerciseContext()

  const personaMap = useMemo(
    () => new Map(personas.map(persona => [persona.id, persona])),
    [personas],
  )

  useEffect(() => {
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
    // Fires once per mounted thread, and again if the caller re-centers this
    // same component on a different post without remounting it.
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
        return view ? <PostCard key={view.id} post={view} /> : null
      })}

      {focusedView && (
        <div className={styles.focusedWrap} data-testid="thread-focused">
          <PostCard post={focusedView} />
        </div>
      )}

      {replies.map(reply => (
        <ThreadReply key={reply.id} reply={reply} personaMap={personaMap} />
      ))}
    </section>
  )
}

interface ThreadReplyProps {
  readonly reply: ThreadReplyView
  readonly personaMap: ReadonlyMap<string, Persona>
}

/** One reply row: the "Replying to @handle" label, then either the reply's
 * `<PostCard>` or - if it was taken down (SOC-005/D1-009) - the interim
 * in-thread tombstone. */
function ThreadReply({ reply, personaMap }: ThreadReplyProps) {
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
        view && <PostCard post={view} />
      )}
    </div>
  )
}
