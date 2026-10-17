/**
 * features/pwa/install/installEnv.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 11. Pure(ish) environment helpers for the install prompt: platform
 * detection, standalone detection and per-exercise persisted state. No React, no telemetry
 * (MT-D5: install/dismiss emit NO XC-004 events).
 *
 * iOS HEURISTIC (best-effort, documented per the story): Safari on iOS/iPadOS has no
 * `beforeinstallprompt`, so we detect it by user agent: iPhone/iPad/iPod, or an "iPad that
 * reports as a Mac" (UA "Macintosh" with touch points), AND not a known third-party iOS browser
 * shell (CriOS/FxiOS/EdgiOS/OPiOS/GSA) or an in-app webview (no "Safari/" token). It can be
 * wrong; the cost of a wrong guess is an instruction sheet the user can dismiss.
 *
 * PERSISTENCE: localStorage keys include the `exerciseId` so a dismissal / visit count never
 * carries to another exercise (XC-001/002). All storage access is try/catch (private mode,
 * disabled storage): failure degrades to "not dismissed, in-memory only".
 */

const PREFIX = 'pulse:pwa:'
export const IOS_VISIT_THRESHOLD = 2

export const dismissKey = (exerciseId: string) => `${PREFIX}install-dismissed:${exerciseId}`
export const visitsKey = (exerciseId: string) => `${PREFIX}visits:${exerciseId}`
const visitCountedKey = (exerciseId: string) => `${PREFIX}visit-counted:${exerciseId}`

export type InstallPlatform = 'ios-safari' | 'other'

export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  const iosDevice =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  if (!iosDevice) return 'other'
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent)) return 'other'
  if (!/Safari\//.test(userAgent)) return 'other' // in-app webview
  return 'ios-safari'
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean
}

/** Running as an installed app (display-mode standalone, or iOS home-screen launch). */
export function isStandalone(win: Window = window): boolean {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    /* ignore */
  }
  return (win.navigator as StandaloneNavigator).standalone === true
}

export function isDismissed(exerciseId: string, store: Storage | undefined = safeLocal()): boolean {
  try {
    return store?.getItem(dismissKey(exerciseId)) === '1'
  } catch {
    return false
  }
}

export function markDismissed(exerciseId: string, store: Storage | undefined = safeLocal()): void {
  try {
    store?.setItem(dismissKey(exerciseId), '1')
  } catch {
    /* ignore */
  }
}

/**
 * Counts this exercise's visits: +1 per browser tab session (guarded by sessionStorage so
 * re-renders and route changes do not inflate it). Returns the running total.
 */
export function recordVisit(
  exerciseId: string,
  local: Storage | undefined = safeLocal(),
  session: Storage | undefined = safeSession(),
): number {
  try {
    const current = Number.parseInt(local?.getItem(visitsKey(exerciseId)) ?? '0', 10) || 0
    if (session?.getItem(visitCountedKey(exerciseId)) === '1') return current
    const next = current + 1
    local?.setItem(visitsKey(exerciseId), String(next))
    session?.setItem(visitCountedKey(exerciseId), '1')
    return next
  } catch {
    return 0
  }
}

function safeLocal(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function safeSession(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}
