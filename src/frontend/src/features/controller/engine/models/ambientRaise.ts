/**
 * features/controller/engine/models/ambientRaise.ts
 * ---------------------------------------------------------------------------
 * Pure "is this save a RAISE?" rule for the ambient policy (SG-6). STAFF world.
 * Mirrors the backend rule `AmbientPolicyRaise.IsRaise`: a save needs the
 * deliberate confirm step when it makes MORE ambient output post without review.
 *
 * A raise is any of:
 *  - the saved mode is not Autonomous and the draft is Autonomous (switch-to-autonomous);
 *  - saved AND draft are Autonomous and the draft raises maxPerMinute or maxPerHour;
 *  - saved AND draft are Autonomous and the draft ADDS a topic or persona id that
 *    the saved allow-list lacks (a swap = remove one + add another counts as adding).
 * Reordering, lowering caps, removing entries, and any change to/from Off or Review
 * (while not becoming Autonomous) are NOT raises.
 */

import type { AmbientPolicyDraft, AmbientPolicyDto } from './ambientPolicyContract'

/** The kind of raise, used to pick the confirm copy; `null` when not a raise. */
export type AmbientRaiseKind = 'switch' | 'widen' | null

type PolicyShape = Pick<
  AmbientPolicyDraft,
  'mode' | 'maxPerMinute' | 'maxPerHour' | 'topicAllowList' | 'personaAllowList'
>

function addsAny(saved: readonly string[], draft: readonly string[]): boolean {
  const have = new Set(saved)
  return draft.some(id => !have.has(id))
}

export function ambientRaiseKind(
  saved: PolicyShape | AmbientPolicyDto,
  draft: PolicyShape,
): AmbientRaiseKind {
  if (draft.mode !== 'autonomous') return null
  if (saved.mode !== 'autonomous') return 'switch'
  const widens =
    draft.maxPerMinute > saved.maxPerMinute ||
    draft.maxPerHour > saved.maxPerHour ||
    addsAny(saved.topicAllowList, draft.topicAllowList) ||
    addsAny(saved.personaAllowList, draft.personaAllowList)
  return widens ? 'widen' : null
}

export function isAmbientRaise(saved: PolicyShape | AmbientPolicyDto, draft: PolicyShape): boolean {
  return ambientRaiseKind(saved, draft) !== null
}
