/**
 * features/staffShell/components/PreviewChannelHost.tsx
 * ---------------------------------------------------------------------------
 * The PARTICIPANT-WORLD half of "Preview as participant" (feature: staff-shell,
 * story 04, COR-041; reworked by demo-polish C6, docs/features/demo-polish/
 * 23-preview-and-startex.md). It mounts the REAL Social channel -- the same
 * `<SocialChannel />` a participant gets -- inside the staff frame, and replaces
 * the `PortalStub` mock this file's predecessor staged. `PreviewAsParticipant.tsx`
 * (the staff half: label strip, moment picker, Exit, neutral mat) renders this and
 * nothing else of the participant world.
 *
 * ## The composition (outermost first)
 *
 *   PreviewTelemetryMute              holds the telemetry mute while the preview is mounted
 *   > ReadOnlySessionScope            the surrounding session, narrowed to a read-only observer
 *     > ShellContextProvider          { variant: 'preview', scenarioNow: <the chosen moment> }
 *       > BrandThemeProvider          the exercise's brand tokens (a plain context + CSS vars)
 *         > SocialBrandScope          --pulse-ac from the brand, exactly as App.tsx mounts it
 *           > MemorySocialNavigationProvider   the channel's location lives in memory
 *             > SocialChannel         the real channel
 *
 * Each layer is the same one the participant app stacks, in the same order, so the
 * preview shows what a participant sees -- the exercise's REAL feed, read through
 * the same exercise-scoped data path (COR-001) -- not a picture of it. There is no
 * second implementation of any participant surface here.
 *
 * ## Why it cannot write (AC: "Read-only")
 * Three independent answers all say "no write", so no write control depends on
 * every other one remembering to ask:
 *  1. `variant: 'preview'` -- `affordancesAvailable('preview')` is false, so the
 *     composer, the Post button, the compose modal, the reply box, the Following
 *     tab and the live "new posts" stream are ABSENT (not disabled), and a post
 *     card's like / repost / reply render as inert counts, not buttons.
 *  2. `ReadOnlySessionScope` -- the controls that ask the SESSION instead (follow,
 *     like, repost) see `isReadOnly: true` and no persona, so they are absent too.
 *     This is what keeps a build on mock data, whose bound session IS a participant
 *     persona, from showing the staff user a Follow button.
 *  3. `PreviewTelemetryMute` -- the one thing the channel does on its own, with no
 *     control to hide, is emit participant-kind telemetry (a `view` per feed /
 *     thread / profile). A preview must not report on a participant who does not
 *     exist, so the sink is muted while this is mounted.
 *
 * ## Why links stay inside the preview (AC: "Real channel")
 * `MemorySocialNavigationProvider` keeps the channel's location in React state and
 * never reads or writes `window.location` / `window.history`, so opening a thread,
 * profile or hashtag -- or typing an unknown path -- moves the CHANNEL, never the
 * staff page's address bar. It starts at `/home`.
 *
 * ## Scenario time (COR-053)
 * `scenarioNow` is the instant of the moment the staff strip has selected, handed
 * to the channel through the shell mount contract like any other mount. Every
 * participant-visible time here is scenario time; nothing reads the wall clock.
 *
 * ## Overlays (nothing to fight the staff shell)
 * This does NOT mount `ShellLayout`, so the preview has none of the participant
 * shell's own layers: no persistent alert bar, no pause / EndEx overlay
 * (`data-shell-layer`), no compliance banners. The only participant modal that can
 * open inside it is the media viewer, which already stands aside for any other
 * `aria-modal` layer (`core/a11y/modalPriority`), so a staff dialog always wins.
 *
 * ## Two worlds (D0 §2, SHELL-CONTRACT §4)
 * World: PARTICIPANT. This file imports NO COBRA (`@/theme/*`), NO staff tokens
 * (`staffShellTokens`) and NO MUI -- `previewStubTwoWorlds.test.ts` scans this
 * file's real source text for exactly that. The staff frame around it is the
 * deliberate, labelled exception; this file is the thing inside it that must not
 * pick the frame up.
 */

import { useLayoutEffect, useMemo } from 'react'
import { ReadOnlySessionScope } from '@/core/auth'
import { muteTelemetry } from '@/core/telemetry'
import { BrandThemeProvider } from '@/features/participant-shell/BrandThemeProvider'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { SocialChannel } from '@/features/social'
import { HOME_PATH } from '@/features/social/layout/socialNavigation'
import { MemorySocialNavigationProvider } from '@/features/social/layout/SocialNavigationProvider'
import { SocialBrandScope } from '@/features/social/theme/SocialBrandScope'

/** The shell variant this host ALWAYS mounts the channel under (COR-041). */
const PREVIEW_VARIANT: ShellVariant = 'preview'

/** Where the channel starts. A literal array so its identity is stable across renders. */
const INITIAL_ENTRIES: readonly string[] = [HOME_PATH]

export interface PreviewChannelHostProps {
  /** The scenario-time instant of the moment the staff strip selected (COR-053). */
  scenarioNow: Date
}

/**
 * Holds the telemetry mute while mounted. A LAYOUT effect, and rendered as the FIRST
 * sibling, so it has taken effect before any later sibling's layout or passive
 * effects run (React runs effects in tree order, children before parents) -- the
 * channel's first `view` event is therefore already muted.
 */
function PreviewTelemetryMute() {
  useLayoutEffect(() => muteTelemetry(), [])
  return null
}

export function PreviewChannelHost({ scenarioNow }: PreviewChannelHostProps) {
  // A new object only when the moment changes: the channel (and every memoized feed
  // row) must not re-render because the staff strip did.
  const mount = useMemo<ShellMountProps>(
    () => ({ variant: PREVIEW_VARIANT, scenarioNow }),
    [scenarioNow],
  )

  return (
    <>
      <PreviewTelemetryMute />
      <ReadOnlySessionScope>
        <ShellContextProvider value={mount}>
          <BrandThemeProvider>
            <SocialBrandScope>
              <MemorySocialNavigationProvider initialEntries={INITIAL_ENTRIES}>
                <SocialChannel />
              </MemorySocialNavigationProvider>
            </SocialBrandScope>
          </BrandThemeProvider>
        </ShellContextProvider>
      </ReadOnlySessionScope>
    </>
  )
}
