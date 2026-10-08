/**
 * features/controller/components/PersonaContextPanel.tsx
 * ---------------------------------------------------------------------------
 * The in-composer persona-context panel (feature: persona-operation, story
 * 03 "Composer shows persona context while writing"; CTL-003, COR-020,
 * SOC-054, D5-014/2.4; reworked by demo-polish C4,
 * docs/features/demo-polish/20-console-cleanup.md). Staff world (COBRA) — dense
 * reference panel meant to sit beside the composer (`persona-operation/01`),
 * never inside it.
 *
 * So a persona stays in character across controllers, this panel shows:
 *   - a "POSTING AS {category}" chip (D5-014/2.4, wrong-persona defense),
 *     text-carrying the signal (NFR-001), derived from `persona.personaType`;
 *   - the persona's BIO, straight off the server persona (`persona.bio`);
 *   - voice/personality notes (COR-020), resolved via `personaVoice`'s
 *     `resolveVoiceNotes` — voiceNotes lives on the TEMPLATE, never the
 *     instance directly (see that module's header for the full grounding
 *     correction). A persona with no authored voice notes reads "No voice notes
 *     authored" in a muted style — a normal state in a live exercise, not an
 *     error;
 *   - the audience-magnitude band (SOC-054), read straight off the instance
 *     (`persona.audienceBand`) — never recomputed here;
 *   - up to `maxRecents` (default 3) of this persona's RECENT POSTS, read from
 *     the LIVE EXERCISE FEED (`resolveFeed('all', { includeReplies: true })`),
 *     filtered to posts this persona authored — replies included, so a persona
 *     that has only been replying still shows its voice.
 *
 * ## Recent posts come from the real feed, not a fixture (demo-polish C4)
 * This used to read `listPosts()` — the seeded Fairhaven fixture — which showed
 * "No recent posts" for any persona the presenter had actually been posting as.
 * The read now goes through the feed seam every other surface uses
 * (`feedService.resolveFeed`: mock adapter in dev, `GET /api/feed` live). It
 * takes NO exercise id: the session binds the exercise and the server scopes the
 * query (COR-001). The fixture-era client guard is kept as defence in depth —
 * a post that DOES carry an `exerciseId` different from the persona's is dropped.
 * The feed is read once per persona (and on remount); posts the controller
 * publishes afterwards are merged in from the shared `postStore`, so the panel
 * is current right after posting.
 *
 * `actionsSlot` is the one place a sibling story mounts an action next to the
 * persona (persona-edit's "Edit persona" button, wired by the console route).
 * The panel itself adds no controls: it is read-only reference that never
 * obstructs the fire path.
 *
 * INPUT, NOT IMPORT (Wave-1 parallel-build contract): `persona` arrives as a
 * plain prop from `persona-operation/02`'s `useActivePersona()`, wired by the
 * console route. This module does not import the picker or the composer, and
 * does not publish anything itself.
 *
 * Recents render scenario time only (COR-053), via `formatScenarioTime` +
 * `useExerciseContext()`'s configured `timeZone` — never wall-clock, even
 * though this is a staff surface (a dual-time clock belongs on the console
 * chrome, not on a historical post's own dateline).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAddressCard,
  faClockRotateLeft,
  faIdBadge,
  faQuoteLeft,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { formatScenarioTime } from '@/core/clock'
import type { Post } from '@/features/social'
import { resolveFeed, type FeedScope } from '@/features/social/services/feedService'
import { postStore } from '@/features/social/services/postStore'
import type { Persona, StaffPersona } from '@/features/personas'
import { audienceBandLabel, categoryChipLabel, resolveVoiceNotes } from '../services/personaVoice'

export interface PersonaContextPanelProps {
  /** The active persona to show context for (input, not import — supplied
   * by `persona-operation/02`'s `useActivePersona()` at integration). STAFF
   * projection: this panel renders the `personaType`-derived category chip,
   * and that field exists only on `StaffPersona` (SOC-052/D1-008), so a
   * participant-shaped `Persona` cannot be passed here. */
  readonly persona: StaffPersona
  /** Max recent posts to show. Defaults to 3 — enough in-voice grounding
   * without turning the panel into a feed. */
  readonly maxRecents?: number
  /** Where a sibling story mounts an action for the active persona (e.g.
   * persona-edit's "Edit persona" button — wired by the console route, which
   * owns that composition). Rendered beside the category chip; absent = nothing
   * is rendered. The panel adds no controls of its own. */
  readonly actionsSlot?: ReactNode
}

