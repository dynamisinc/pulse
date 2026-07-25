/**
 * features/controller/hooks/useActivePersona.test.ts
 * ---------------------------------------------------------------------------
 * Story 02 (Fast persona switching) — coverage for the `ActivePersonaProvider`
 * / `useActivePersona()` seam:
 *
 *  - `useActivePersona()` throws when called outside an
 *    `<ActivePersonaProvider>` — no default/module-global active persona
 *    (fail-closed, mirroring `useExerciseContext()` / `useToolstrip()`).
 *  - `selectPersona()` sets the active persona AND records it as the most
 *    recent (MRU, deduped, capped).
 *  - `togglePinned()` pins/unpins a persona id; `isPinned()` reflects it.
 *  - The active persona / recents / pins are process shared across every
 *    `useActivePersona()` call under the SAME provider (this is the whole
 *    point of the seam — the composer and context-panel stories read the
 *    same state the picker writes).
 */
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ActivePersonaProvider, useActivePersona } from './useActivePersona'
import type { StaffPersona } from '@/features/personas'

function buildPersona(
  overrides: Partial<StaffPersona> & Pick<StaffPersona, 'id' | 'displayName' | 'handle'>,
): StaffPersona {
  return {
    exerciseId: 'ex-mock-0001',
    templateId: `tmpl-${overrides.id}`,
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#334455',
    initials: 'XX',
    audienceBand: 'micro',
    followerCount: 120,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const PERSONA_A = buildPersona({ id: 'persona-a', displayName: 'Alex A', handle: 'alexa' })
const PERSONA_B = buildPersona({ id: 'persona-b', displayName: 'Bess B', handle: 'bessb' })

function wrapper({ children }: { children: ReactNode }) {
  return <ActivePersonaProvider>{children}</ActivePersonaProvider>
}

describe('useActivePersona() — fail-closed outside an <ActivePersonaProvider>', () => {
  it('throws rather than returning a default/null active-persona state', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useActivePersona())).toThrow(/ActivePersonaProvider/)
    consoleSpy.mockRestore()
  })
})

describe('useActivePersona() — selecting a persona', () => {
  it('starts with no active persona and empty recents/pins', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })
    expect(result.current.activePersona).toBeNull()
    expect(result.current.recentPersonaIds).toEqual([])
    expect(result.current.pinnedPersonaIds).toEqual([])
  })

  it('selectPersona() sets the active persona and records it as most-recent', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })

    act(() => result.current.selectPersona(PERSONA_A))

    expect(result.current.activePersona).toEqual(PERSONA_A)
    expect(result.current.recentPersonaIds).toEqual(['persona-a'])
  })

  it('re-selecting the same persona de-dupes it in recents rather than repeating it', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })

    act(() => result.current.selectPersona(PERSONA_A))
    act(() => result.current.selectPersona(PERSONA_B))
    act(() => result.current.selectPersona(PERSONA_A))

    expect(result.current.activePersona).toEqual(PERSONA_A)
    expect(result.current.recentPersonaIds).toEqual(['persona-a', 'persona-b'])
  })
})

describe('useActivePersona() — pinning', () => {
  it('togglePinned() pins an unpinned persona and isPinned() reflects it', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })

    expect(result.current.isPinned('persona-a')).toBe(false)
    act(() => result.current.togglePinned('persona-a'))
    expect(result.current.isPinned('persona-a')).toBe(true)
    expect(result.current.pinnedPersonaIds).toEqual(['persona-a'])
  })

  it('togglePinned() unpins an already-pinned persona', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })

    act(() => result.current.togglePinned('persona-a'))
    act(() => result.current.togglePinned('persona-a'))

    expect(result.current.isPinned('persona-a')).toBe(false)
    expect(result.current.pinnedPersonaIds).toEqual([])
  })
})

describe('useActivePersona() — shared across consumers under one provider', () => {
  it('a sibling component reads the SAME active persona another sibling selected', () => {
    // The whole point of the context seam (module header): the picker
    // (writer) and the composer/context-panel stories (readers) must observe
    // one shared value under a single mounted <ActivePersonaProvider> — never
    // independent per-component state.
    function Writer() {
      const { selectPersona } = useActivePersona()
      return <button type="button" onClick={() => selectPersona(PERSONA_A)}>select</button>
    }
    function Reader() {
      const { activePersona } = useActivePersona()
      return <div data-testid="reader">{activePersona?.displayName ?? 'none'}</div>
    }

    render(
      <ActivePersonaProvider>
        <Writer />
        <Reader />
      </ActivePersonaProvider>,
    )

    expect(screen.getByTestId('reader').textContent).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: 'select' }))
    expect(screen.getByTestId('reader').textContent).toBe('Alex A')
  })
})
