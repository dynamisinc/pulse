/**
 * features/social/layout/routes/SocialRedirect.tsx
 * ---------------------------------------------------------------------------
 * An in-channel redirect: on mount, REPLACE the current location with `to` and
 * render nothing (demo-polish F1).
 *
 * It exists instead of React Router's `<Navigate>` because `<Navigate>` calls the
 * ROUTER's own `useNavigate()` -- real browser history -- and the channel must
 * only ever move through the navigation adapter (`useSocialNavigate`), so that
 * under the memory provider a redirect stays in memory too.
 *
 * It is a REPLACE, never a push: the redirecting URL (`/`, a typo, `/staff/console`)
 * must not sit in history where Back would land on it and bounce straight back.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useEffect } from 'react'
import { useSocialNavigate } from '../socialNavigation'

export interface SocialRedirectProps {
  /** Absolute in-channel path to land on. */
  to: string
}

export function SocialRedirect({ to }: SocialRedirectProps) {
  const { navigate } = useSocialNavigate()
  // A passive effect, NOT a layout effect: React Router's `navigate()` ignores calls
  // made before the component that called `useNavigate()` (the provider, our PARENT)
  // has run its own layout effect -- and children's layout effects run first -- so a
  // layout-effect redirect on the very first render would be silently dropped.
  useEffect(() => {
    navigate(to, { replace: true })
  }, [navigate, to])
  return null
}
