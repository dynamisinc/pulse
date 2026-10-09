/**
 * features/social/components/media/MediaFallbackTile.tsx
 * ---------------------------------------------------------------------------
 * The accessible alt-text placeholder (demo-polish F2). One tile that stands in
 * for a piece of media that cannot be shown, in exactly three situations:
 *
 *   1. the item has NO usable URL — a legacy `{ kind: 'image', alt }` entry from
 *      an old mock/post (back-compat), or a URL the safe-URL allow-list rejected
 *      (`javascript:`, `data:`, a plain-http host, ... — NFR-004);
 *   2. an `<img>` that failed to load (expired SAS, 404, blocked) — the
 *      "on-error tile showing the alt text" AC;
 *   3. a video the browser cannot be given at all (unsafe URL).
 *
 * It keeps the F0 placeholder contract: `role="img"` named by the alt text, with
 * the alt text ALSO visible, so a sighted user sees what the picture was meant to
 * be and a screen-reader user hears it once (the visible text is presentational
 * under `role="img"`). The icon is decorative (`aria-hidden`) and is paired with
 * the text, so the state is never colour-only (NFR-001).
 *
 * Not interactive on purpose: `pointer-events: none` (see the CSS) lets a tap on
 * the placeholder fall through to the card's open-the-thread overlay, which is
 * what tapping a dead image should do. It fills its nearest POSITIONED ancestor
 * (`position: absolute; inset: 0`) — the caller supplies the sized box.
 *
 * Participant world — plain elements + CSS Module, FontAwesome icon only.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faImage, faVideo } from '@fortawesome/free-solid-svg-icons'
import styles from './MediaFallbackTile.module.css'

export interface MediaFallbackTileProps {
  /** The media's alt text (the accessible name AND the visible text). */
  readonly alt: string
  /** Picks the icon only; the behaviour is identical. */
  readonly kind?: 'image' | 'video'
}

export function MediaFallbackTile({ alt, kind = 'image' }: MediaFallbackTileProps) {
  return (
    <div className={styles.tile} role="img" aria-label={alt} data-testid="media-fallback">
      <FontAwesomeIcon
        icon={kind === 'video' ? faVideo : faImage}
        className={styles.icon}
        aria-hidden="true"
      />
      <span className={styles.text}>{alt}</span>
    </div>
  )
}
