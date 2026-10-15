/**
 * features/participantAdmin/components/people/rosterActions.ts
 * ---------------------------------------------------------------------------
 * The decisions behind a roster row's action buttons (feature: easy-login,
 * story 10), kept out of the component so every rule is unit-tested directly:
 * which buttons a row offers, which need a confirm, what each confirm says, and
 * how a result or failure is announced.
 *
 * Which buttons a row offers follows its state:
 *
 *   active link         Copy link, Reissue link, Revoke link, Disable
 *   needs reissue       Reissue link (INSTEAD of Copy: the token is lost), Revoke link, Disable
 *   revoked             Reissue link, Disable
 *   no link ("none")    Issue link, Disable
 *   access disabled     Enable   (the person is off; turn them back on first)
 *
 * Reissue (and "Issue link"), Revoke and Disable end the participant's live
 * sessions (EL-8), so they are ALL confirmed — even a first link for someone with
 * none, because the on-screen session count can be stale. Copy and Enable never
 * confirm. No message built here ever contains a join URL.
 *
 * World: STAFF. Pure functions — no UI.
 */

import type { RosterActionKind, RosterEntryDto } from '../../types'
import type { RosterError } from '../../services/rosterService'
import { describeSessionsEnded, linkDisplayState } from './rosterDisplay'

/** The buttons a row can offer. `copy` is client-only; the rest are the four actions. */
export type RowActionId = 'copy' | RosterActionKind

/** What a row reports up to the page's live region. */
export interface RosterActionReport {
  readonly tone: 'success' | 'error'
  readonly message: string
}

/** Which buttons this row offers, in display order. See the module header. */
export function availableActions(entry: RosterEntryDto): RowActionId[] {
  if (entry.access === 'disabled') return ['enable']

  const state = linkDisplayState(entry)
  const actions: RowActionId[] = []
  if (state === 'active' && entry.link.joinUrl !== undefined) actions.push('copy')
  actions.push('reissue')
  if (state === 'active' || state === 'needsReissue') actions.push('revoke')
  actions.push('disable')
  return actions
}

/**
 * True when the action should be confirmed first: every action that ends sessions
 * (reissue, "issue", revoke, disable). "Issue link" for someone with no link and no
 * live sessions is confirmed too: the session count on screen can be stale, and
 * issuing ends any session they turn out to have.
 */
export function needsConfirmation(action: RowActionId): boolean {
  return action === 'reissue' || action === 'revoke' || action === 'disable'
}

/** The visible label of a button. */
export function actionLabel(action: RowActionId, entry: RosterEntryDto): string {
  switch (action) {
    case 'copy': return 'Copy link'
    case 'reissue': return entry.link.status === 'none' ? 'Issue link' : 'Reissue link'
    case 'revoke': return 'Revoke link'
    case 'disable': return 'Disable'
    case 'enable': return 'Enable'
  }
}

export interface ConfirmText {
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
}

function liveSessionsNote(entry: RosterEntryDto): string {
  if (entry.liveSessions <= 0) return ''
  const sessions = entry.liveSessions === 1 ? '1 live session' : `${entry.liveSessions} live sessions`
  return ` ${entry.name} has ${sessions} right now.`
}

/** What each confirm dialog says. Plain words, no jargon, the consequence first. */
export function confirmText(action: RosterActionKind, entry: RosterEntryDto): ConfirmText {
  const { name } = entry
  switch (action) {
    case 'reissue':
      return entry.link.status === 'none'
        ? {
          title: `Issue a link for ${name}?`,
          body: `This creates a link ${name} can use to sign in. Any session ${name} has open is`
            + ' ended.'
            + liveSessionsNote(entry),
          confirmLabel: 'Issue link',
        }
        : {
          title: `Reissue the link for ${name}?`,
          body: `This signs ${name} out everywhere and the old link stops working. A new link is`
            + ' created that you can copy or print on a card.'
            + liveSessionsNote(entry),
          confirmLabel: 'Reissue link',
        }
    case 'revoke':
      return {
        title: `Revoke the link for ${name}?`,
        body: `This signs ${name} out everywhere and the link stops working. ${name} can still`
          + ' sign in with today\'s word unless you also disable them.'
          + liveSessionsNote(entry),
        confirmLabel: 'Revoke link',
      }
    case 'disable':
      return {
        title: `Disable ${name}?`,
        body: `This signs ${name} out everywhere, and their link, today's word and password`
          + ' sign-in all stop working until you enable them again.'
          + liveSessionsNote(entry),
        confirmLabel: 'Disable',
      }
    default:
      return { title: '', body: '', confirmLabel: '' }
  }
}

export function successMessage(
  kind: RosterActionKind,
  name: string,
  sessionsEnded: number,
): string {
  const ended = describeSessionsEnded(sessionsEnded)
  switch (kind) {
    case 'reissue': return `New link issued for ${name}. ${ended}`
    case 'revoke': return `Link revoked for ${name}. ${ended}`
    case 'disable': return `${name} disabled. ${ended}`
    case 'enable': return `${name} enabled.`
  }
}

const FAILURE_VERB: Readonly<Record<RosterActionKind, string>> = {
  reissue: 'issue a new link for',
  revoke: 'revoke the link for',
  disable: 'disable',
  enable: 'enable',
}

export function failureMessage(error: RosterError, kind: RosterActionKind, name: string): string {
  if (error.status === 401 || error.status === 403) {
    return 'You don\'t have access to change this roster.'
  }
  if (error.status === 404) {
    return `${name} is no longer on this roster. The list has been refreshed.`
  }
  if (error.status === undefined) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return `Could not ${FAILURE_VERB[kind]} ${name}: ${
    error.serverMessage ?? 'the server could not complete the action. Try again.'
  }`
}
