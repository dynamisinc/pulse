/**
 * features/portal/masthead/mastheadDateline.ts
 * ---------------------------------------------------------------------------
 * The masthead's dateline format (exercise-portal story 06, #771; COR-053):
 * "OCT 29, 2026 · 2:32 PM EDT", registered with F14's format registry from this
 * folder so `ScenarioDateline` is never forked. The format receives only F14's
 * pre-bound renderings of one scenario-time instant in the exercise zone, so it
 * cannot reach wall-clock time. It is not a skin token: the masthead's time
 * source and shape are on the CANNOT list.
 *
 * World: participant.
 */

import { registerDatelineFormat, type DatelineFormat } from '@/features/channels'

/** The registered name the masthead passes to `ScenarioDateline`. */
export const PORTAL_MASTHEAD_DATELINE_FORMAT = 'portal-masthead'

export const portalMastheadDateline: DatelineFormat = t => {
  const clock = [t.time(), t.zoneName()].filter(Boolean).join(' ')
  return [t.dateline(), clock].filter(Boolean).join(' · ')
}

registerDatelineFormat(PORTAL_MASTHEAD_DATELINE_FORMAT, portalMastheadDateline)
