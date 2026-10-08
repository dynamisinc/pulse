/**
 * features/social/components/post/PostBody.tsx
 * ---------------------------------------------------------------------------
 * The post text block, with hashtags linkified (SOC-040). One of the decomposed
 * `<PostCard>` parts (demo-polish F0). FROZEN after F0 (implementation.md §4.3).
 * Participant world — plain semantic elements + `PostBody.module.css`.
 *
 * CONTENT SECURITY (NFR-004): `text` renders as plain React text children —
 * never `dangerouslySetInnerHTML` — so a stored script-like string renders
 * inert/escaped by construction. Plain text segments are returned as strings;
 * only the recognized hashtags become elements.
 *
 * A recognized hashtag renders one of two ways depending on whether a
 * hashtag-open handler is actually wired (WR-002, NFR-001):
 *  - wired ⇒ an accent-styled, keyboard-focusable `role="link"` anchor carrying
 *    the normalized tag in `data-hashtag`, firing `onHashtagOpen` with that tag on
 *    click/Enter/Space (and stopping propagation, so a hashtag tap never also
 *    opens the post's thread);
 *  - NOT wired (e.g. `Profile`, which renders cards without `onHashtagOpen`) ⇒ an
 *    INERT, non-focusable `<span>` — still accent-colored with its leading "#" so
 *    it visibly reads as a tag, but carrying no role/tabIndex/handler, so it can
 *    never be a focusable no-op.
 *
 * Accent color + the leading `#` glyph together mark a hashtag as a tag WITHOUT
 * relying on color alone (NFR-001); `role="link"` (wired variant) is the third
 * signal. The accent is the per-exercise `--pc-accent` declared on the card root
 * (COR-030), set inline so this part needs no extra CSS-module class.
 *
 * STACKING: `HASHTAG_LINK_STYLE` lifts the INTERACTIVE anchor above the card's
 * open-region overlay button (`z-index: 2` vs `.openTarget`'s `1` in
 * `PostCard.module.css`) — required so the anchor and the overlay stay SIBLINGS
 * (WR-001) rather than one nesting the other, while the hashtag remains
 * independently clickable/focusable on top.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { parseHashtags } from '../../utils/hashtags'
import styles from './PostBody.module.css'

const OPEN_KEYS = new Set(['Enter', ' ', 'Spacebar'])

const HASHTAG_LINK_STYLE = { color: 'var(--pc-accent)', position: 'relative', zIndex: 2 } as const
const HASHTAG_TEXT_STYLE = { color: 'var(--pc-accent)' } as const

/**
 * A hashtag tap/keyboard-activation must NOT also open the post's thread (the
 * card body's `onOpen`), so it always stops propagation — only rendered (see
 * {@link renderPostText}) when `onHashtagOpen` is actually wired, so `tag`'s
 * handler is always defined here.
 */
function handleHashtagClick(tag: string, onHashtagOpen: (tag: string) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    onHashtagOpen(tag)
  }
}

/** Same stop-propagation guarantee as {@link handleHashtagClick}, on Enter/Space. */
function handleHashtagKeyDown(tag: string, onHashtagOpen: (tag: string) => void) {
  return (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (!OPEN_KEYS.has(event.key)) return
    event.stopPropagation()
    event.preventDefault()
    onHashtagOpen(tag)
  }
}

/** Renders post text with hashtags linkified (see the module header). */
function renderPostText(
  text: string,
  onHashtagOpen: ((tag: string) => void) | undefined,
): ReactNode {
  return parseHashtags(text).map((token, index) => {
    if (token.type === 'text') return token.value

    if (!onHashtagOpen) {
      return (
        <span key={`hashtag-${index}`} data-hashtag={token.tag} style={HASHTAG_TEXT_STYLE}>
          {token.raw}
        </span>
      )
    }

    return (
      <a
        key={`hashtag-${index}`}
        role="link"
        tabIndex={0}
        data-hashtag={token.tag}
        style={HASHTAG_LINK_STYLE}
        onClick={handleHashtagClick(token.tag, onHashtagOpen)}
        onKeyDown={handleHashtagKeyDown(token.tag, onHashtagOpen)}
      >
        {token.raw}
      </a>
    )
  })
}

export interface PostBodyProps {
  readonly text: string
  /** Fires with the normalized tag (no leading '#'); omit and hashtags are inert spans. */
  readonly onHashtagOpen?: (tag: string) => void
}

export function PostBody({ text, onHashtagOpen }: PostBodyProps) {
  return <p className={styles.text}>{renderPostText(text, onHashtagOpen)}</p>
}
