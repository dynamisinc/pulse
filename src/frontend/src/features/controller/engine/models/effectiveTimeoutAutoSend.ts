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
