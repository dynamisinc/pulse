/**
 * features/social/layout/socialDirectory.ts
 * ---------------------------------------------------------------------------
 * The channel's persona DIRECTORY: one resolved copy of the exercise's persona
 * cast, shared by everything in the frame that needs to turn a handle into a
 * persona or the reverse (demo-polish F1).
 *
 * WHY A SHARED COPY. `usePersonas()` is a plain `useState`/`useEffect` hook, not
 * React Query, so every caller refetches on mount. The frame needs the cast in
 * five places -- the nav rail (the viewer's own handle for the Profile pill), the
 * account card (name / handle / avatar), the `/:handle` route (handle -> persona),
 * and the open-profile callback (persona id -> handle). `SocialDirectoryProvider`
 * calls `usePersonas()` ONCE and publishes the result here, so those five share a
 * single read instead of issuing five.
 *
 * Exercise scope is inherited, not re-derived: `usePersonas()` reads the session's
 * own cast (COR-001); this module adds no data access of its own.
 *
 * The context + hook are a `.ts` module and the provider component lives in
 * `SocialDirectoryProvider.tsx` -- the same split `socialNavigation.ts` uses, and
 * what `react-refresh/only-export-components` wants.
 *
 * World: participant. No COBRA, no MUI.
 */

import { createContext, useContext } from 'react'
import type { Persona } from '@/features/personas'

export interface SocialDirectory {
  /** The exercise's personas (participant projection). Empty until loaded. */
  readonly personas: readonly Persona[]
  /** True until the FIRST read settles. */
  readonly loading: boolean
  /** The read failure, if any (the list then stays empty on a first load). */
  readonly error: unknown
  /** The viewer's own persona (`session.personaId`), once the cast has loaded. */
  readonly self: Persona | undefined
  /** Case-insensitive handle lookup (`FulcoEM` === `fulcoem`). */
  readonly findByHandle: (handle: string) => Persona | undefined
  /** Persona id -> persona. Ids are opaque; never parse them. */
  readonly findById: (personaId: string) => Persona | undefined
}

export const SocialDirectoryContext = createContext<SocialDirectory | undefined>(undefined)

/** Fail-closed outside a `SocialDirectoryProvider` (`SocialChannel` mounts one). */
export function useSocialDirectory(): SocialDirectory {
  const directory = useContext(SocialDirectoryContext)
  if (directory === undefined) {
    throw new Error(
      'useSocialDirectory() must be called within the Social channel ' +
      '(<SocialChannel> mounts the <SocialDirectoryProvider>).',
    )
  }
  return directory
}
