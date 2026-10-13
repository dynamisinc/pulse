/**
 * features/participantAdmin/components/people/rosterValidation.ts
 * ---------------------------------------------------------------------------
 * Client-side validation of the "Add participant" form (feature: easy-login,
 * story 10) — the same rules as the frozen `RosterRowWrite` contract, applied
 * BEFORE sending so a typo costs no round trip. The server validates again and
 * is the authority; this only gives fast, specific feedback.
 *
 *   name           required, 1..256
 *   agency, role   <= 128
 *   email          optional, <= 254, a simple address shape (no `<` or `>`, as the server)
 *   signInName     optional; `^[a-z0-9][a-z0-9._-]{2,31}$` AFTER trim + lower-case
 *   personaHandle  optional; an ORG persona in this exercise ('@' tolerated) —
 *                  existence is the server's call, so no client rule beyond a
 *                  length cap
 *
 * World: STAFF. Pure functions — no UI.
 */

import type { RosterRowWrite } from '../../types'

/** The form's fields, all strings (an input's value). */
export interface RosterFormValues {
  name: string
  agency: string
  role: string
  email: string
  personaHandle: string
  signInName: string
}

export type RosterFormField = keyof RosterFormValues

export type RosterFormErrors = Partial<Record<RosterFormField, string>>

export const EMPTY_ROSTER_FORM: RosterFormValues = {
  name: '',
  agency: '',
  role: '',
  email: '',
  personaHandle: '',
  signInName: '',
}

/** The sign-in name rule from the contract. */
export const SIGN_IN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/

/**
 * The server's address shape (`RosterRowRules.EmailPattern`): something, `@`, something, a dot,
 * something; no whitespace, no second `@`, and NO ANGLE BRACKET (`<` or `>`), so a pasted
 * `Name <a@b.test>` is caught here instead of after a round trip.
 */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** What a sign-in name is normalised to before it is validated or sent. */
export function normalizeSignInName(value: string): string {
  return value.trim().toLowerCase()
}

/** Validates the form; an empty object means it may be sent. */
export function validateRosterForm(values: RosterFormValues): RosterFormErrors {
  const errors: RosterFormErrors = {}

  const name = values.name.trim()
  if (name.length === 0) errors.name = 'Enter the participant\'s name.'
  else if (name.length > 256) errors.name = 'Name must be 256 characters or fewer.'

  if (values.agency.trim().length > 128) errors.agency = 'Agency must be 128 characters or fewer.'
  if (values.role.trim().length > 128) errors.role = 'Role must be 128 characters or fewer.'

  const email = values.email.trim()
  if (email.length > 0 && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    errors.email = 'Enter a valid email address, like name@agency.gov.'
  }

  if (values.personaHandle.trim().length > 256) {
    errors.personaHandle = 'Persona handle must be 256 characters or fewer.'
  }

  const signInName = normalizeSignInName(values.signInName)
  if (signInName.length > 0 && !SIGN_IN_NAME_PATTERN.test(signInName)) {
    errors.signInName =
      'Use 3 to 32 characters: letters a-z, digits, dot, underscore or hyphen, starting with'
      + ' a letter or digit.'
  }

  return errors
}

/** The wire body for a valid form (blank optionals are dropped by the service). */
export function toRosterRowWrite(values: RosterFormValues): RosterRowWrite {
  return {
    name: values.name.trim(),
    agency: values.agency.trim(),
    role: values.role.trim(),
    email: values.email.trim(),
    personaHandle: values.personaHandle.trim(),
    signInName: normalizeSignInName(values.signInName),
  }
}
