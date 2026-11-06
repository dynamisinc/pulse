/**
 * features/participant-shell/components/AlertBar/alertsRoute.ts
 * ---------------------------------------------------------------------------
 * The participant path of the alerts "Details" view (PRT-012).
 *
 * The SHELL owns this constant because the shell's alert bar is what links to
 * it; the mounted channel owns the route itself (it owns the participant
 * router — `features/social/layout/SocialRoutes.tsx` registers it and reserves
 * the `alerts` segment so it can never be read as a profile handle).
 */

import { isHostRelativePath } from '@/features/channels/contract/guards'

/** Path of the alerts view the alert bar's "Details →" link opens. */
export const ALERTS_PATH = '/alerts'

/**
 * Where "Details →" goes for an alert (channels-foundation story 11): straight
 * to its `href` when that is host-relative (its source item), else the alerts
 * history. A non-host-relative `href` never becomes the target (COR-008).
 */
export function alertDetailsTarget(href: string | null | undefined): string {
  return isHostRelativePath(href) ? href : ALERTS_PATH
}
