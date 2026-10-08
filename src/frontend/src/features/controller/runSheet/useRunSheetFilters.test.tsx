/**
 * features/controller/runSheet/useRunSheetFilters.test.tsx
 * ---------------------------------------------------------------------------
 * The remembered Mine/All + open/fired/all choice (inject-queue story 07):
 *  - the localStorage write happens in the setter wrapper, NOT inside the state updater, so
 *    it happens ONCE per change even under StrictMode (which runs updaters twice);
 *  - successive patches merge (two changes in one batch both stick);
 *  - the stored value is read back on mount (per exercise); every storage access is try/catch.
 */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  FILTERS_STORAGE_PREFIX,
  readStoredFilters,
  useRunSheetFilters,
  writeStoredFilters,
} from './useRunSheetFilters'

const KEY = `${FILTERS_STORAGE_PREFIX}ex-1`

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRunSheetFilters', () => {
  it('writes once per change even under StrictMode (no side effect inside the state updater)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useRunSheetFilters('ex-1'), { wrapper: StrictMode })

    act(() => result.current[1]({ scope: 'mine' }))
    let writes = setItem.mock.calls.filter(([key]) => key === KEY)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]?.[1] ?? 'null')).toEqual({ scope: 'mine', status: 'all' })

    act(() => result.current[1]({ status: 'open' }))
    writes = setItem.mock.calls.filter(([key]) => key === KEY)
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1]?.[1] ?? 'null')).toEqual({ scope: 'mine', status: 'open' })
    expect(result.current[0]).toEqual({ scope: 'mine', status: 'open' })
  })

  it('two patches applied in one batch both stick', () => {
    const { result } = renderHook(() => useRunSheetFilters('ex-1'))
    act(() => {
      result.current[1]({ scope: 'mine' })
      result.current[1]({ status: 'fired' })
    })
    expect(result.current[0]).toEqual({ scope: 'mine', status: 'fired' })
    expect(readStoredFilters('ex-1')).toEqual({ scope: 'mine', status: 'fired' })
  })

  it('restores the stored choice for THIS exercise on mount; defaults to All / all', () => {
    writeStoredFilters('ex-1', { scope: 'mine', status: 'open' })
    expect(renderHook(() => useRunSheetFilters('ex-1')).result.current[0]).toEqual({
      scope: 'mine',
      status: 'open',
    })
    expect(renderHook(() => useRunSheetFilters('ex-2')).result.current[0]).toEqual({
      scope: 'all',
      status: 'all',
    })
  })

  it('a throwing store degrades to "not remembered" without throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useRunSheetFilters('ex-1'))
    expect(result.current[0]).toEqual({ scope: 'all', status: 'all' })
    act(() => result.current[1]({ scope: 'mine' }))
    expect(result.current[0].scope).toBe('mine')
  })
})
