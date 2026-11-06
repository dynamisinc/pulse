/**
 * features/channels/skin/useOutletSkin.ts
 * ---------------------------------------------------------------------------
 * `useOutletSkin(slug)` (story 13): reads the outlet (`GET /api/outlets/{slug}`,
 * FC-4) and resolves its skin: the registry token file for `skinKey` ⊕ the
 * validated `skinOverrides`, then the floor and guards. An unknown `skinKey`
 * falls back to the neutral skin and logs once.
 *
 * Exercise-scoped (XC-001) the `brandTokens.ts` way: the exercise id is in the
 * query key only, never sent; the server scopes by session.
 *
 * World: participant.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { isOutletDto, type OutletDto } from '../contract'
import { withChannelsMock } from '../mocks'
import { finalizeSkinTokens, mergeSkinTokens } from './resolve'
import type { OutletSkinTokens } from './schema'
import { useSkinRegistryVersion } from './skinContext'

/** What `useOutletSkin` returns. */
export interface OutletSkinResult {
  /** The outlet, once read. */
  readonly outlet: OutletDto | undefined
  /** The registered key in use (`neutral` when the outlet's key is unknown). */
  readonly skinKey: string | undefined
  /** The finalized tokens, once the outlet is read. */
  readonly tokens: OutletSkinTokens | undefined
  readonly isLoading: boolean
  readonly isError: boolean
}

async function fetchOutlet(slug: string): Promise<OutletDto> {
  const response = await api.get<unknown>(`/outlets/${encodeURIComponent(slug)}`, withChannelsMock())
  if (!isOutletDto(response.data)) throw new Error(`fetchOutlet: invalid OutletDto for "${slug}"`)
  return response.data
}

/** Resolves an outlet's skin by slug. */
export function useOutletSkin(slug: string | undefined): OutletSkinResult {
  const { exerciseId } = useExerciseContext()
  const registryVersion = useSkinRegistryVersion()
  const query = useQuery({
    queryKey: ['channels', 'outlet', exerciseId, slug],
    queryFn: () => fetchOutlet(slug as string),
    enabled: slug !== undefined && slug.length > 0,
  })
  const outlet = query.data

  const resolved = useMemo(() => {
    if (!outlet) return undefined
    const merged = mergeSkinTokens(outlet.skinKey, outlet.skinOverrides)
    return { skinKey: merged.skinKey, tokens: finalizeSkinTokens(merged.tokens, merged.skinKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet, registryVersion])

  return {
    outlet,
    skinKey: resolved?.skinKey,
    tokens: resolved?.tokens,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
