/**
 * features/social/components/QuotePostCard.tsx
 * ---------------------------------------------------------------------------
 * The amplification presentation (feature: amplification, story 01 — "Repost &
 * quote-post"; SOC-020, SOC-003, COR-053, D1-011, NFR-004, NFR-001). Renders an
 * amplified post the two X/Twitter ways, chosen by whether `commentary` is
 * present:
 *
 *   - REPOST (no commentary): a muted "🔁 {amplifier} reposted" attribution
 *     byline above the ORIGINAL post, which is rendered through the keystone
 *     `<PostCard>` verbatim (reuse, not a re-style) — so a reposted post reads
 *     exactly like any other feed post, just with the attribution line. This is
 *     the SOC-020 "attributed 'X reposted'" affordance.
 *
 *   - QUOTE (commentary present): the amplifier's own post — avatar, name,
 *     verified mark, handle, "·", relative scenario time, then the commentary —
 *     with the ORIGINAL rendered as an EMBEDDED, bordered card beneath it (its
 *     own author line + text). Quote-posting is the misinformation-mutation
 *     vector (SOC-020/E8), so the commentary is the emphasized content and the
 *     original is the quoted context.
 *
 * PURE PRESENTATIONAL. Like `<PostCard>`, this takes participant-safe views as
 * props and renders them; it does NOT fetch, write, or emit telemetry (that is
 * `services/amplify.ts`'s job) and carries NO provenance field to leak (XC-002).
 *
 * SCENARIO TIME (COR-053): every timestamp — the amplifier's AND the embedded
 * original's — renders via one `useScenarioTime()` snapshot bound to
 * `useExerciseContext().timeZone`, so the whole card agrees and never shows
 * wall-clock. This satisfies the cross-cutting "scenario-time on the quoted
 * embed" AC directly.
 *
 * OBSERVER MODE (COR-015 / D1-011): `variant` threads through to the reposted
 * `<PostCard>`, so in a read-only session the reposted post's interactive
 * controls are ABSENT (not disabled) — the same guarantee `<PostCard>` gives.
 * The quote form renders no interactive controls of its own.
 *
 * CONTENT SECURITY (NFR-004): commentary + original text render as plain React
 * text children — never `dangerouslySetInnerHTML` — so any stored script-like
 * string renders inert/escaped by construction (defense-in-depth on top of the
 * `amplify.quotePost` ingest sanitize).
 *
 * World: participant (Pulse skin). No COBRA, no themed MUI — plain semantic
 * elements with inline styles (mirrors `<Avatar>`, which is deliberately
 * self-contained and CSS-Module-free) — but NOT palette-independent: both
 * root elements below carry `social.module.css`'s shared `.tokens` class (the
 * token-only slice `<PostCard>`'s own root composes), so every inline style
 * that reads a `var(--pc-*)` custom property resolves to the SAME light/
 * dark-mode palette `<PostCard>` uses, rather than a second, hand-copied hex
 * palette that can drift out of sync (the Gate-1 finding this fixes). This
 * component does NOT itself use the per-exercise `--pc-accent`/`--pulse-ac`
 * token — nothing here renders an accent-colored element (the repost icon and
 * every text run use the ink/muted/line/panel tokens only); the `.tokens`
 * class still declares `--pc-accent` (composed from `<PostCard>`'s single
 * definition), it simply goes unread here today. FontAwesome icons only.
 */

import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRetweet } from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime, type UseScenarioTimeResult } from '@/core/clock'
import { Avatar } from './Avatar'
import { VerifiedMark } from './VerifiedMark'
import { PostCard, type PostView } from './PostCard'
import tokens from '../theme/social.module.css'

export interface QuotePostCardProps {
  /** The persona doing the amplifying (the reposter / quoter). */
  amplifier: Persona
  /** The original post being amplified, as a participant-safe view. */
  original: PostView
  /** Scenario-time ISO instant of the amplification action (COR-053). */
  scenarioTime: string
  /**
   * The quoter's commentary. PRESENT ⇒ quote-post (embeds the original);
   * ABSENT ⇒ plain repost (attributes "X reposted" above the original). Should
   * already be sanitized upstream by `amplify.quotePost` (NFR-004); it renders
   * as inert text here regardless.
   */
  commentary?: string
  /** `'readOnly'` = observer session (COR-015/D1-011): reposted controls absent. */
  variant?: 'full' | 'readOnly'
  /** Fires when the ORIGINAL post's card body is activated (parity with `<PostCard>`). */
  onOpen?: (id: string) => void
}

/* -------------------------------------------------------------------------- */
/* Skin tokens — CSS custom-property reads, NOT hardcoded hex (Gate-1 fix).    */
/* The fallback after the comma is `social.module.css`'s LIGHT_PALETTE value,  */
/* used only if `.tokens` is somehow absent from the DOM ancestry; in normal   */
/* use both root elements below carry `tokens.tokens`, so these always read   */
/* the SAME light/dark-mode-aware values `<PostCard>` renders with.           */
/* -------------------------------------------------------------------------- */
const INK = 'var(--pc-ink, #0e1518)'
const INK_MUTED = 'var(--pc-ink-muted, #61707a)'
const LINE = 'var(--pc-line, #e5e8ea)'
const PANEL = 'var(--pc-panel, #f3f5f6)'
const FONT = "'Figtree', system-ui, sans-serif"

