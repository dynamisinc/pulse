/**
 * features/channels/skin/report.ts
 * ---------------------------------------------------------------------------
 * Dev reporting for the skin system (story 13). A skin problem never breaks
 * the participant page: the system falls back (neutral skin, clamped colour,
 * dropped key) and reports the problem to the developer console, once per
 * distinct problem. Nothing here renders; a report is never reader-visible
 * (nothing breaks fiction).
 */

const reported = new Set<string>()

/**
 * Warns once per `id` in dev; silent in a production build unless `always`
 * (an unknown skin key is worth one production log line).
 */
export function reportSkinIssue(
  id: string,
  message: string,
  options: { always?: boolean } = {},
): void {
  if ((!import.meta.env.DEV && !options.always) || reported.has(id)) return
  reported.add(id)
  console.warn(`[skin] ${message}`)
}

/**
 * A registration mistake (a duplicate key, a bad token file, a cross-origin
 * font). Throws in dev so the channel author sees it at import time; logs and
 * carries on in production, where the registry keeps its previous state.
 */
export function skinDevError(message: string): void {
  if (import.meta.env.DEV) throw new Error(`[skin] ${message}`)
  console.error(`[skin] ${message}`)
}

/** Test-only: forget which problems were already reported. */
export function resetSkinReportsForTests(): void {
  reported.clear()
}
