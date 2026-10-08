/**
 * features/social/layout/useSocialOpeners.ts
 * ---------------------------------------------------------------------------
 * The in-channel "open this" callbacks -- thread, profile, hashtag -- as
 * `navigate()` calls over the navigation adapter (demo-polish F1, "Right rail"
 * AC: "in-channel opens ... are `navigate()` calls supplied to `Feed` /
 * `ThreadView` / `HashtagFeed` / `PostCard` through `useSocialNavigation()`").
 *
 * They replace the old `setView(...)` state machine in `SocialChannel`. The shapes
 * are exactly the optional props those components already take (`onOpenThread`,
 * `onOpenProfile`, `onHashtagOpen`), so none of them changed:
 *
 *   openThread(postId, authorHandle?)  -> /:handle/status/:id   (handle optional:
 *                                         cosmetic, see `THREAD_HANDLE_PLACEHOLDER`)
 *   openProfile(personaId)             -> /:handle   (persona id resolved to a
 *                                         handle through the shared directory)
 *   openHashtag(tag)                   -> /hashtag/:tag
 *
 * IDENTITY IS STABLE. The feed's rows are `React.memo`'d and these callbacks are
 * threaded into every one, so a changing identity would re-render every row on
 * every channel render and regress burst legibility (NFR-002/SOC-071). Everything
 * mutable (the persona directory) is read through a ref; `useSocialNavigate()` is
 * itself stable and does not change on a location change.
 *
 * `openProfile` needs the persona's HANDLE for the URL, and ids are opaque (never
 * parsed into one), so it asks the shared directory. A card renders its author from
 * the cast its OWN `usePersonas()` read, which can settle a beat before the
 * directory's -- so a tap in that window is not dropped: while the directory is
 * still loading the request is remembered and completed the moment it resolves. A
 * persona the settled directory does not know is a no-op (no fabricated URL).
 *
 * World: participant. No COBRA, no MUI.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { socialPaths, useSocialNavigate } from './socialNavigation'
import { useSocialDirectory, type SocialDirectory } from './socialDirectory'

export interface SocialOpeners {
  /** Open a post's thread. `authorHandle` only decorates the URL. */
  readonly openThread: (postId: string, authorHandle?: string) => void
  /** Open a persona's profile by persona id. */
  readonly openProfile: (personaId: string) => void
  /** Open a hashtag's feed. `tag` is the normalized tag (no leading `#`). */
  readonly openHashtag: (tag: string) => void
}

export function useSocialOpeners(): SocialOpeners {
  const { navigate } = useSocialNavigate()
  const directory = useSocialDirectory()

  const directoryRef = useRef<SocialDirectory>(directory)
  useLayoutEffect(() => {
    directoryRef.current = directory
  })

  // A profile tap that arrived while the directory was still loading (see header).
  const pendingProfileId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const pending = pendingProfileId.current
    if (pending === undefined || directory.loading) return
    pendingProfileId.current = undefined
    const persona = directory.findById(pending)
    if (persona !== undefined) navigate(socialPaths.profile(persona.handle))
  }, [directory, navigate])

  return useMemo<SocialOpeners>(
    () => ({
      openThread: (postId, authorHandle) => navigate(socialPaths.thread(postId, authorHandle)),
      openProfile: personaId => {
        const current = directoryRef.current
        const persona = current.findById(personaId)
        if (persona !== undefined) navigate(socialPaths.profile(persona.handle))
        else if (current.loading) pendingProfileId.current = personaId
      },
      openHashtag: tag => navigate(socialPaths.hashtag(tag)),
    }),
    [navigate],
  )
}
