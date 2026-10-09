/**
 * features/social/layout/socialDirectory.testUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helper shared by the suites that prove a surface reads the channel's
 * persona DIRECTORY instead of resolving a cast of its own (`Profile.directory`,
 * `ThreadView.directory`). It ships in no runtime import path; only `*.test.tsx` files
 * import it.
 *
 * `loadedDirectory()` returns a `SocialDirectory` in the state `SocialDirectoryProvider`
 * publishes once the cast has landed -- built by hand, so mounting a surface under
 * `<SocialDirectoryContext.Provider value={...}>` costs NO `GET /personas` at all. That is
 * what lets a suite assert "this surface issued zero cast reads" and "this surface renders
 * on its first frame, because the directory was already loaded".
 *
 * The cast is the shipped mock one (`resolvePersonas()`, participant projection); call it
 * BEFORE installing any `api.get` spy so the setup read is not counted.
 *
 * World: participant test scaffolding -- no COBRA, no MUI.
 */

import { resolvePersonas } from '@/features/personas'
import type { SocialDirectory } from './socialDirectory'

/** A directory in the "already resolved" state, with no provider fetch behind it. */
export async function loadedDirectory(): Promise<SocialDirectory> {
  const personas = await resolvePersonas()
  const byId = new Map(personas.map(persona => [persona.id, persona] as const))
  const byHandle = new Map(
    personas.map(persona => [persona.handle.toLowerCase(), persona] as const),
  )
  return {
    personas,
    loading: false,
    error: undefined,
    self: undefined,
    findByHandle: handle => byHandle.get(handle.toLowerCase()),
    findById: id => byId.get(id),
  }
}
