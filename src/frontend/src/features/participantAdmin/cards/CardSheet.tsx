/**
 * features/participantAdmin/cards/CardSheet.tsx
 * ---------------------------------------------------------------------------
 * The printable sheet: every card, grouped into US Letter pages of eight (two columns by
 * four rows). Pure and props-only: no data fetching, no context. It is both the on-screen
 * preview body and the thing the browser prints, from the SAME markup, so the preview is
 * what comes out of the printer.
 *
 * WHY PAGE GROUPS, NOT ONE BIG GRID. Each group is one page: a fixed-height grid with a
 * forced page break after it. That makes "eight per page, a card never split" structural
 * rather than a hope pinned on how a browser fragments a grid. `break-inside: avoid` on
 * the card is the second guard. The CSS lives in `cardSheet.module.css` (read its header
 * for the print rules).
 *
 * Neutral by design (EL-15): no COBRA, no MUI, no brand skin.
 */

import { memo, useMemo } from 'react'
import { Card } from './Card'
import { paginate } from './cardFormat'
import styles from './cardSheet.module.css'
import type { RosterCardDto } from './types'

export interface CardSheetProps {
  cards: readonly RosterCardDto[]
  /** `RosterCardsDto.exerciseName`, printed on every card. */
  exerciseName: string
}

function CardSheetImpl({ cards, exerciseName }: CardSheetProps) {
  const pages = useMemo(() => paginate(cards), [cards])
  return (
    <div
      className={styles.sheet}
      data-testid="card-sheet"
      role="group"
      aria-label={`${cards.length} printable ${cards.length === 1 ? 'card' : 'cards'}`}
    >
      {pages.map((pageCards, pageIndex) => (
        <div
          key={pageIndex}
          className={styles.page}
          data-testid="card-sheet-page"
        >
          {pageCards.map(card => (
            <Card
              key={card.participantId}
              card={card}
              exerciseName={exerciseName}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export const CardSheet = memo(CardSheetImpl)
