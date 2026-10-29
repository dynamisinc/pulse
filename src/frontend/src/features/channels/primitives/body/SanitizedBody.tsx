/**
 * features/channels/primitives/body/SanitizedBody.tsx
 * ---------------------------------------------------------------------------
 * The ONE place a channel's `bodyHtml` reaches the DOM (channels-foundation 14; NFR-004,
 * FC-9 rule 6: no `dangerouslySetInnerHTML` / `innerHTML` anywhere else).
 *
 *  - One DOMPurify pass with the body allowlist (`sanitizeBody.ts`), memoized per body.
 *  - In-sim links (host-relative hrefs) route client-side through React Router, so a
 *    permalink in an article never reloads the page or leaves the exercise host; a
 *    modified click (ctrl / cmd / shift / middle) keeps the browser's own behaviour.
 *  - `<pulse-post data-id="…">` placeholders are filled by `renderEmbeddedPost(id)`
 *    through a portal, so E4 can embed a post in D1 anatomy and this module never
 *    imports Social. With no render prop the placeholder stays empty. Note for E4: React
 *    events from an embed bubble through the REACT tree (to this component's parent), not
 *    through the body `div`, so a card-level `onClick` above this sees embed clicks.
 *
 * Presentational only. Typography comes from skin CSS variables.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { INSIM_LINK_ATTR, PULSE_POST_TAG, sanitizeBodyHtml } from './sanitizeBody'
import styles from './SanitizedBody.module.css'

export interface SanitizedBodyProps {
  /** Server-sanitized body HTML (`ChannelContentDto.bodyHtml`). */
  readonly bodyHtml: string
  /** Renders an embedded Pulse post for a `<pulse-post data-id>` placeholder. */
  readonly renderEmbeddedPost?: (postId: string) => ReactNode
  readonly className?: string
}

interface EmbedTarget {
  readonly element: Element
  readonly postId: string
}

export function SanitizedBody({ bodyHtml, renderEmbeddedPost, className }: SanitizedBodyProps) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const html = useMemo(() => sanitizeBodyHtml(bodyHtml), [bodyHtml])
  const [embeds, setEmbeds] = useState<readonly EmbedTarget[]>([])

  // The sanitized HTML is written here, into a container React renders NO children into, so
  // a re-render can never reset it and wipe the embed portals mounted inside it (React's own
  // `dangerouslySetInnerHTML` would). The placeholders are collected from what was written.
  // Keyed on the HTML only: a new `renderEmbeddedPost` identity re-renders the portals but
  // never rewrites the body (which would drop focus and scroll anchoring inside it).
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    container.innerHTML = html
    wrapTablesForScroll(container)
    const found: EmbedTarget[] = []
    for (const element of container.querySelectorAll(`${PULSE_POST_TAG}[data-id]`)) {
      const postId = element.getAttribute('data-id')?.trim() ?? ''
      if (postId !== '') found.push({ element, postId })
    }
    setEmbeds(found)
  }, [html])

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!(event.target instanceof Element)) return
    const link = event.target.closest(`a[${INSIM_LINK_ATTR}]`)
    if (link === null || !event.currentTarget.contains(link)) return
    const href = link.getAttribute('href')
    if (href === null) return
    // Belt and braces beside the sanitizer's normalisation: only a same-origin target is
    // routed; anything else is left to the browser (and never handed to `navigate`).
    if (new URL(href, window.location.href).origin !== window.location.origin) return
    event.preventDefault()
    void navigate(href)
  }

  return (
    <>
      {/* The click handler only re-routes the links inside; the links stay keyboard-operable. */}
      <div
        ref={containerRef}
        className={className ? `${styles.body} ${className}` : styles.body}
        data-testid="sanitized-body"
        onClick={handleClick}
      />
      {renderEmbeddedPost !== undefined
        && embeds.map(({ element, postId }, index) => createPortal(
          renderEmbeddedPost(postId),
          element,
          `${postId}-${index}`,
        ))}
    </>
  )
}

/**
 * A wide table scrolls inside a focusable, named region rather than widening the page
 * (mobile-first). The table itself keeps `display: table`, so its semantics survive in
 * every screen reader, and the region is keyboard-scrollable (WCAG 2.1.1).
 */
function wrapTablesForScroll(container: HTMLElement): void {
  for (const table of container.querySelectorAll('table')) {
    const region = container.ownerDocument.createElement('div')
    region.className = styles.tableScroll ?? ''
    region.setAttribute('role', 'region')
    region.setAttribute('tabindex', '0')
    const caption = table.querySelector('caption')?.textContent?.trim()
    region.setAttribute('aria-label', caption ? `Table: ${caption}` : 'Table')
    table.replaceWith(region)
    region.appendChild(table)
  }
}
