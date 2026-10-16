/**
 * features/social/layout/usePhoneLayout.ts
 * ---------------------------------------------------------------------------
 * Whether the viewport is phone-width (`PHONE_QUERY`, mobile-tablet story 02). The social
 * frame uses it to choose ONE primary navigation to put in the DOM: the bottom tab bar on a
 * phone, the left rail otherwise. Rendering exactly one keeps a single "Primary" landmark
 * (no duplicate landmarks for assistive tech) and lets focus return to the visible Post
 * control. The CSS in `SocialChannel.module.css` keys off the same query, so layout and
 * markup cannot disagree.
 *
 * Where `matchMedia` does not exist (jsdom, SSR) this is `false`, i.e. the rail, so every
 * pre-existing test sees the unchanged desktop frame.
 *
 * World: participant. A hook, no UI.
 */

import { useSyncExternalStore } from 'react'
import { PHONE_QUERY } from './frameMetrics'

/**
 * The MediaQueryList is created ONCE (lazily) and reused by `subscribe` and `getSnapshot`
 * (SG-001), not rebuilt on every snapshot read. Keyed on the `matchMedia` function so a test
 * that swaps `window.matchMedia` gets a fresh list.
 */
let cached: { factory: typeof window.matchMedia, list: MediaQueryList } | undefined

function phoneList(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  if (cached === undefined || cached.factory !== window.matchMedia) {
    cached = { factory: window.matchMedia, list: window.matchMedia(PHONE_QUERY) }
  }
  return cached.list
}

function subscribe(onChange: () => void): () => void {
  const list = phoneList()
  if (list === undefined) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return phoneList()?.matches ?? false
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
