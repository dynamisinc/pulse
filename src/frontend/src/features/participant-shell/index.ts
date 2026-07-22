/**
 * features/participant-shell — public barrel.
 * ---------------------------------------------------------------------------
 * New as of exercise-isolation/04 (Phase B2, Wave 4): exports the participant
 * landing route guard so `app-shell/01` (role-aware nav) can compose it via
 * `import { ParticipantLandingGuard } from '@/features/participant-shell'`
 * without reaching past this barrel into the file it lives in.
 *
 * The rest of this feature's modules (`ShellLayout`, `BrandThemeProvider`,
 * `mountContract`, `shellState`, `chromeConfig`, `channelNavConfig`, the
 * `components/*` layers) predate this barrel and are still imported by their
 * own deep paths at every existing call site (see `App.tsx`,
 * `features/social/SocialChannel.tsx`). This barrel is deliberately scoped to
 * this story's export today; it is expected to grow as later stories adopt it
 * rather than being back-filled wholesale here.
 */

export { ParticipantLandingGuard, PARTICIPANT_FAIL_CLOSED_REDIRECT } from './ParticipantLandingGuard'
export type { ParticipantLandingGuardProps } from './ParticipantLandingGuard'

export { useLandingSelection, resolveLandingSelection, LandingSelectionProvider } from './landingSelection'
export type { LandingSelection, LandingSelectionProviderProps } from './landingSelection'
