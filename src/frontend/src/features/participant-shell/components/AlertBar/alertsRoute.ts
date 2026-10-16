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

/** Path of the alerts view the alert bar's "Details →" link opens. */
export const ALERTS_PATH = '/alerts'
