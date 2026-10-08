/**
 * features/social/layout/SocialDirectoryProvider.tsx
 * ---------------------------------------------------------------------------
 * Resolves the persona cast once and publishes it as the channel's directory.
 * See `./socialDirectory.ts` for why. Mounted by `SocialChannel`, above the frame.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useMemo, type ReactNode } from 'react'
import { useSession } from '@/core/auth'
import { usePersonas } from '@/features/personas'
import { SocialDirectoryContext, type SocialDirectory } from './socialDirectory'

export interface SocialDirectoryProviderProps {
  children: ReactNode
}

export function SocialDirectoryProvider({ children }: SocialDirectoryProviderProps) {
  const { personas, loading, error } = usePersonas()
  const { personaId } = useSession()

  const directory = useMemo<SocialDirectory>(() => {
    const byId = new Map(personas.map(persona => [persona.id, persona]))
    const byHandle = new Map(personas.map(persona => [persona.handle.toLowerCase(), persona]))
    return {
      personas,
      loading,
      error,
      self: personaId === undefined ? undefined : byId.get(personaId),
      findByHandle: handle => byHandle.get(handle.toLowerCase()),
      findById: id => byId.get(id),
    }
  }, [personas, loading, error, personaId])

  return (
    <SocialDirectoryContext.Provider value={directory}>
      {children}
    </SocialDirectoryContext.Provider>
  )
}
