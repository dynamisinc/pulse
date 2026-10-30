/**
 * features/channels/primitives/dateline/updatedStamp.ts
 * ---------------------------------------------------------------------------
 * The client half of the FC-1 UPDATED STAMP RULE (news FU-1, D3-P4).
 *
 * The server decides when the stamp moves: `update`, `correction` and `silent_rewrite`
 * move `updatedScenarioTime`; `edit` and a `touchUpdatedStamp: false` revise do not.
 * The client therefore renders the stamp from `updatedScenarioTime` ALONE, and never
 * from `revisions[]`: a `silent_rewrite` moves the stamp with no revision entry, and the
 * participant must still see "Updated 14:32" (with no note).
 *
 * The one defensive check: a stamp that is not strictly after the publish instant (or is
 * unparseable) is not shown, so a backfilled or equal value never reads as an update.
 */

/** Whether the "Updated" stamp shows for this published / updated pair. */
export function shouldShowUpdatedStamp(
  publishedScenarioTime: string,
  updatedScenarioTime: string | null | undefined,
): boolean {
  if (updatedScenarioTime === null || updatedScenarioTime === undefined) return false
  const updated = Date.parse(updatedScenarioTime)
  if (!Number.isFinite(updated)) return false
  const published = Date.parse(publishedScenarioTime)
  // An unparseable publish instant cannot be compared: trust the server's stamp.
  return !Number.isFinite(published) || updated > published
}
