/**
 * features/controller/runSheet/useRunSheetFilters.ts
 * ---------------------------------------------------------------------------
 * The run sheet's Mine/All + open/fired/all filter choice, REMEMBERED PER EXERCISE
 * in `localStorage` (inject-queue story 07, AC "Mine / All"). STAFF world.
 *
 *   - key: `pulse.runsheet.filters.v1.{exerciseId}` — per exercise, so switching
 *     exercises (COR-005) never carries one exercise's choice into another;
 *   - default: Mine/All = All, status = all (the choice is a filter, never a lock — IQ-3);
 *   - EVERY storage access is in try/catch: private mode, a blocked or full store,
 *     a corrupt value or a missing `window` must degrade to "not remembered", never
 *     throw into a live console. A stored value is VALIDATED (`parseStoredFilters`),
 *     so a hand-edited or older payload falls back to the defaults.
 *
 * The exercise id is used ONLY as part of the storage key (display/persistence);
 * it is never sent in a request (COR-001).
 */

import { useCallback, useState } from 'react'
import { DEFAULT_FILTERS, parseStoredFilters, type RunSheetFilters } from './injectRules'

export const FILTERS_STORAGE_PREFIX = 'pulse.runsheet.filters.v1.'

const storageKey = (exerciseId: string): string => `${FILTERS_STORAGE_PREFIX}${exerciseId}`

export function readStoredFilters(exerciseId: string): RunSheetFilters {
  try {
    const raw = window.localStorage.getItem(storageKey(exerciseId))
    return raw === null ? DEFAULT_FILTERS : parseStoredFilters(JSON.parse(raw))
  } catch {
    return DEFAULT_FILTERS
  }
}

export function writeStoredFilters(exerciseId: string, filters: RunSheetFilters): void {
  try {
    window.localStorage.setItem(storageKey(exerciseId), JSON.stringify(filters))
  } catch {
    // Not remembered; the in-memory choice still works.
  }
}

/**
 * `[filters, update]`. Mount it once per exercise (the panel is keyed by exercise
 * id), so the initial read is the stored choice for THIS exercise.
 */
export function useRunSheetFilters(
  exerciseId: string,
): readonly [RunSheetFilters, (patch: Partial<RunSheetFilters>) => void] {
  const [filters, setFilters] = useState<RunSheetFilters>(() => readStoredFilters(exerciseId))

  const update = useCallback(
    (patch: Partial<RunSheetFilters>) => {
      setFilters(previous => {
        const next = { ...previous, ...patch }
        writeStoredFilters(exerciseId, next)
        return next
      })
    },
    [exerciseId],
  )

  return [filters, update]
}
