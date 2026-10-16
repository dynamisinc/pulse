/**
 * features/social/notifications/useNotificationsEligibility.ts
 * ---------------------------------------------------------------------------
 * Who gets notifications (demo-polish F7, story 16; D1-011 / COR-015): one predicate, read
 * by BOTH the engine (which starts only for an eligible viewer) and the page (which sends
 * an ineligible one Home), so the bell, the badge and the route can never disagree.
 * Participant world -- a hook, no UI.
 *
 * ELIGIBLE = all of:
 *   - the shell mount grants interactive affordances (`affordancesAvailable(variant)`): a
 *     `readOnly` observer mount, a `kiosk` display and a staff `preview` stage get none;
 *   - the session is not read-only (a shared view-only credential, COR-015);
 *   - the session is bound to a persona (a persona-less session has no "my posts", so there
 *     is nothing to derive a notification FROM).
 *
 * Otherwise the answer is `unavailable`, and the whole feature is ABSENT -- no bell, no
 * count, and a visit to `/notifications` is redirected Home -- never present-but-inert
 * (D1-011 "absent, not disabled").
 *
 * A persona-bound, interactive session is `pending` until the channel's shared persona
 * directory has resolved the persona (the handle is needed to recognise `@mentions`), and
 * `failed` if the directory settled without it (the cast read failed): the page then says
 * notifications are not available right now instead of redirecting a real participant away
 * from a URL they typed.
 */

import { useSession } from '@/core/auth'
import { affordancesAvailable, useShellContext } from '@/features/participant-shell/mountContract'
import { useSocialDirectory } from '../layout/socialDirectory'

export type NotificationsEligibility =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed' }
  | {
    readonly kind: 'ready'
    readonly exerciseId: string
    readonly personaId: string
    /** The signed-in account: part of the storage key (see `notificationStorage`). */
    readonly accountId: string
    readonly handle: string
  }

export function useNotificationsEligibility(): NotificationsEligibility {
  const { variant } = useShellContext()
  const session = useSession()
  const { self, loading } = useSocialDirectory()

  if (!affordancesAvailable(variant) || session.isReadOnly || session.personaId === undefined || session.exerciseId === null) {
    return { kind: 'unavailable' }
  }
  if (self === undefined) return loading ? { kind: 'pending' } : { kind: 'failed' }
  return {
    kind: 'ready',
    exerciseId: session.exerciseId,
    personaId: session.personaId,
    accountId: session.accountId,
    handle: self.handle,
  }
}
