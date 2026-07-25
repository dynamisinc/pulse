/**
 * features/controller/hooks/useActivePersona.qa.test.tsx
 * ---------------------------------------------------------------------------
 * QA addendum to useActivePersona.test.tsx (story 02, "Fast persona
 * switching"). Covers the MRU recents cap (`MAX_RECENT_PERSONAS = 8`) the
 * builder's own suite documents in the module header but does not assert:
 * selecting more than 8 distinct personas must evict the OLDEST entries
 * rather than growing unbounded or evicting the newest.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { ActivePersonaProvider, useActivePersona } from './useActivePersona'
import type { StaffPersona } from '@/features/personas'

function buildPersona(id: string): StaffPersona {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    templateId: `tmpl-${id}`,
    displayName: id,
    handle: id,
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#334455',
    initials: 'XX',
    audienceBand: 'micro',
    followerCount: 120,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <ActivePersonaProvider>{children}</ActivePersonaProvider>
}

describe('useActivePersona() — recents are capped at MAX_RECENT_PERSONAS (8)', () => {
  it('selecting 9 distinct personas keeps only the 8 most-recent, evicting the oldest first', () => {
    const { result } = renderHook(() => useActivePersona(), { wrapper })
    const personas = Array.from({ length: 9 }, (_, i) => buildPersona(`persona-${i}`))

    act(() => {
      for (const persona of personas) result.current.selectPersona(persona)
    })

    expect(result.current.recentPersonaIds).toHaveLength(8)
    // Newest-first; the very first one selected (persona-0) must have aged out.
    expect(result.current.recentPersonaIds[0]).toBe('persona-8')
    expect(result.current.recentPersonaIds).not.toContain('persona-0')
  })
})
