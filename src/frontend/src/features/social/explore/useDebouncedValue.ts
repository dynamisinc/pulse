/**
 * features/social/explore/useDebouncedValue.ts
 * ---------------------------------------------------------------------------
 * A tiny trailing-edge debounce for a value (demo-polish F6). Used by `SearchBox`
 * so the polite live region announces the result count once the reader PAUSES
 * typing rather than on every keystroke (NFR-001: announce without thrash).
 *
 * The timer is a UI scheduling delay only; it is never displayed and never feeds
 * a timestamp (COR-053 is about the time participants SEE, which this does not
 * touch).
 */

import { useEffect, useState } from 'react'

/** `value`, but only after it has stayed unchanged for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
