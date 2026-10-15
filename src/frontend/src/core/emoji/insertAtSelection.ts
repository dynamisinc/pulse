/**
 * core/emoji/insertAtSelection.ts
 * ---------------------------------------------------------------------------
 * Pure text splice for the emoji picker (demo-feedback story 12): put `insert` into
 * `value` at the caret, or in place of the selected range, and say where the caret
 * belongs afterwards (just past the inserted text). No DOM, so it is tested directly.
 *
 * Offsets are the DOM's `selectionStart` / `selectionEnd` (UTF-16 code units). A
 * missing or out-of-range offset clamps to the end of the text (the field was never
 * focused, or the value changed underneath), and a reversed range is normalised.
 */

export interface InsertResult {
  /** The new text. */
  readonly value: string
  /** Caret offset (UTF-16 code units) just after the inserted text. */
  readonly caret: number
}

function clamp(offset: number | null | undefined, length: number): number {
  if (offset === null || offset === undefined || !Number.isFinite(offset)) return length
  return Math.min(Math.max(Math.trunc(offset), 0), length)
}

export function insertAtSelection(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  insert: string,
): InsertResult {
  const a = clamp(selectionStart, value.length)
  // No start means no usable selection at all: append, never replace a stray range.
  const b = selectionStart === null || selectionStart === undefined
    ? a
    : clamp(selectionEnd ?? selectionStart, value.length)
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    caret: start + insert.length,
  }
}
