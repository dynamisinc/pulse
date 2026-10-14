/**
 * features/controller/personaEdit/textRules.ts
 * ---------------------------------------------------------------------------
 * Low-level text primitives for the persona profile edit's free-text fields
 * (name / bio / location; NFR-004). Pure functions, no React. Shared by the form's
 * courtesy validation (`personaEditForm`) and the mock server (`personaEditMock`),
 * which each build their OWN messages on top — the real server's wording is shown
 * to the controller verbatim whatever these say.
 *
 * ## Count in UTF-16 units — the server's measure — and NEVER cut
 * PE-BE measures every bound with .NET's `string.Length`, i.e. UTF-16 code UNITS
 * ({@link textLength} is JS `.length`, the same number). An astral character (an
 * emoji, say) is TWO units there, so 256 emoji fill a 512-character bio. Counting
 * anything else (code points, graphemes) would make the counter disagree with the
 * server's limit. Counting is safe; CUTTING is not: truncating a JS string at an
 * arbitrary index can split a surrogate pair (a "half emoji"), and PE-BE answers a
 * lone surrogate with a 400 ("The request body must be a JSON object naming the
 * fields to change (JSON merge-patch)."). So this feature NEVER truncates user text:
 * an over-long field shows its limit and blocks Save instead. There is deliberately
 * no `maxLength` attribute on the inputs either (it silently drops a paste), and a
 * guard test forbids `.slice()` / `.substring()` / `.substr()` in the feature.
 *
 * ## What the server refuses (PE-BE Gate-1 fold)
 *   - a lone UTF-16 surrogate, in any text field;
 *   - C0/C1 control characters ({@link hasControlCharacter}) and bidi overrides
 *     U+202A-U+202E / U+2066-U+2069 ({@link hasBidiOverride}), in all three;
 *   - a display name with no visible character ({@link hasVisibleCharacter}, which
 *     mirrors the server's rule: whitespace/separator, control, format, combining
 *     mark, surrogate and unassigned categories, plus five blank "filler" glyphs);
 *   - raw text longer than 4x the field's bound, before sanitizing.
 * Look-alike (homoglyph) names are deliberately ALLOWED — a lookalike account is
 * the point of impersonation training (SOC-052). Nothing here tries to detect one.
 *
 * ## Layout whitespace in the bio (confirmed by PE-BE's final contract)
 * The bio is a multi-line field: CR, LF and TAB are allowed in it
 * (`hasControlCharacter(text, true)`), while the display name and the location
 * refuse every control character.
 */

/**
 * The server's length measure: UTF-16 code units (.NET `string.Length`). For COUNTING
 * only — never cut a string by it (see the module header).
 */
export function textLength(text: string): number {
  return text.length
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
  return /[\u202A-\u202E\u2066-\u2069]/.test(text)
}

/**
 * Letters and symbols that render as blank space although their Unicode category
 * says otherwise — the usual way to fake an "empty" name. The server's list
 * (`PersonaProfilePatchParser.BlankGlyphs`): Hangul choseong/jungseong fillers,
 * Hangul filler, halfwidth Hangul filler, Braille blank.
 */
const BLANK_GLYPHS: ReadonlySet<number> = new Set([0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800])

/** Categories that render as nothing on their own — the server's list, rune by rune. */
const INVISIBLE_CATEGORY = /^[\p{Zs}\p{Zl}\p{Zp}\p{Cc}\p{Cf}\p{Mn}\p{Mc}\p{Me}\p{Cs}\p{Cn}]$/u

/**
 * True when `text` has at least one character a reader can SEE. Mirrors the server
 * (`PersonaProfilePatchParser.HasVisibleCharacter`), rune by rune: not a space,
 * line or paragraph separator; not a control or format (zero-width) character; not a
 * combining mark on its own (non-spacing, spacing, enclosing); not a surrogate or
 * unassigned code point; and not one of the {@link BLANK_GLYPHS}. Letters of every
 * script count, so homoglyph lookalikes pass (SOC-052).
 */
export function hasVisibleCharacter(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && BLANK_GLYPHS.has(codePoint)) continue
    if (INVISIBLE_CATEGORY.test(character)) continue
    return true
  }
  return false
}
