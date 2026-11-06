/**
 * features/news/masthead/SectionNav.tsx
 * ---------------------------------------------------------------------------
 * The outlet's category nav (story 03, NWS-003, D3-P1 slot 2): "Home" plus each
 * of `outlet.categories` in configured order. The current entry carries
 * `aria-current="page"` and is marked by weight AND underline, never colour
 * alone (NFR-001).
 *
 * Mobile-first: below 768px the list collapses behind a "Sections" disclosure
 * button (`aria-expanded` / `aria-controls`; Escape closes it and returns
 * focus); from 768px the list is always shown as a row (one row at ≥1024px
 * within the 1140px well). On a coarse pointer every target is ≥44px.
 *
 * Props only, no fetching. Styled only by the skin's CSS custom properties
 * (`SkinScope`), so it must render inside an outlet skin scope.
 *
 * World: participant. No COBRA, no default MUI look; FontAwesome only.
 */

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'
import type { OutletDto } from '@/features/channels'
import { useCoarsePointer } from '@/core/hooks/useCoarsePointer'
import { usePrefersReducedMotion } from '@/core/hooks/usePrefersReducedMotion'
import { newsHomePath, newsSectionPath, type SectionNavCurrent } from './mastheadModel'
import styles from './SectionNav.module.css'

export interface SectionNavProps {
  /** The outlet (only `slug`, `name` and `categories` are read). */
  readonly outlet: Pick<OutletDto, 'slug' | 'name' | 'categories'>
  /** The current page's entry; omit on an article page (no entry is current). */
  readonly current?: SectionNavCurrent
}

interface NavEntry {
  readonly key: string
  readonly label: string
  readonly href: string
  readonly isCurrent: boolean
}

function navEntries(
  outlet: SectionNavProps['outlet'],
  current: SectionNavCurrent | undefined,
): NavEntry[] {
  const home: NavEntry = {
    key: 'home',
    label: 'Home',
    href: newsHomePath(outlet.slug),
    isCurrent: current?.kind === 'home',
  }
  const currentCategory = current?.kind === 'section' ? current.category.trim() : null
  const seen = new Set<string>()
  const sections: NavEntry[] = []
  for (const category of outlet.categories) {
    const label = category.trim()
    if (label === '' || seen.has(label)) continue
    seen.add(label)
    sections.push({
      key: `section:${label}`,
      label,
      href: newsSectionPath(outlet.slug, label),
      isCurrent: currentCategory === label,
    })
  }
  return [home, ...sections]
}

/** Whether the always-shown row layout (≥768px, see the stylesheet) applies. */
function isWideViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches
}

/** The outlet's section nav with a mobile "Sections" disclosure. */
export function SectionNav({ outlet, current }: SectionNavProps) {
  // The disclosure is open FOR one location, so ANY navigation (a nav link,
  // an article link, the back button) closes it without an effect.
  const location = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === location.key
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const coarse = useCoarsePointer()
  const reducedMotion = usePrefersReducedMotion()
  const entries = navEntries(outlet, current)

  const close = useCallback((returnFocus: boolean) => {
    setOpenAt(null)
    // From 768px the toggle is not displayed; focus stays where it is.
    if (returnFocus && !isWideViewport()) toggleRef.current?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      close(true)
    }
  }

  return (
    <nav
      className={styles.nav}
      aria-label={`${outlet.name} sections`}
      data-coarse={coarse ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      onKeyDown={onKeyDown}
    >
      <div className={styles.well}>
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpenAt(open ? null : location.key)}
        >
          <span>Sections</span>
          <FontAwesomeIcon icon={faChevronDown} className={styles.chevron} aria-hidden="true" />
        </button>
        {/* role="list": `list-style: none` drops list semantics in Safari/VoiceOver. */}
        <ul id={listId} role="list" className={styles.list} data-open={open ? 'true' : 'false'}>
          {entries.map(entry => (
            <li key={entry.key} className={styles.item}>
              <Link
                to={entry.href}
                className={styles.link}
                aria-current={entry.isCurrent ? 'page' : undefined}
                // Following the current entry stays on this page and hides the link
                // with the list, so focus goes back to the toggle.
                onClick={() => close(entry.isCurrent)}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