export function QuotePostCard({
  amplifier,
  original,
  scenarioTime,
  commentary,
  variant = 'full',
  onOpen,
}: QuotePostCardProps) {
  const { timeZone } = useExerciseContext()
  const scenario = useScenarioTime(timeZone)

  // Absence of commentary is the sole discriminator between the two modes.
  const isQuote = commentary !== undefined

  if (!isQuote) {
    return (
      <div
        data-testid="quote-post-card"
        data-amplification="repost"
        className={tokens.tokens}
        style={rootStyle}
      >
        <p data-testid="repost-attribution" style={attributionStyle}>
          <FontAwesomeIcon icon={faRetweet} aria-hidden="true" />
          <span>{`${amplifier.displayName} reposted`}</span>
        </p>
        <PostCard post={original} variant={variant} {...(onOpen ? { onOpen } : {})} />
      </div>
    )
  }

  const relativeTime = scenario.format(scenarioTime, { format: 'relative' })
  const absoluteTime = scenario.format(scenarioTime, { format: 'absolute' })

  return (
    <article
      data-testid="quote-post-card"
      data-amplification="quote"
      className={tokens.tokens}
      style={{ ...rootStyle, ...quoteArticleStyle }}
    >
      <div style={{ flex: 'none' }}>
        <Avatar persona={amplifier} />
      </div>
      <div style={contentStyle}>
        <header style={headerStyle}>
          <span style={nameStyle}>{amplifier.displayName}</span>
          {amplifier.verified && (
            <span style={{ flex: 'none', alignSelf: 'center' }}>
              <VerifiedMark />
            </span>
          )}
          <span style={mutedStyle}>{`@${amplifier.handle}`}</span>
          <span style={mutedStyle} aria-hidden="true">·</span>
          <time dateTime={scenarioTime} title={absoluteTime} style={mutedStyle}>
            {relativeTime}
          </time>
        </header>

        <p data-testid="quote-commentary" style={commentaryStyle}>{commentary}</p>

        <QuotedEmbed original={original} scenario={scenario} />
      </div>
    </article>
  )
}

interface QuotedEmbedProps {
  original: PostView
  scenario: UseScenarioTimeResult
}

/**
 * The embedded original inside a quote-post: a compact, bordered card with the
 * original author's identity line + text. It renders NO action row (an X quote
 * embed has none) and, like the outer card, renders every timestamp in scenario
 * time (COR-053).
 */
function QuotedEmbed({ original, scenario }: QuotedEmbedProps) {
  const relativeTime = scenario.format(original.scenarioTime, { format: 'relative' })
  const absoluteTime = scenario.format(original.scenarioTime, { format: 'absolute' })

  return (
    <div
      data-testid="quoted-embed"
      role="group"
      aria-label={`Quoted post by ${original.author.displayName}`}
      style={embedStyle}
    >
      <header style={embedHeaderStyle}>
        <Avatar persona={original.author} size={20} />
        <span style={embedNameStyle}>{original.author.displayName}</span>
        {original.author.verified && (
          <span style={{ flex: 'none', alignSelf: 'center' }}>
            <VerifiedMark />
          </span>
        )}
        <span style={embedMutedStyle}>{`@${original.author.handle}`}</span>
        <span style={embedMutedStyle} aria-hidden="true">·</span>
        <time dateTime={original.scenarioTime} title={absoluteTime} style={embedMutedStyle}>
          {relativeTime}
        </time>
      </header>
      <p style={embedTextStyle}>{original.text}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Inline style objects (participant skin; no COBRA / MUI).                    */
/* -------------------------------------------------------------------------- */

const rootStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 600,
  fontFamily: FONT,
  textAlign: 'left',
  background: 'var(--pc-bg, #fff)',
  color: INK,
}

const attributionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  padding: '6px 16px 0 56px',
  color: INK_MUTED,
  fontSize: 13,
  fontWeight: 600,
}

const quoteArticleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `1px solid ${LINE}`,
}

const contentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  flex: '1 1 auto',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  gap: '4px 6px',
  minWidth: 0,
}

const nameStyle: CSSProperties = {
  maxWidth: '100%',
  overflow: 'hidden',
  color: INK,
  fontSize: 15,
  fontWeight: 700,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const mutedStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 14,
}

const commentaryStyle: CSSProperties = {
  margin: 0,
  overflowWrap: 'break-word',
  color: INK,
  fontSize: 15,
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
}

const embedStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 4,
  padding: '8px 12px',
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  background: PANEL,
}

const embedHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  gap: '2px 6px',
  minWidth: 0,
}

const embedNameStyle: CSSProperties = {
  overflow: 'hidden',
  color: INK,
  fontSize: 14,
  fontWeight: 700,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const embedMutedStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 13,
}

const embedTextStyle: CSSProperties = {
  margin: 0,
  overflowWrap: 'break-word',
  color: INK,
  fontSize: 14,
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
}
