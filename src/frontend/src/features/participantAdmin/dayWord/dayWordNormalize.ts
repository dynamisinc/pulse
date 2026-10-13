/**
 * features/participantAdmin/dayWord/dayWordNormalize.ts
 * ---------------------------------------------------------------------------
 * A pure mirror of the SERVER's day-word normalisation, used ONLY for the live
 * length check under the "type your own word" field (easy-login story 11).
 *
 * The server (EL-9, backend story 05) normalises a word before hashing it AND
 * before comparing a sign-in attempt: lower-case, then keep letters and digits
 * only, then require 6 to 64 characters. So "Pine Cone 42!" and "pinecone42"
 * are the same word to the sign-in page - which is why a typed word's *raw*
 * length is meaningless and this helper counts the normalised form instead.
 *
 * The server stays authoritative. This helper never decides whether a word is
 * accepted; it only lets the panel say "3 of 6" while staff type, and a `400`
 * from `PUT /staff/day-word` is always shown verbatim. If the two ever disagree
 * (e.g. the server counts an accented letter that `a-z0-9` drops), the worst
 * case is a live hint that is stricter than the server, never a weaker secret.
 *
 * Deliberately has NO dependency on the panel, React, or the network so it is
 * trivially unit-testable. World: staff.
 */

import { DAY_WORD_MAX_LENGTH, DAY_WORD_MIN_LENGTH } from './types'

/** Lower-cases `input` and keeps only `a-z` and `0-9`. */
export function normalizeDayWord(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The outcome of the live check. `have` is the NORMALISED length. */
export type DayWordCheck =
  | { readonly kind: 'empty' }
  | { readonly kind: 'tooShort'; readonly have: number }
  | { readonly kind: 'tooLong'; readonly have: number }
  | { readonly kind: 'ok'; readonly have: number }

/** Classifies a typed word against the server's length rule (post-normalisation). */
export function checkDayWord(input: string): DayWordCheck {
  if (input.trim().length === 0) return { kind: 'empty' }
  const have = normalizeDayWord(input).length
  if (have < DAY_WORD_MIN_LENGTH) return { kind: 'tooShort', have }
  if (have > DAY_WORD_MAX_LENGTH) return { kind: 'tooLong', have }
  return { kind: 'ok', have }
}

/** Plain-language rule shown as the field's standing hint. */
export const DAY_WORD_RULE_HINT =
  `${DAY_WORD_MIN_LENGTH} to ${DAY_WORD_MAX_LENGTH} letters and digits. ` +
  'Capitals, spaces and punctuation are ignored when people sign in.'

/**
 * The live message for a check result. Always TEXT (never colour alone,
 * NFR-001): the caller adds the error styling on top of it.
 */
export function describeDayWordCheck(check: DayWordCheck): string {
  switch (check.kind) {
    case 'empty':
      return DAY_WORD_RULE_HINT
    case 'tooShort':
      return `Too short: ${check.have} of ${DAY_WORD_MIN_LENGTH} letters or digits so far. ` +
        'Spaces and punctuation do not count.'
    case 'tooLong':
      return `Too long: ${check.have} letters or digits, the most allowed is ${DAY_WORD_MAX_LENGTH}.`
    case 'ok':
      return `Looks good: ${check.have} letters and digits count. ` +
        'Capitals, spaces and punctuation are ignored when people sign in.'
  }
}
