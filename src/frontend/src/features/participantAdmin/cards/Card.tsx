/**
 * features/participantAdmin/cards/Card.tsx
 * ---------------------------------------------------------------------------
 * ONE printed card (easy-login story 12). Pure and props-only: no data fetching, no
 * context, no clock. It is the paper handed to a participant at StartEx, so it belongs
 * to NEITHER world (EL-15): not COBRA (no `@/theme/*`, no MUI) and not an in-fiction
 * brand. Plain semantic HTML, styled by `cardSheet.module.css` in black on white.
 *
 * WHAT A CARD SHOWS (story 12 AC3)
 *   - the exercise name and a "Training exercise" line;
 *   - the person's NAME, large (`<h3>`, so a screen-reader user can jump card to card);
 *   - "agency · role" when either is present;
 *   - the QR, an `<img>` of the server's `qrSvgDataUri`, at least 1.25 in square, with
 *     `alt="QR code: sign in as {name}"`;
 *   - "Sign-in name: jsmith" in a monospace face;
 *   - "Today's word:" and a blank writing line (the server never re-shows the word, so
 *     the slot is empty on purpose; staff write or sticker the announced word);
 *   - the full link as small monospace text (plain text, deliberately NOT an `<a>`: a
 *     bearer link should not be one stray click away on screen);
 *   - one help line whose `{site}` is the origin of the card's own `joinUrl`.
 *
 * SECURITY. The QR `src` passes through `resolveSafeQrDataUri` (a base64 SVG data URI and
 * nothing else) before it reaches the DOM; anything else renders a text placeholder and
 * the rest of the card (link, sign-in name) still works. The SVG is only ever an
 * `<img src>`, never injected as markup, so it cannot run script. Names and agencies are
 * rendered as text nodes (they were sanitized at ingest; React escapes them again).
 * `loading="lazy"` is deliberately NOT used: a lazy image below the fold may not have
 * loaded when the user presses Print.
 *
 * ACCESSIBILITY. Nothing depends on colour: it is black on white, the training status is
 * a text line, the writing slot is a labelled line. The blank slot carries visually
 * hidden text so a screen-reader user hears that a blank is intended.
 */

import { memo } from 'react'
import { LONG_NAME_LENGTH, XLONG_NAME_LENGTH, affiliationLine, joinUrlOrigin } from './cardFormat'
import { resolveSafeQrDataUri } from './safeQrDataUri'
import styles from './cardSheet.module.css'
import type { RosterCardDto } from './types'

export interface CardProps {
  card: RosterCardDto
  /** `RosterCardsDto.exerciseName`. */
  exerciseName: string
}

/** The name's class: the large face, stepping down for a long and then a very long name. */
function nameClassName(name: string): string {
  if (name.length > XLONG_NAME_LENGTH) return `${styles.name} ${styles.nameXLong}`
  if (name.length > LONG_NAME_LENGTH) return `${styles.name} ${styles.nameLong}`
  return styles.name ?? ''
}

function CardImpl({ card, exerciseName }: CardProps) {
  const affiliation = affiliationLine(card.agency, card.role)
  const qrSrc = resolveSafeQrDataUri(card.qrSvgDataUri)
  const site = joinUrlOrigin(card.joinUrl)
  const nameClass = nameClassName(card.name)

  return (
    <article className={styles.card} data-testid="roster-card">
      <header className={styles.cardHeader}>
        <p className={styles.exercise}>{exerciseName}</p>
        <p className={styles.training}>Training exercise</p>
      </header>

      <div className={styles.cardBody}>
        {qrSrc !== undefined
          ? (
            <img
              className={styles.qr}
              src={qrSrc}
              alt={`QR code: sign in as ${card.name}`}
              decoding="async"
              draggable={false}
            />
          )
          : (
            <p className={styles.qrMissing} data-testid="roster-card-qr-missing">
              QR code unavailable. Use the link or the sign-in name.
            </p>
          )}

        <div className={styles.who}>
          <h3 className={nameClass}>{card.name}</h3>
          {affiliation !== undefined && <p className={styles.affiliation}>{affiliation}</p>}
          <p className={styles.field}>
            <span className={styles.label}>Sign-in name:</span>{' '}
            <code className={styles.signIn}>{card.signInName}</code>
          </p>
          <p className={styles.word}>
            <span className={styles.label}>Today&apos;s word:</span>
            <span className={styles.writeLine} data-testid="roster-card-word-line" />
            <span className={styles.srOnly}>(blank: write today&apos;s word here)</span>
          </p>
        </div>
      </div>

      <footer className={styles.cardFooter}>
        <p className={styles.link} data-testid="roster-card-link">{card.joinUrl}</p>
        <p className={styles.help} data-testid="roster-card-help">
          Scan with your phone&apos;s camera. No QR?{' '}
          {site !== undefined
            ? <>Open <span className={styles.site}>{site}/login</span></>
            : <>Open the sign-in page</>}
          {' '}and enter your sign-in name and today&apos;s word.
        </p>
      </footer>
    </article>
  )
}

/** Memoized: re-rendering the preview shell never re-renders 100 cards. */
export const Card = memo(CardImpl)
