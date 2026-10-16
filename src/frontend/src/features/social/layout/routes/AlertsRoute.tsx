/**
 * features/social/layout/routes/AlertsRoute.tsx
 * ---------------------------------------------------------------------------
 * The `/alerts` route (PRT-012): the target of the shell alert bar's
 * "Details →" link.
 *
 * The participant channel owns the participant router, so it hosts the view;
 * the SHELL owns the content (`AlertsHistory` — every active alert with its
 * severity chip, full message, and scenario time). This route only adds the
 * channel's standard detail frame: the sticky back header (`DetailHeader`),
 * whose Back returns to wherever the participant tapped "Details" from (or
 * Home on a cold deep link).
 *
 * `alerts` is a reserved segment (`socialNavigation.ts`), so the path can
 * never be read as a profile handle — before this route existed it fell
 * through to `/:handle` and rendered "This account doesn't exist".
 */

import { AlertsHistory } from '@/features/participant-shell/components/AlertBar/AlertsHistory'
import { DetailHeader } from '../DetailHeader'

export function AlertsRoute() {
  return (
    <div data-testid="social-alerts-region">
      <DetailHeader />
      <AlertsHistory />
    </div>
  )
}
