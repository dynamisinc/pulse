/**
 * features/controller/runSheet/PersonaLine.tsx
 * ---------------------------------------------------------------------------
 * A compact STAFF-side persona mark for the run sheet: a small avatar circle
 * (initials on the persona's own `avatarColor`) + display name + `@handle`, and
 * an optional "+N" for the rest of a burst. STAFF world.
 *
 * Deliberately NOT the participant `Avatar`/`PostCard` from `features/social`:
 * the run sheet is a machine surface and must never reuse a participant
 * component (two-worlds rule). The `@handle` is shown on purpose — a controller
 * scripting the pile-on must be able to tell the verified account from its
 * unverified lookalike (SOC-052) at a glance, and the handle is the difference.
 * The avatar is decoration (`aria-hidden`); the name carries the meaning.
 */

import { Box } from '@mui/material'
import type { Persona } from '@/features/personas'
import { consoleChrome as chrome } from '../consoleChrome'

export interface PersonaLineProps {
  /** The resolved persona, or `undefined` while personas load / when the id is unknown. */
  readonly persona: Pick<Persona, 'displayName' | 'handle' | 'initials' | 'avatarColor'> | undefined
  /** The post's persona id — shown only as a fallback when the persona can't be resolved. */
  readonly personaId: string
  /** Additional posts in a burst ("+N"), or 0/undefined for a single post. */
  readonly more?: number
}

export function PersonaLine({ persona, personaId, more = 0 }: PersonaLineProps) {
  const name = persona?.displayName ?? 'Unknown persona'
  return (
    <Box
      component="span"
      data-testid="persona-line"
      title={persona ? undefined : personaId}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
    >
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          flex: 'none',
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 800,
          color: chrome.ink,
          bgcolor: persona?.avatarColor ?? chrome.line,
          border: `1px solid ${chrome.line}`,
        }}
      >
        {persona?.initials ?? '?'}
      </Box>
      <Box
        component="span"
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        <Box component="span" sx={{ fontSize: 12, fontWeight: 700, color: chrome.ink }}>
          {name}
        </Box>
        {persona ? (
          <Box component="span" sx={{ fontSize: 11, color: chrome.inkMuted }}>
            {' '}
            @{persona.handle}
          </Box>
        ) : null}
      </Box>
      {more > 0 ? (
        <Box
          component="span"
          data-testid="burst-more"
          title={`and ${more} more post${more === 1 ? '' : 's'} in this burst`}
          sx={{ flex: 'none', fontSize: 11, fontWeight: 700, color: chrome.inkMuted }}
        >
          +{more}
        </Box>
      ) : null}
    </Box>
  )
}
