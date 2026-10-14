/**
 * features/controller/liveWorld/LiveWorldRow.tsx
 * ---------------------------------------------------------------------------
 * One dense row of the console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md; CTL-030, NFR-001, COR-053).
 * STAFF world: a tight, hairline-separated row on the COBRA paper surface with
 * MONOSPACED metadata. It shows participant CONTENT but is built from staff parts
 * only — it is not, and must never import, `PostCard` or any participant post
 * component / `social.module.css` (the two-worlds guard test enforces that).
 *
 *   line 1  display name · @handle · VERIFIED (icon + text) ........ scenario time
 *   line 2  "↳ replying to @x"            (only on a reply)
 *   line 3  the post text (plain text, React-escaped; never HTML)
 *   line 4  compact media thumbnails       (only when the post has media)
 *   line 5  reply · repost · like · share counts ........ Reply as… [row actions]
 *
 * SCENARIO TIME (COR-053). The timestamp is `formatScenarioTime` in the
 * exercise's zone; its tooltip names the raw SCENARIO instant. No wall-clock is
 * rendered anywhere in the row.
 *
 * VERIFIED is shown as an icon AND the word VERIFIED (never colour alone,
 * NFR-001). An unverified account shows nothing, exactly as the fiction does — so
 * a lookalike is only distinguishable by the mark's absence (SOC-052).
 *
 * COUNTS read through `formatMagnitude` (the shared compact formatter) for the
 * eye and `spokenMagnitude` for assistive technology: the visible figure is
 * `aria-hidden` and a visually-hidden "1.4 thousand likes" is read instead, so
 * a screen reader never hears "1.4K" mangled. `share` is optional (the server
 * never sends it): when the post doesn't report it there is NO share cell — a
 * number is never invented.
 *
 * UNKNOWN AUTHOR. A controller must see every post. When the author is not in
 * the persona directory the row still renders, named "UNKNOWN AUTHOR · <short id>"
 * (no handle line, no VERIFIED) — see `toLiveWorldPost`.
 *
 * REMOVED (`isRowRemoved`). A taken-down post stays listed "for the record": a
 * REMOVED marker (icon AND word, never colour alone) joins the author line,
 * "Reply as…" is disabled and described by a visually-hidden explanation
 * (`aria-describedby`), and the column's `R` shortcut is a no-op on the row. The
 * row actions slot is still rendered (C5's own action shows its own state).
 *
 * KEYBOARD. The row is a roving-tabindex stop (`active` ⇒ tabIndex 0, others -1);
 * `J`/`K`/`R` are handled by the column on the list container. The row's own
 * controls — "Reply as…" and whatever `renderRowActions` returns — are ordinary
 * Tab stops. The accessible name is the author line (`aria-labelledby`) and the
 * post text is the description, so arriving on a row reads who said what.
 *
 * PERFORMANCE. The row is `memo`'d on its props: `entry`/`persona` keep their
 * identity while a post is unchanged, so an insert elsewhere in the list does
 * not re-render it (NFR-002 / SOC-071). The caller should pass a stable `onReply`.
 */

