/**
 * Story 13 AC "Merge": `useOutletSkin(slug)` reads the outlet and resolves
 * registry tokens ⊕ overrides; an unknown key falls back to neutral.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { useOutletSkin } from './useOutletSkin'
import { registerSkinTokens, resetSkinRegistryForTests } from './registry'
import { resetSkinReportsForTests } from './report'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn() }
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  ;(useExerciseContext as Mock).mockReturnValue({ exerciseId: 'ex-1' })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
  resetSkinRegistryForTests()
  resetSkinReportsForTests()
})

describe('useOutletSkin', () => {
  it('resolves a stub outlet, then the final tokens once the channel registers', async () => {
    const { result } = renderHook(() => useOutletSkin('wire-room'), { wrapper })
    await waitFor(() => expect(result.current.tokens).toBeDefined())
    expect(result.current.outlet?.slug).toBe('wire-room')
    expect(result.current.skinKey).toBe('wire-room')
    expect(result.current.tokens?.palette).toEqual(WIRE_ROOM_STUB_TOKENS.palette)

    const final = { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent: '#123456' } }
    act(() => registerSkinTokens('wire-room', final))
    expect(result.current.tokens?.palette.accent).toBe('#123456')
  })

  it('falls back to neutral when the outlet\'s skinKey is not registered', async () => {
    // The mock Newsline 7 outlet carries skinKey "newsline7", which only E4 registers.
    const { result } = renderHook(() => useOutletSkin('newsline-7'), { wrapper })
    await waitFor(() => expect(result.current.tokens).toBeDefined())
    expect(result.current.skinKey).toBe('neutral')
    expect(result.current.tokens?.palette).toEqual(NEUTRAL_SKIN_TOKENS.palette)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown skinKey "newsline7"/))
  })

  it('stays idle without a slug and errors on an unknown outlet', async () => {
    const idle = renderHook(() => useOutletSkin(undefined), { wrapper })
    expect(idle.result.current.tokens).toBeUndefined()
    expect(idle.result.current.isLoading).toBe(false)

    const missing = renderHook(() => useOutletSkin('no-such-outlet'), { wrapper })
    await waitFor(() => expect(missing.result.current.isError).toBe(true))
    expect(missing.result.current.tokens).toBeUndefined()
  })
})