const DEFAULT_MAX_RECENTS = 3

/**
 * Secondary text for an honest "nothing here" state — muted, never alarming.
 * NOT `staffShellTokens.accent.secondaryText` (#848482, ~3.75:1 on white): that fails WCAG AA
 * for 12px text. #6b6b69 is ~5.4:1. Retuning the shared token is a separate staff-shell decision.
 */
const MUTED_NOTE_COLOR = '#6b6b69'
const MUTED_NOTE_SX = {
  fontSize: 12,
  color: MUTED_NOTE_COLOR,
  fontStyle: 'italic',
}

const SECTION_LABEL_SX = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '.12em',
  color: '#4a4f55',
  textTransform: 'uppercase' as const,
}

/**
 * The frozen F0 feed-read seam (demo-polish implementation.md §1.11):
 * `resolveFeed(scope, { includeReplies })`. Typed structurally so this compiles
 * both before and after that signature lands in `feedService` — a function with
 * fewer parameters is assignable to this type, so until then the options argument
 * is simply ignored at runtime (top-level posts only; the pre-F0 feed has no
 * replies to include). Once `feedService` carries the options parameter the
 * local type can go and the call can pass the options directly.
 */
type ResolveFeedWithOptions = (
  scope: FeedScope,
  options: { includeReplies: boolean },
) => Promise<Post[]>

/**
 * The live exercise feed WITH replies. `resolveFeed` is looked up at CALL time
 * (not captured into a module-level constant), so a spy or a replaced export is
 * honoured.
 */
function readFeed(): Promise<Post[]> {
  const resolve: ResolveFeedWithOptions = resolveFeed
  return resolve('all', { includeReplies: true })
}

/**
 * This persona's most recent posts from `posts`: authored by `persona` (replies
 * included — the feed read passes `includeReplies`), newest-first by scenario
 * time, capped at `maxRecents`. Pure over its inputs.
 *
 * The feed is already scoped to the session's exercise server-side (COR-001);
 * a post that nevertheless carries a DIFFERENT `exerciseId` than the persona's
 * (the mock/fixture shape) is dropped as defence in depth. The live wire omits
 * `exerciseId`, which is why an absent one is accepted.
 */
// Typed on the two identity fields it reads, so any persona shape (and the
// effect's primitive deps below) can feed it without a cast.
function selectRecentPosts(
  posts: readonly Post[],
  persona: Pick<Persona, 'id' | 'exerciseId'>,
  maxRecents: number,
): Post[] {
  return posts
    .filter(post => {
      const postExerciseId: string | undefined = post.exerciseId
      if (postExerciseId !== undefined && postExerciseId !== persona.exerciseId) return false
      return post.authorPersonaId === persona.id
    })
    // `Date.parse` on an ISO instant (not a wall-clock read) — matches
    // `feedService`'s newest-first comparator and avoids per-item Date objects.
    .sort((a, b) => Date.parse(b.scenarioTime) - Date.parse(a.scenarioTime))
    .slice(0, maxRecents)
}

type FeedRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly posts: readonly Post[] }

type RecentsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly posts: readonly Post[] }

