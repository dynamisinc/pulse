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

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(PHONE_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE_QUERY).matches
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
