/**
 * features/controller/ControllerConsoleRoute.tsx
 * ---------------------------------------------------------------------------
 * The E7 Simcell Operator console ROUTE composition — the serial Wave-1
 * INTEGRATION seam that wires the five independently-built stories into one
 * working surface (see docs/features/console-shell/01-toolstrip-flyouts.md
 * "Wave-1 integration seam"). Mounted at `/console` by App.tsx; mirrors the
 * shipped `/evaluator` staff composition.
 *
 * PROVIDER STACK (staff world — COBRA lives in StaffShellFrame):
 *   ToolstripProvider        — the shell-owned toolstrip registry the console
 *                              registers its "Personas" tool into (D7-011).
 *   > ActivePersonaProvider  — the ONE shared "operating as" seam the picker
 *                              writes and the composer/context-panel read
 *                              (persona-operation/02).
 *   > StaffShellFrame        — the COBRA theme boundary + Cadence chrome
 *                              (header + toolstrip dock); ControllerConsole is
 *                              its work-area child.
 *
 * NO `ExerciseContextProvider` HERE — deliberately (CR-001). The exercise scope
 * this console reads (`useExerciseContext`, the identity + persona reads) comes
 * from the ONE provider hoisted in `features/app-shell/routes.tsx`. This
 * composition used to mount a second one, on the reasoning that re-resolving the
 * same host/auth-resolved scope was harmless. It is not: the cross-exercise
 * switcher (`ExerciseSwitcherSlot`) renders as a SIBLING of `StaffRouteTree`, so
 * its `useExerciseScopeRefresh()` (staff-navigation/04, COR-073) reaches the
 * HOISTED provider and commits the new scope atomically, without a remount. A
 * nested provider therefore never hears about the switch — the header badge
 * would keep naming the old exercise while `resetQueries()` repopulated the
 * console from the new one. A test that mounts this route directly must supply
 * the provider itself.
 *
 * THE WIRED LOOP (the thing this wave demonstrates):
 *   ⌘K / Personas tool → CommandPalette → PersonaPicker (search/select) sets
 *   the active persona → the persona-dock host opens with the PersonaContextPanel
 *   + PersonaComposer for that persona → the controller fires → `useComposeAsPersona`
 *   publishes through the shipped `createPost` (origin controller-as-persona,
 *   actingHumanId = this controller, scenario-time stamped, sanitized,
 *   telemetried) and its `onPublished` appends the new Post to the shared
 *   `postStore` (this console's OWN-TAB optimistic view only). REACHING an
 *   actual participant is a separate, mode-dependent path: under mock data the
 *   in-tab `postStore` append is what the participant feed's real-time source
 *   (`feedStreamSource`'s mock adapter, feeds-discovery/04) buffers behind the
 *   "▲ N new posts" pill; against the live backend `useComposeAsPersona`
 *   ADDITIONALLY fire-and-forgets `livePostActions.publishPost` (UAT fix), so
 *   the post is actually PERSISTED and reaches every participant via
 *   `useFeed`'s baseline + the SignalR-sourced pill — the controller origin is
 *   never in the participant view either way (`toParticipantView` strips it).
 *   COR-018/SOC-003/COR-053/NFR-004/XC-004/COR-001 all hold by construction of
 *   the reused seams.
 *
 * SERIAL INTEGRATION — the engine review cockpit's edit composer (feature:
 * engine-review-cockpit). `ControllerConsole` docks `<ReviewQueue>` itself; this
 * composition root supplies ONLY its `editSlot` render prop
 * (`EngineDraftEditComposer`), mirroring how `dockSlots`/`renderPersonaResults`
 * are supplied here rather than imported by the consult-on-demand components
 * themselves. The composer's `onSubmit` is `ReviewQueue`'s OWN `submitEdit`,
 * which routes through `useReviewQueue().edit()` → `reviewActions.edit()` →
 * the shipped `createPost` with `origin: 'engine'` (sanitized, NFR-004) — there
 * is no second publish path here and no `'engine-edited'` origin.
 *
 * Note: `SessionProvider` is deliberately NOT in this stack — the console's
 * operating identity is `useControllerIdentity()` (a Phase-1 mock; the one mock
 * session is a participant), exactly as the shipped `/evaluator` route mounts no
 * session either. Preview-as-participant (a shell-global capability) is a later
 * console story and is not wired here (Wave-1 scope guard).
 */

