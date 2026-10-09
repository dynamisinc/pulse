/**
 * features/controller/runSheet/injectMessages.ts
 * ---------------------------------------------------------------------------
 * Every controller-facing sentence of the run sheet that a story AC words
 * exactly, plus the one function that turns a failed action into a sentence.
 * STAFF world, no UI. Kept in one file so the wording is auditable against
 * `docs/features/inject-queue/07-scripted-posts-console.md` in one place and a
 * copy change is a one-line edit (the tests assert against THESE constants for
 * the AC strings and against literals for the behaviour they describe).
 *
 * All of it is rendered as TEXT — never colour alone (NFR-001) — and none of it
 * interpolates server markup: a server `detail` is shown as plain text through
 * React (no `dangerouslySetInnerHTML` anywhere in this feature, NFR-004).
 */

import axios from 'axios'
import { InjectConflictError, InjectNotFoundError, InjectValidationError } from './injectErrors'

export const MESSAGES = {
  /** AC "Fire on cue": the reason Fire/Retry are disabled under FREEZE. */
  worldFrozen: 'World frozen',
  /** AC "PAUSE INJECTS is live" / IQ-5. */
  injectsPaused: 'Injects paused: bursts are suspended; manual fire still works',
  /** AC "Author live": a stale-version 409. */
  changedByOthers: 'Changed by someone else. Reloaded.',
  /** Fallback when the firing controller can't be resolved from the assignees. */
  anotherController: 'another controller',
  notFound: 'That item no longer exists. The list was reloaded.',
  loadFailed: 'Can\'t load the run sheet. Retrying…',
  connectionLost: 'Lost contact with the server. Showing the last known run sheet; retrying…',
  heldFireHint: 'Held. Release it first.',
} as const

/** AC "Fire on cue": a 409 from a concurrent fire. */
export const alreadyFiredBy = (name: string): string => `Already fired by ${name}`

/** The actions a failure can belong to (drives the wording). */
export type InjectAction =
  | 'fire'
  | 'hold'
  | 'release'
  | 'skip'
  | 'unskip'
  | 'retry'
  | 'delete'
  | 'save'
  | 'reorder'

/**
 * The sentence for a failed action.
 *
 *   409 on `fire` for an item that is already fired/firing -> "Already fired by {name}"
 *       (name resolved from the assignees by `firedByHumanId`; "another controller" if unknown);
 *   409 on `save`                                           -> "Changed by someone else. Reloaded."
 *   any other 409                                           -> the server's own `detail`
 *       ("The world is frozen", "Fire the parent first", ...), or the stale-version line if none;
 *   400                                                     -> the server's validation message;
 *   404                                                     -> the item is gone; the list reloaded;
 *   401 / 403                                               -> a plain access sentence;
 *   anything else                                           -> "Couldn't {verb}: {message}".
 */
export function describeActionError(
  action: InjectAction,
  error: unknown,
  nameOf: (id: string | undefined) => string | undefined,
): string {
  if (error instanceof InjectConflictError) {
    const item = error.item
    if (action === 'fire' && item && (item.status === 'fired' || item.status === 'firing')) {
      return alreadyFiredBy(nameOf(item.firedByHumanId) ?? MESSAGES.anotherController)
    }
    if (action === 'save') return MESSAGES.changedByOthers
    return error.detail || MESSAGES.changedByOthers
  }
  if (error instanceof InjectValidationError) {
    return error.detail || `Couldn't ${action}: invalid request`
  }
  if (error instanceof InjectNotFoundError) return MESSAGES.notFound
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 401) return 'Your session has ended. Sign in again to use the run sheet.'
    if (status === 403) return 'Only controllers assigned to this exercise can change the run sheet.'
  }
  const reason = error instanceof Error && error.message ? error.message : 'unknown error'
  return `Couldn't ${action}: ${reason}`
}
