/**
 * features/controller/components/PersonaContextPanel.tsx
 * ---------------------------------------------------------------------------
 * The in-composer persona-context panel (feature: persona-operation, story
 * 03 "Composer shows persona context while writing"; CTL-003, COR-020,
 * SOC-054, D5-014/2.4). Staff world (COBRA) — dense reference panel meant to
 * sit beside the composer (`persona-operation/01`), never inside it.
 *
 * So a persona stays in character across controllers, this panel shows:
 *   - voice/personality notes (COR-020), resolved via `personaVoice`'s
 *     `resolveVoiceNotes` — voiceNotes lives on the TEMPLATE, never the
 *     instance directly (see that module's header for the full grounding
 *     correction);
 *   - the audience-magnitude band (SOC-054), read straight off the instance
 *     (`persona.audienceBand`) — never recomputed here;
 *   - a "POSTING AS {category}" chip (D5-014/2.4, wrong-persona defense),
 *     text-carrying the signal (NFR-001), derived from `persona.personaType`;
 *   - a handful of this persona's recent posts, scoped to THIS exercise
 *     instance (COR-001) — filtered from `listPosts()` by both
 *     `exerciseId` and `authorPersonaId`, so a controller never sees another
 *     exercise's history for a same-template persona.
 *
 * INPUT, NOT IMPORT (Wave-1 parallel-build contract): `persona` arrives as a
 * plain prop from `persona-operation/02`'s `useActivePersona()`, wired at the
 * Wave-1 integration step. This module does not import the picker or the
 * composer, and does not publish anything itself — it is read-only reference
 * that never obstructs the fire path (no buttons, no edit affordances).
 *
 * Recents render scenario time only (COR-053), via `formatScenarioTime` +
 * `useExerciseContext()`'s configured `timeZone` — never wall-clock, even
 * though this is a staff surface (a dual-time clock belongs on the console
 * chrome, not on a historical post's own dateline).
 */

import { Box, Chip, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClockRotateLeft, faIdBadge, faQuoteLeft, faUsers } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { formatScenarioTime } from '@/core/clock'
import { listPosts, type Post } from '@/features/social'
import type { Persona } from '@/features/personas'
import { audienceBandLabel, categoryChipLabel, resolveVoiceNotes } from '../services/personaVoice'

export interface PersonaContextPanelProps {
  /** The active persona to show context for (input, not import — supplied
   * by `persona-operation/02`'s `useActivePersona()` at integration). */
  readonly persona: Persona
  /** Max recent posts to show. Defaults to 3 — enough in-voice grounding
   * without turning the panel into a feed. */
  readonly maxRecents?: number
}

const DEFAULT_MAX_RECENTS = 3

const SECTION_LABEL_SX = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '.12em',
  color: '#4a4f55',
  textTransform: 'uppercase' as const,
}

/**
 * This persona's most recent posts, scoped to its OWN exercise instance
 * (COR-001) — matched on both `exerciseId` and `authorPersonaId` so a
 * controller never sees another exercise's history for a same-template
 * persona. Newest-first, capped at `maxRecents`.
 */
function recentPostsFor(persona: Persona, maxRecents: number): Post[] {
  return listPosts()
    .filter(post => post.exerciseId === persona.exerciseId && post.authorPersonaId === persona.id)
    // `Date.parse` on an ISO instant (not a wall-clock read) — matches
    // `feedService`'s newest-first comparator and avoids per-item Date objects.
    .sort((a, b) => Date.parse(b.scenarioTime) - Date.parse(a.scenarioTime))
    .slice(0, maxRecents)
}

/**
 * Read-only reference panel: persona voice notes, audience-magnitude band,
 * the wrong-persona-defense category chip, and a few scoped recent posts.
 * Updates whenever `persona` changes (a new prop value on every re-render —
 * no internal caching), so switching the active persona
 * (`persona-operation/02`) refreshes this panel without a full reload.
 */
export function PersonaContextPanel({
  persona,
  maxRecents = DEFAULT_MAX_RECENTS,
}: PersonaContextPanelProps) {
  const { timeZone } = useExerciseContext()
  const voiceNotes = resolveVoiceNotes(persona)
  const recents = recentPostsFor(persona, maxRecents)

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
      </Stack>

      <Stack sx={{ px: 2, py: 1.5, gap: 0.75, borderBottom: '1px solid #eceff2' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faQuoteLeft} style={{ fontSize: 11, color: '#848482' }} />
          <Typography sx={SECTION_LABEL_SX}>VOICE NOTES</Typography>
        </Stack>
        <Typography
          data-testid="persona-context-voice-notes"
          sx={{ fontSize: 12.5, color: '#1a1a1a', lineHeight: 1.5 }}
        >
          {voiceNotes ?? 'Voice notes unavailable for this persona’s template.'}
        </Typography>
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
        {recents.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: '#848482', fontStyle: 'italic' }}>
            No recent posts from this persona in this exercise yet.
          </Typography>
        ) : (
          <Stack
            component="ul"
            data-testid="persona-context-recents"
            sx={{ listStyle: 'none', p: 0, m: 0, gap: 1 }}
          >
            {recents.map(post => (
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
