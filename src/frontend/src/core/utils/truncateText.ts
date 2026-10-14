/**
 * core/utils/truncateText.ts
 * ---------------------------------------------------------------------------
 * World-neutral text helpers for cutting display strings (server messages,
 * banner text) to a length budget.
 *
 * WHY: `String.prototype.slice` counts UTF-16 units, so a cut that lands between
 * the two halves of a surrogate pair (an emoji, an astral letter) leaves a bare
 * half that renders as U+FFFD. Every place that bounds a message for display
 * should cut through this helper instead of a raw `.slice(0, n)`.
 */

/**
 * `text` cut to at most `max` UTF-16 units, never between the halves of a
 * surrogate pair: when the cut would split one, it ends one unit earlier.
 *
 * @param text The string to bound.
 * @param max  The budget in UTF-16 units (the unit `String.length` counts).
 * @returns `text` unchanged when it fits, otherwise its longest pair-safe prefix.
 */
export function truncateWithoutSplittingSurrogates(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const last = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  const splitsPair = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  if (splitsPair) end -= 1
  return text.slice(0, end)
}
