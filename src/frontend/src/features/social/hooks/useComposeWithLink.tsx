/**
 * features/social/hooks/useComposeWithLink.tsx
 * ---------------------------------------------------------------------------
 * "Share to Pulse" from another channel (channels-foundation 21, news FU-5, SOC-004):
 * opens the participant composer pre-filled with an IN-SIM permalink. Participant world.
 *
 *   const { openComposerWithLink, composer, isOpen } = useComposeWithLink()
 *   <button onClick={() => openComposerWithLink(article.permalink)}>Share</button>
 *   {composer}
 *
 * THE COMPOSER. `composer` is the Social channel's own `ComposeModal` (the nav rail's
 * "New post" dialog: focus in, focus trapped, Esc / Close / backdrop ask before dropping a
 * draft, focus back to the opener) with the permalink as its starting text, wrapped in the
 * Social brand scope and palette so it looks like Social wherever it is mounted. The host
 * renders it INSIDE its page, so it lives in the shell's content region and its stacking
 * context: it can never draw above the shell's overlay layer, banners or alert bar (D7).
 * `isOpen` lets the host mark its own content `inert` while the dialog is up, as
 * `SocialChannel` does.
 *
 * A NORMAL POST. Nothing about the publish is special: the dialog's composer is the normal
 * one (`useComposePost`), so the result is a normal `post` event and its link card is
 * resolved server-side through the foundation link-preview route. The dialog closes on a
 * successful post, like the nav rail's.
 *
 * THE PERMALINK MUST BE HOST-RELATIVE (FC-9.3, COR-008). Accepted: a path that starts with a
 * single `/`, with no whitespace or control characters. Rejected (the call returns `false`
 * and opens nothing): anything containing `://`, a protocol-relative `//host` or `/\host`,
 * and anything not starting with `/`.
 *
 * WHO MAY COMPOSE. The same predicate as the channel's Post button: a mount with
 * interactive affordances (`affordancesAvailable(variant)`), a writable session and a bound
 * persona. Otherwise (a read-only / observer session, a persona-less one) the call returns
 * `false` and opens nothing: there is no composer to open (COR-015 / D1-011).
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSession } from '@/core/auth'
import {
  affordancesAvailable,
  useShellContext,
} from '@/features/participant-shell/mountContract'
import { ComposeModal } from '../layout/ComposeModal'
import { SocialBrandScope } from '../theme/SocialBrandScope'
import styles from './useComposeWithLink.module.css'

export interface UseComposeWithLinkResult {
  /**
   * Opens the composer pre-filled with `permalink`. Returns `true` when it opened, `false`
   * when it did not (a rejected permalink, or a session that cannot post).
   */
  readonly openComposerWithLink: (permalink: string) => boolean
  /** The dialog while open, else `null`. Render it inside the host page. */
  readonly composer: ReactNode
  /** Whether the dialog is open (the host may mark its content `inert` meanwhile). */
  readonly isOpen: boolean
}

/** Whitespace, or an ASCII control character (C0 or DEL): a permalink is one clean path. */
function hasUnsafeCharacter(value: string): boolean {
  if (/\s/.test(value)) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Whether `permalink` is a host-relative in-sim path (see the module header). */
export function isHostRelativePermalink(permalink: string): boolean {
  if (typeof permalink !== 'string' || !permalink.startsWith('/')) return false
  if (permalink.startsWith('//') || permalink.startsWith('/\\')) return false
  if (permalink.includes('://')) return false
  return !hasUnsafeCharacter(permalink)
}

/** The compose-with-link seam. See the module header. */
export function useComposeWithLink(): UseComposeWithLinkResult {
  const { variant } = useShellContext()
  const session = useSession()
  const canCompose =
    affordancesAvailable(variant) && !session.isReadOnly && session.personaId !== undefined

  // The open draft's permalink; `undefined` = closed.
  const [permalink, setPermalink] = useState<string | undefined>(undefined)

  const openComposerWithLink = useCallback(
    (link: string): boolean => {
      if (!canCompose || !isHostRelativePermalink(link)) return false
      setPermalink(link)
      return true
    },
    [canCompose],
  )
  const close = useCallback(() => setPermalink(undefined), [])

  // A session that loses the right to post (switched to read-only) drops the dialog too.
  const open = canCompose && permalink !== undefined

  const composer = useMemo(
    () =>
      open ? (
        <SocialBrandScope>
          <div className={styles.palette} data-testid="compose-with-link">
            <ComposeModal onClose={close} initialText={permalink} />
          </div>
        </SocialBrandScope>
      ) : null,
    [open, close, permalink],
  )

  return { openComposerWithLink, composer, isOpen: open }
}
