/**
 * features/controller/engine/models/effectiveTimeoutAutoSend.ts
 * ---------------------------------------------------------------------------
 * THE one rule for "is timeout auto-send actually live right now?": the server says swamped
 * mode is ON **and** this deployment authorizes timeout auto-send
 * (`settings.timeoutAutoSendAuthorized === true`; absent/false is "not proven", so hold).
 * Both the console's `useDraftTimer` input (ControllerConsole -> DraftTimerDriver) and the
 * SwampedModeToggle banner use this, so the UI never claims ACTIVE while the server holds.
 * Pure, no React.
 */

/** The slice of the engine settings this rule reads. */
export interface TimeoutAutoSendSettings {
  readonly timeoutAutoSendAuthorized?: boolean
}

/** `swampedMode` is the server's flag (`settings.autonomy.swampedMode`). */
export function effectiveTimeoutAutoSend(
  swampedMode: boolean,
  settings: TimeoutAutoSendSettings | null | undefined,
): boolean {
  return swampedMode && settings?.timeoutAutoSendAuthorized === true
}

/** The slice of the settings the banner reads (all optional: older servers / fixtures). */
export interface TimeoutAutoSendBannerSettings extends TimeoutAutoSendSettings {
  readonly providerCutToFake?: boolean
  readonly autonomy?: {
    readonly generationStopped?: boolean
    readonly safetyClampActive?: boolean
    readonly degradedReason?: string | null
    readonly effectiveLevel?: string | null
  }
}

/**
 * What the swamped-mode banner should say. `active` ONLY when expiries would really publish;
 * every other state with swamped ON names why expiries HOLD instead. Precedence: a full stop,
 * then the Fake cut, then "not authorized", then degraded mode, then a kill-switch clamp, then
 * an effective autonomy level below Delayed-auto (e.g. the default lowered to Suggest).
 * (Scenario pause is not modelled by the timer/policy, so it is not a state here.)
 */
export type TimeoutAutoSendState =
  | 'off'
  | 'active'
  | 'stopped'
  | 'cut'
  | 'not-authorized'
  | 'degraded'
  | 'clamped'
  | 'autonomy-lowered'

export function timeoutAutoSendState(
  swampedMode: boolean,
  settings: TimeoutAutoSendBannerSettings | null | undefined,
): TimeoutAutoSendState {
  if (!swampedMode) return 'off'
  if (settings?.autonomy?.generationStopped === true) return 'stopped'
  if (settings?.providerCutToFake === true) return 'cut'
  if (settings?.timeoutAutoSendAuthorized !== true) return 'not-authorized'
  if (settings.autonomy?.degradedReason) return 'degraded'
  if (settings.autonomy?.safetyClampActive === true) return 'clamped'
  const level = settings.autonomy?.effectiveLevel
  if (level !== undefined && level !== null && level !== 'delayed-auto') return 'autonomy-lowered'
  return 'active'
}