/**
 * Reads the exercise feed (with replies) and narrows it to `persona`'s recent
 * posts. Re-reads whenever the persona changes; a stale response for a previous
 * persona is discarded. A failed read is its own state — never rendered as
 * "no posts yet", which would be a false statement about the persona.
 *
 * STAYS CURRENT AFTER POSTING. The feed read is a snapshot, but the controller
 * publishes AS this persona with this panel open beside the composer — and the
 * console route appends every post it publishes to the shared `postStore`
 * (`onPublished`, in mock and live mode alike). So the hook also watches the
 * store and MERGES any post that appears in it after mount, de-duplicated by id
 * against the feed read. Merging (rather than re-reading) matters live: the
 * server publish is fire-and-forget, so an immediate re-read could miss the post
 * the controller just sent.
 */
function usePersonaRecentPosts(
  persona: Pick<Persona, 'id' | 'exerciseId'>,
  maxRecents: number,
): RecentsState {
  const [read, setRead] = useState<FeedRead>({ status: 'loading' })
  const [arrived, setArrived] = useState<readonly Post[]>([])
  const personaId = persona.id
  const personaExerciseId = persona.exerciseId

  useEffect(() => {
    let cancelled = false
    setRead({ status: 'loading' })
    setArrived([])
    // Posts already in the store at mount are the feed read's to supply; only
    // what lands afterwards is "new".
    const known = new Set(postStore.getPosts().map(post => post.id))
    const unsubscribe = postStore.subscribe(() => {
      if (cancelled) return
      setArrived(postStore.getPosts().filter(post => !known.has(post.id)))
    })
    readFeed()
      .then(posts => {
        if (!cancelled) setRead({ status: 'ready', posts })
      })
      .catch(() => {
        if (!cancelled) setRead({ status: 'error' })
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [personaId, personaExerciseId])

  return useMemo<RecentsState>(() => {
    if (read.status !== 'ready') return read
    const fed = new Set(read.posts.map(post => post.id))
    const merged = [...read.posts, ...arrived.filter(post => !fed.has(post.id))]
    // The selector takes just the two identity fields, so the effect's deps stay
    // primitives (no per-render object identity to re-run on).
    const identity = { id: personaId, exerciseId: personaExerciseId }
    return { status: 'ready', posts: selectRecentPosts(merged, identity, maxRecents) }
  }, [read, arrived, personaId, personaExerciseId, maxRecents])
}

/**
 * Read-only reference panel: the wrong-persona-defense category chip, the
 * persona's bio and voice notes, the audience-magnitude band, and a few recent
 * posts from the live feed. Updates whenever `persona` changes (a new prop value
 * on every re-render — recents re-read for the new persona), so switching the
 * active persona (`persona-operation/02`) refreshes this panel without a full
 * reload.
 */
export function PersonaContextPanel({
  persona,
  maxRecents = DEFAULT_MAX_RECENTS,
  actionsSlot,
}: PersonaContextPanelProps) {
  const { timeZone } = useExerciseContext()
  const voiceNotes = resolveVoiceNotes(persona)
  const bio = persona.bio?.trim()
  const recents = usePersonaRecentPosts(persona, maxRecents)

  return (
    <Box
      component="section"
      aria-label={`Persona context for ${persona.displayName}`}
      data-testid="persona-context-panel"
      sx={{
        bgcolor: '#fff',
        border: '1px solid #dcdcdc',
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <Stack sx={{ px: 2, py: 1.5, borderBottom: '1px solid #dcdcdc', gap: 0.5 }}>
        <Typography sx={SECTION_LABEL_SX}>PERSONA CONTEXT</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Chip
            data-testid="persona-context-category-chip"
            icon={<FontAwesomeIcon icon={faIdBadge} style={{ fontSize: 11 }} />}
            label={`POSTING AS ${categoryChipLabel(persona.personaType)}`}
            size="small"
            sx={{
              alignSelf: 'flex-start',
              fontWeight: 800,
              fontSize: 10.5,
              letterSpacing: '.06em',
              borderRadius: '999px',
              border: '1px solid #1e3a5f',
              bgcolor: '#eaf1f9',
              color: '#1e3a5f',
              '& .MuiChip-icon': { color: '#1e3a5f', ml: '6px' },
            }}
          />
          {actionsSlot ? (
            <Box data-testid="persona-context-actions" sx={{ flex: 'none' }}>
              {actionsSlot}
            </Box>
          ) : null}
        </Stack>
      </Stack>

      <Stack sx={{ px: 2, py: 1.5, gap: 0.75, borderBottom: '1px solid #eceff2' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faAddressCard} style={{ fontSize: 11, color: '#848482' }} />
          <Typography sx={SECTION_LABEL_SX}>BIO</Typography>
        </Stack>
        {bio ? (
          <Typography
            data-testid="persona-context-bio"
            sx={{ fontSize: 12.5, color: '#1a1a1a', lineHeight: 1.5 }}
          >
            {bio}
          </Typography>
        ) : (
          <Typography data-testid="persona-context-bio" sx={MUTED_NOTE_SX}>
            No bio on this persona.
          </Typography>
        )}
      </Stack>

      <Stack sx={{ px: 2, py: 1.5, gap: 0.75, borderBottom: '1px solid #eceff2' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faQuoteLeft} style={{ fontSize: 11, color: '#848482' }} />
          <Typography sx={SECTION_LABEL_SX}>VOICE NOTES</Typography>
        </Stack>
        {voiceNotes ? (
          <Typography
            data-testid="persona-context-voice-notes"
            sx={{ fontSize: 12.5, color: '#1a1a1a', lineHeight: 1.5 }}
          >
            {voiceNotes}
          </Typography>
        ) : (
          // Not an error: a persona authored without a voice-notes template is a
          // normal state. Muted (secondary) like the other empty states, and the
          // words say what is true — nothing has been authored.
          <Typography data-testid="persona-context-voice-notes" sx={MUTED_NOTE_SX}>
            No voice notes authored
          </Typography>
        )}
      </Stack>

      <Stack sx={{ px: 2, py: 1.5, gap: 0.75, borderBottom: '1px solid #eceff2' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faUsers} style={{ fontSize: 11, color: '#848482' }} />
          <Typography sx={SECTION_LABEL_SX}>AUDIENCE MAGNITUDE</Typography>
        </Stack>
        <Typography data-testid="persona-context-audience-band" sx={{ fontSize: 12.5, color: '#1a1a1a' }}>
          {audienceBandLabel(persona.audienceBand)}
        </Typography>
      </Stack>

      <Stack sx={{ px: 2, py: 1.5, gap: 0.75 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faClockRotateLeft} style={{ fontSize: 11, color: '#848482' }} />
          <Typography sx={SECTION_LABEL_SX}>RECENT POSTS</Typography>
        </Stack>
        {recents.status === 'loading' && (
          <Typography data-testid="persona-context-recents-loading" sx={MUTED_NOTE_SX}>
            Loading recent posts…
          </Typography>
        )}
        {recents.status === 'error' && (
          // A failed read is NOT "no posts yet" — say what actually happened.
          <Typography data-testid="persona-context-recents-error" sx={MUTED_NOTE_SX}>
            Recent posts could not be loaded.
          </Typography>
        )}
        {recents.status === 'ready' && recents.posts.length === 0 && (
          <Typography data-testid="persona-context-recents-empty" sx={MUTED_NOTE_SX}>
            No recent posts from this persona in this exercise yet.
          </Typography>
        )}
        {recents.status === 'ready' && recents.posts.length > 0 && (
          <Stack
            component="ul"
            data-testid="persona-context-recents"
            sx={{ listStyle: 'none', p: 0, m: 0, gap: 1 }}
          >
            {recents.posts.map(post => (
              <Box component="li" key={post.id} sx={{ borderLeft: '3px solid #dbe9fa', pl: 1 }}>
                <Typography sx={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.4 }}>{post.text}</Typography>
                <Typography sx={{ fontSize: 10.5, color: '#848482', mt: 0.25 }}>
                  {formatScenarioTime(post.scenarioTime, timeZone, { format: 'relative' })}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
