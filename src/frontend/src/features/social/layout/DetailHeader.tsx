/**
 * features/social/layout/DetailHeader.tsx
 * ---------------------------------------------------------------------------
 * The sticky header on a DETAIL route (thread, profile, hashtag feed): an icon
 * Back button and, optionally, the page's `<h1>` title (demo-polish F1).
 *
 * BACK is the adapter's `back()` -- the previous in-channel entry when there is
 * one, otherwise a replace to Home -- so it never leaves the app. It replaces the
 * old "Back to feed" button, which was only ever right when the previous page WAS
 * the feed; with real URLs the previous page can be Explore, another profile, a
 * hashtag. The accessible name is just "Back".
 *
 * TITLE. Pass `title` when the page below has no heading of its own (the thread
 * view has none): it renders as the route's `<h1>`, which is where focus lands on
 * a route change. Profile and hashtag pages already render their own `<h1>`, so
 * they pass nothing and this renders only the button -- one `<h1>` per route.
 *
 * The header sticks below the shell's compliance banner (`--pulse-chrome-top`).
 *
 * World: participant. CSS Module + FontAwesome only -- no COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { useSocialNavigate } from './socialNavigation'
import styles from './DetailHeader.module.css'

export interface DetailHeaderProps {
  /** The route's `<h1>`, when the page below does not render one. */
  title?: string
}

export function DetailHeader({ title }: DetailHeaderProps) {
  const { back } = useSocialNavigate()

  return (
    <header className={styles.header} data-testid="detail-header">
      <button type="button" className={styles.back} aria-label="Back" onClick={() => back()}>
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
      </button>
      {title !== undefined && <h1 className={styles.title}>{title}</h1>}
    </header>
  )
}
