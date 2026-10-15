/**
 * core/emoji/gridNavigation.ts
 * ---------------------------------------------------------------------------
 * Pure arrow-key movement through the emoji picker's grid (demo-feedback story 12).
 * The grid is one flat list drawn `columns` wide; see `emojiData.ts` for why every
 * category fills whole rows, which keeps Up/Down visually straight.
 *
 *   Right / Left  next / previous emoji, stopping at the ends (no wrap).
 *   Down          the emoji below; on the last full row, the last emoji when a
 *                 shorter row follows; on the last row, stay.
 *   Up            the emoji above; on the first row, stay.
 *
 * Any other key returns `current` unchanged. With no emoji the index is -1.
 */

export type GridKey = 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp'

export function isGridKey(key: string): key is GridKey {
  return key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowDown' || key === 'ArrowUp'
}

export function moveInGrid(current: number, key: GridKey, count: number, columns: number): number {
  if (count <= 0) return -1
  const from = Math.min(Math.max(current, 0), count - 1)
  switch (key) {
    case 'ArrowRight':
      return Math.min(from + 1, count - 1)
    case 'ArrowLeft':
      return Math.max(from - 1, 0)
    case 'ArrowDown': {
      if (from + columns < count) return from + columns
      const lastRow = Math.floor((count - 1) / columns)
      return Math.floor(from / columns) < lastRow ? count - 1 : from
    }
    case 'ArrowUp':
      return from - columns >= 0 ? from - columns : from
  }
}