import { memo, useId, useMemo, type ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faCircleCheck,
  faComment,
  faHeart,
  faReply,
  faRetweet,
  faShare,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { formatScenarioTime } from '@/core/clock'
import { formatMagnitude, spokenMagnitude } from '@/features/social/services/audience'
import type { Persona } from '@/features/personas'
import { CobraLinkButton } from '@/theme/styledComponents'
import { LiveWorldMedia } from './LiveWorldMedia'
import { toLiveWorldPost, type LiveWorldEntry, type LiveWorldPost } from './liveWorldModel'
import { liveWorldTokens, monoMeta, srOnly } from './liveWorldStyles'

interface CountDef {
  readonly key: 'reply' | 'repost' | 'like' | 'share'
  readonly icon: IconDefinition
  readonly noun: string
}

/** Order everywhere in the product: reply, repost, like (R-002); share is optional. */
const COUNT_DEFS: readonly CountDef[] = [
  { key: 'reply', icon: faComment, noun: 'replies' },
  { key: 'repost', icon: faRetweet, noun: 'reposts' },
  { key: 'like', icon: faHeart, noun: 'likes' },
  { key: 'share', icon: faShare, noun: 'shares' },
]

export interface LiveWorldRowProps {
  readonly entry: LiveWorldEntry
  /** The author; `undefined` when the persona directory doesn't know them (UNKNOWN AUTHOR). */
  readonly persona: Persona | undefined
  /** The exercise's IANA zone for the scenario timestamp (COR-053). */
  readonly timeZone: string
  /** Whether this row is the roving-tabindex stop (tabIndex 0). */
  readonly active: boolean
  /** Called with the row's post when "Reply as…" is activated. */
  readonly onReply: (post: LiveWorldPost) => void
  /** Optional per-row action slot (C5 mounts Take down here). */
  readonly renderRowActions?: (post: LiveWorldPost) => ReactNode
  /**
   * Whether the post has been taken down. Called during render, so a caller whose
   * answer changes over time must pass a function with a NEW identity when it does
   * (rows are memoized on their props). A removed row stays listed "for the record"
   * with a REMOVED marker and a disabled Reply as….
   */
  readonly isRowRemoved?: (post: LiveWorldPost) => boolean
}

export const LiveWorldRow = memo(function LiveWorldRow({
  entry,
  persona,
  timeZone,
  active,
  onReply,
  renderRowActions,
  isRowRemoved,
}: LiveWorldRowProps) {
  const post = useMemo(() => toLiveWorldPost(entry.view, persona), [entry.view, persona])
  const when = useMemo(
    () => formatScenarioTime(post.scenarioTime, timeZone, { format: 'absolute' }),
    [post.scenarioTime, timeZone],
  )
  const metaId = useId()
  const bodyId = useId()
  const removedNoteId = useId()
  const isReply = post.inReplyTo !== undefined
  const removed = isRowRemoved?.(post) === true
  // Share is optional on the wire (the server never sends it): no cell when absent.
  const countDefs = COUNT_DEFS.filter(def => def.key !== 'share' || post.counts.share !== undefined)

  return (
    <Box
      component="article"
      data-live-world-row=""
      data-post-id={post.id}
      data-testid="live-world-row"
      data-kind={isReply ? 'reply' : 'post'}
      data-removed={removed ? 'true' : undefined}
      data-author-unknown={post.authorUnknown === true ? 'true' : undefined}
      tabIndex={active ? 0 : -1}
      aria-labelledby={metaId}
      aria-describedby={bodyId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        px: '10px',
        py: '7px',
        bgcolor: liveWorldTokens.surface,
        borderBottom: `1px solid ${liveWorldTokens.hairline}`,
        borderLeft: `3px solid ${isReply ? liveWorldTokens.panelBorder : 'transparent'}`,
        outline: 'none',
        '&:hover': { bgcolor: liveWorldTokens.surfaceHover },
        '&:focus-visible': {
          bgcolor: liveWorldTokens.surfaceHover,
          outline: `2px solid ${liveWorldTokens.focus}`,
          outlineOffset: '-2px',
        },
      }}
    >
      <Stack
        id={metaId}
        direction="row"
        sx={{ alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}
      >
        <Typography
          component="span"
          data-testid="live-world-author"
          sx={{ fontWeight: 700, fontSize: 12.5, color: liveWorldTokens.ink }}
        >
          {post.authorDisplayName}
        </Typography>
        {/* Real spaces between the inline parts: the flex container ignores them
            visually, but the accessible name ("Name @handle VERIFIED time") needs them. */}
        {' '}
        {post.authorUnknown !== true && (
          <Box component="span" sx={monoMeta}>
            @{post.authorHandle}
          </Box>
        )}
        {' '}
        {post.authorVerified && (
          <Box
            component="span"
            data-testid="live-world-verified"
            sx={{
              ...monoMeta,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: liveWorldTokens.focus,
            }}
          >
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
            VERIFIED
          </Box>
        )}
        {' '}
        {removed && (
          <Box
            component="span"
            data-testid="live-world-removed"
            sx={{
              ...monoMeta,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              px: '5px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: liveWorldTokens.ink,
              border: `1px solid ${liveWorldTokens.danger}`,
              borderRadius: '2px',
            }}
          >
            <Box component="span" sx={{ color: liveWorldTokens.danger, display: 'inline-flex' }}>
              <FontAwesomeIcon icon={faBan} aria-hidden="true" />
            </Box>
            REMOVED
          </Box>
        )}
        {' '}
        <Box sx={{ flex: 1 }} />
        <Box
          component="time"
          dateTime={post.scenarioTime}
          title={`Scenario time ${post.scenarioTime}`}
          data-testid="live-world-time"
          sx={{ ...monoMeta, whiteSpace: 'nowrap' }}
        >
          {when === '' ? '—' : when}
        </Box>
      </Stack>

      {post.inReplyTo !== undefined && (
        <Box component="span" data-testid="live-world-reply-marker" sx={monoMeta}>
          <span aria-hidden="true">↳ </span>
          replying to @{post.inReplyTo.authorHandle}
        </Box>
      )}

      <Typography
        id={bodyId}
        data-testid="live-world-text"
        sx={{
          fontSize: 13,
          lineHeight: 1.4,
          color: liveWorldTokens.ink,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {post.text}
      </Typography>

      {post.media !== undefined && <LiveWorldMedia media={post.media} />}

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack
          component="ul"
          direction="row"
          aria-label="Engagement"
          data-testid="live-world-counts"
          sx={{ gap: '12px', listStyle: 'none', m: 0, p: 0 }}
        >
          {countDefs.map(def => {
            const value = post.counts[def.key]
            if (value === undefined) return null // only `share` can be absent (filtered above)
            return (
              <Box
                component="li"
                key={def.key}
                data-testid={`live-world-count-${def.key}`}
                sx={{ ...monoMeta, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <FontAwesomeIcon icon={def.icon} aria-hidden="true" />
                <span aria-hidden="true">{formatMagnitude(value)}</span>
                <Box component="span" sx={srOnly}>
                  {`${spokenMagnitude(value)} ${def.noun}`}
                </Box>
              </Box>
            )
          })}
        </Stack>
        <Box sx={{ flex: 1 }} />
        {removed && (
          <Box component="span" id={removedNoteId} sx={srOnly}>
            This post was taken down. Replying to it is unavailable.
          </Box>
        )}
        <CobraLinkButton
          size="small"
          data-testid="live-world-reply-as"
          disabled={removed}
          aria-keyshortcuts={removed ? undefined : 'R'}
          aria-describedby={removed ? removedNoteId : undefined}
          aria-label={`Reply as… to ${post.authorDisplayName}`}
          title={removed ? 'Reply unavailable: this post was removed' : 'Reply as… (R)'}
          onClick={() => onReply(post)}
          sx={{
            minHeight: 0,
            minWidth: 0,
            px: '8px',
            py: '2px',
            borderRadius: '3px',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: liveWorldTokens.mono,
            gap: '5px',
          }}
        >
          <FontAwesomeIcon icon={faReply} aria-hidden="true" />
          Reply as…
        </CobraLinkButton>
        {renderRowActions?.(post)}
      </Stack>
    </Box>
  )
})