import { useCallback, useMemo } from 'react'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { pauseStatePillConfig } from '@/features/staffShell/components/statePillConfig'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { usePauseState } from './hooks/usePauseState'
import { postStore } from '@/features/social/services/postStore'
import { EngineDraftEditComposer, type ReviewQueueEditSlotProps } from './engine'
import { ControllerConsole } from './components/ControllerConsole'
import type { CommandPalettePersonaSlot } from './console/CommandPalette'
import type { PersonaDockSlots } from './console/personaDockHost'
import { useControllerIdentity } from './identity/controllerIdentity'
import { ActivePersonaProvider, useActivePersona } from './hooks/useActivePersona'
import { PersonaPicker } from './components/PersonaPicker'
import { PersonaComposer } from './components/PersonaComposer'
import { PersonaContextPanel } from './components/PersonaContextPanel'

/**
 * The console content, inside the provider stack so it may read the controller
 * identity + the active persona and build the wired palette/dock slots.
 */
function ControllerConsoleContent() {
  const identity = useControllerIdentity()
  const { activePersona } = useActivePersona()

  // The ⌘K palette's PERSONAS section renders persona-operation/02's picker.
  // The picker sets the active persona itself (via useActivePersona); `onSelect`
  // then hands the id back to the palette so it closes and the dock opens.
  const renderPersonaResults = useCallback(
    ({ query, onSelectPersona }: CommandPalettePersonaSlot) => (
      <PersonaPicker query={query} onSelect={persona => onSelectPersona(persona.id)} />
    ),
    [],
  )

  // The persona-dock host content for the active persona: the context panel
  // (who you're posting as) above the composer (the fire surface). `onPublished`
  // appends the created Post to the shared store the participant feed reads live.
  const dockSlots = useMemo<PersonaDockSlots | undefined>(
    () =>
      activePersona
        ? {
          contextPanel: <PersonaContextPanel persona={activePersona} />,
          composer: (
            <PersonaComposer
              activePersona={activePersona}
              actingHumanId={identity.actingHumanId}
              callSign={identity.callSign}
              onPublished={post => postStore.appendPost(post)}
            />
          ),
        }
        : undefined,
    [activePersona, identity.actingHumanId, identity.callSign],
  )

  // The docked review queue's edit composer — a stable render-prop identity so
  // `<ReviewQueue>` doesn't remount its edit-slot host on every console render.
  const reviewEditSlot = useCallback(
    (props: ReviewQueueEditSlotProps) => <EngineDraftEditComposer {...props} />,
    [],
  )

  return (
    <ControllerConsole
      renderPersonaResults={renderPersonaResults}
      dockSlots={dockSlots}
      reviewEditSlot={reviewEditSlot}
    />
  )
}

/**
 * The staff header for the console: the shared `StaffHeader` with its exercise-
 * state pill driven by the world-steering tiered-pause tier (D7-010) — while a
 * tier is active the pill shows INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN
 * (amber), otherwise the lifecycle status (LIVE / STAGED / …). Reads
 * `usePauseState()` here (inside the provider stack) rather than in the shared
 * header, so the header stays free of the controller-only pause/identity seam.
 */
function ConsoleStaffHeader() {
  const { isPaused, label } = usePauseState()
  return (
    <StaffHeader
      surfaceName="Controller Console"
      stateOverride={isPaused ? pauseStatePillConfig(label) : undefined}
    />
  )
}

/**
 * The `/console` route element. See the module header for the provider stack and
 * the wired loop.
 */
export function ControllerConsoleRoute() {
  return (
    <ToolstripProvider>
      <ActivePersonaProvider>
        <StaffShellFrame
          header={<ConsoleStaffHeader />}
          toolstrip={<Toolstrip />}
        >
          <ControllerConsoleContent />
        </StaffShellFrame>
      </ActivePersonaProvider>
    </ToolstripProvider>
  )
}
