/**
 * features/controller/personaEdit/textRules.ts
 * ---------------------------------------------------------------------------
 * Low-level text primitives for the persona profile edit's free-text fields
 * (name / bio / location; NFR-004). Pure functions, no React. Shared by the form's
 * courtesy validation (`personaEditForm`) and the mock server (`personaEditMock`),
 * which each build their OWN messages on top — the real server's wording is shown
 * to the controller verbatim whatever these say.
 *
 * ## Never cut a string with `.slice()`
 * A JS string is UTF-16. Cutting one at an arbitrary index can split a surrogate
 * pair (a "half emoji"), and PE-BE answers a lone surrogate with a 400 ("The request
 * body must be a JSON object naming the fields to change (JSON merge-patch).").
 * So this feature NEVER truncates user text: lengths are COUNTED in code points
 * ({@link codePointLength}) and an over-long field shows its limit and blocks Save
 * instead. There is deliberately no `maxLength` attribute on the inputs either
 * (it counts UTF-16 units, and silently drops a paste).
 *
 * ## What the server refuses (PE-BE Gate-1 fold)
 *   - a lone UTF-16 surrogate, in any text field;
 *   - C0/C1 control characters ({@link hasControlCharacter}) and bidi overrides
 *     U+202A-U+202E / U+2066-U+2069 ({@link hasBidiOverride}), in all three;
 *   - a display name with no visible character ({@link hasVisibleCharacter});
 *   - raw text longer than 4x the field's bound, before sanitizing.
 * Look-alike (homoglyph) names are deliberately ALLOWED — a lookalike account is
 * the point of impersonation training (SOC-052). Nothing here tries to detect one.
 *
 * ## Layout whitespace in the bio (confirmed by PE-BE's final contract)
 * The bio is a multi-line field: CR, LF and TAB are allowed in it
 * (`hasControlCharacter(text, true)`), while the display name and the location
 * refuse every control character.
 */

/** UTF-16 units are the wrong measure for user text; count code points instead. */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/** True when `text` contains a lone (unpaired) UTF-16 surrogate. */
export function hasLoneSurrogate(text: string): boolean {
  // In `u` mode a valid surrogate PAIR is one code point, so \p{Cs} matches only a lone half.
  return /\p{Cs}/u.test(text)
}

const CONTROL = /\p{Cc}/u
const CONTROL_EXCEPT_LAYOUT_WHITESPACE = /(?![\t\n\r])\p{Cc}/u

/**
 * True when `text` contains a C0 or C1 control character (U+0000-U+001F,
 * U+007F-U+009F). With `allowLayoutWhitespace`, TAB / LF / CR are not counted.
 */
export function hasControlCharacter(text: string, allowLayoutWhitespace = false): boolean {
  return (allowLayoutWhitespace ? CONTROL_EXCEPT_LAYOUT_WHITESPACE : CONTROL).test(text)
}

/** True when `text` contains a bidi override/isolate (U+202A-U+202E, U+2066-U+2069). */
export function hasBidiOverride(text: string): boolean {
  return /[‪-‮⁦-⁩]/.test(text)
}

/**
 * True when `text` has at least one character a reader can SEE: not whitespace, not
 * a control or format character (zero-width space/joiner, BOM, ...).
 */
export function hasVisibleCharacter(text: string): boolean {
  return /[^\s\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]/u.test(text)
}
