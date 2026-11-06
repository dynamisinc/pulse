/**
 * features/weather/components/product/ProductText.tsx
 * ---------------------------------------------------------------------------
 * The monospace NWS product text (weather-source story 07, #758; WX-010,
 * D4-009, D4-010). The furniture is assembled from structured data; nothing is
 * stored with it:
 *
 *   ...Tornado Warning for northern Kestrel County until 3:15 PM...
 *
 *   At 2:40 PM, a severe thunderstorm capable of producing a tornado …
 *
 *   PRECAUTIONARY/PREPAREDNESS ACTIONS...
 *
 *   Take shelter now in a basement or an interior room.
 *
 *   &&
 *
 *   $$
 *
 *  - The headline is rendered EXACTLY as stored: no CSS text-transform, no
 *    truncation, no ellipsis. Copy/paste of the line equals the alert and the
 *    `@WeatherDesk` post text (D4-010).
 *  - `white-space: pre-wrap` keeps authored line breaks; `overflow-wrap:
 *    anywhere` wraps a long unbroken run instead of scrolling sideways. There
 *    is no length cap here (a per-kind cap is a planned F04 follow-on).
 *  - The narrative (`bodyHtml`) is server-cleaned PLAIN text for weather, so it
 *    renders as a React text node (escaped), never as HTML.
 *  - The actions section appears only when there are actions; `&&` closes the
 *    body and `$$` ends the product either way.
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import type { WeatherProductProjection } from '@/features/weather/contract'
import styles from './ProductText.module.css'

/** The NWS section header that introduces `actions`. */
export const PRECAUTIONARY_HEADER = 'PRECAUTIONARY/PREPAREDNESS ACTIONS...'
/** Closes the body. */
export const BODY_TERMINATOR = '&&'
/** Ends the product. */
export const PRODUCT_TERMINATOR = '$$'

/** What `ProductText` reads: a `WeatherProductDto` satisfies it. */
export interface ProductTextSubject {
  readonly headline: string
  readonly bodyHtml: string
  readonly payload: Pick<WeatherProductProjection, 'actions'>
}

export interface ProductTextProps {
  readonly product: ProductTextSubject
  readonly className?: string
}

/** A blank line between blocks, as NWS products separate their paragraphs. */
const GAP = '\n\n'

export function ProductText({ product, className }: ProductTextProps) {
  const narrative = product.bodyHtml.trim()
  const actions = product.payload.actions.filter(action => action.trim() !== '')

  return (
    <div className={[styles.text, className].filter(Boolean).join(' ')} data-testid="weather-product-text">
      <span data-testid="weather-product-headline-line">
        ...<span data-testid="weather-product-headline">{product.headline}</span>...
      </span>
      {narrative !== '' && (
        <>
          {GAP}
          <span data-testid="weather-product-narrative">{narrative}</span>
        </>
      )}
      {actions.length > 0 && (
        <>
          {GAP}
          <span>{PRECAUTIONARY_HEADER}</span>
          {actions.map((action, index) => (
            // Actions are an ordered list of strings that may repeat: the index is the identity.
            <span key={index}>
              {GAP}
              <span data-testid="weather-product-action">{action}</span>
            </span>
          ))}
        </>
      )}
      {GAP}
      <span>{BODY_TERMINATOR}</span>
      {GAP}
      <span>{PRODUCT_TERMINATOR}</span>
    </div>
  )
}
