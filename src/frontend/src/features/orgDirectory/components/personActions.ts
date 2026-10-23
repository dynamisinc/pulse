/**
 * features/orgDirectory/components/personActions.ts
 * ---------------------------------------------------------------------------
 * The five per-person actions, their confirm and success copy, the reset-link availability rule,
 * and the 409/404/400 -> message mapping. Pure data; the dialog and table render it. Messages
 * are plain words (shown beside an icon, never colour).
 */

import type { OrgPersonPatch } from '../types'

export type PersonActionKind = 'grantAdmin' | 'revokeAdmin' | 'disable' | 'enable' | 'resetPassword'

/** The PATCH body for an action, or null for the reset-link action (a POST). */
export function patchFor(kind: PersonActionKind): OrgPersonPatch | null {
  switch (kind) {
    case 'grantAdmin': return { isOrgAdmin: true }
    case 'revokeAdmin': return { isOrgAdmin: false }
    case 'disable': return { disabled: true }
    case 'enable': return { disabled: false }
    case 'resetPassword': return null
  }
}

export function actionTitle(kind: PersonActionKind): string {
  switch (kind) {
    case 'grantAdmin': return 'Make an organization admin?'
    case 'revokeAdmin': return 'Remove organization admin?'
    case 'disable': return 'Disable this person?'
    case 'enable': return 'Enable this person?'
    case 'resetPassword': return 'Create a password-reset link?'
  }
}

export function actionBody(kind: PersonActionKind): string {
  switch (kind) {
    case 'grantAdmin':
      return 'can manage every exercise and every person in the organization. Their account gets staff access if it has none.'
    case 'revokeAdmin':
      return 'loses organization admin and is signed out of any organization session. Their exercise assignments are kept.'
    case 'disable':
      return 'will be signed out everywhere and cannot sign in until enabled again.'
    case 'enable':
      return 'will be able to sign in again.'
    case 'resetPassword':
      return 'gets a one-time link, shown once, that you copy and give them. It replaces any earlier link.'
  }
}

export function actionConfirmLabel(kind: PersonActionKind): string {
  switch (kind) {
    case 'grantAdmin': return 'Make admin'
    case 'revokeAdmin': return 'Remove admin'
    case 'disable': return 'Disable'
    case 'enable': return 'Enable'
    case 'resetPassword': return 'Create link'
  }
}

/**
 * The short success sentence lifted into the page's polite `role="status"` region (W-003), so a
 * screen-reader user hears that the action worked after the dialog closes.
 */
export function successMessage(kind: PersonActionKind, displayName: string): string {
  switch (kind) {
    case 'grantAdmin': return `${displayName} is now an org admin.`
    case 'revokeAdmin': return `${displayName} is no longer an org admin.`
    case 'disable': return `${displayName} was disabled.`
    case 'enable': return `${displayName} was enabled.`
    case 'resetPassword': return `Reset link created for ${displayName}.`
  }
}

/** The extra confirm line when an org admin removes their OWN org-admin role (S4). */
export const SELF_REVOKE_NOTE = 'You will be signed out of the organization view.'

/**
 * Why the reset-link action is unavailable for a row, or null when it is available (S3). The server
 * would 409 both cases (`target-is-org-admin`, `person-disabled`); the mappings below stay for a
 * stale row. Shown as visible text beside the disabled button, not only as a tooltip.
 */
export function resetUnavailableReason(person: {
  readonly orgRole: 'orgAdmin' | null
  readonly disabled: boolean
}): string | null {
  if (person.orgRole === 'orgAdmin') return 'Not for org admins: they reset their own password.'
  if (person.disabled) return 'Not while disabled: enable them first.'
  return null
}

/** Maps a failure to words. `status`/`code` come from `OrgPeopleError`. */
export function errorMessage(status: number | undefined, code: string | undefined): string {
  if (status === 409) {
    switch (code) {
      case 'last-org-admin':
        return 'The organization must keep at least one enabled admin. Make another person an admin first.'
      case 'cannot-disable-self':
        return 'You cannot disable your own account.'
      case 'target-is-org-admin':
        return 'You cannot create a reset link for another organization admin. They can reset their own password.'
      case 'person-disabled':
        return 'This person is disabled, so a reset link would not work. Enable them first.'
      default:
        return 'The change conflicts with the current state. The list has been refreshed; try again.'
    }
  }
  if (status === 404) return 'This person is no longer in your organization. The list has been refreshed.'
  if (status === 503 && code === 'reset-link-unavailable') {
    return 'Reset links are not available because no sign-in address is configured.'
  }
  if (status === 400) return 'The request was not valid. Refresh the page and try again.'
  return 'Something went wrong and nothing was changed. Try again.'
}
