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
 *   ExerciseContextProvider  — exercise scope (useExerciseContext / the
 *                              controller identity + persona reads bind to it).
 *   > ToolstripProvider      — the shell-owned toolstrip registry the console
 *                              registers its "Personas" tool into (D7-011).
 *   > ActivePersonaProvider  — the ONE shared "operating as" seam the picker
 *                              writes and the composer/context-panel read
 *                              (persona-operation/02).
 *   > StaffShellFrame        — the COBRA theme boundary + Cadence chrome
 *                              (header + toolstrip dock); ControllerConsole is
 *                              its work-area child.
 *
 * THE WIRED LOOP (the thing this wave demonstrates):
 *   ⌘K / Personas tool → CommandPalette → PersonaPicker (search/select) sets
 *   the active persona → the persona-dock host opens with the PersonaContextPanel
 *   + PersonaComposer for that persona → the controller fires → PersonaComposer
 *   publishes through the shipped `createPost` (origin controller-as-persona,
 *   actingHumanId = this controller, scenario-time stamped, sanitized,
 *   telemetried) and its `onPublished` appends the new Post to the shared
 *   `postStore` → the participant Social feed at `/shell` reads that store live
 *   and shows the post at the top (scenario time; the controller origin is never
 *   in the participant view — `toParticipantView` strips it). COR-018/SOC-003/
 *   COR-053/NFR-004/XC-004/COR-001 all hold by construction of the reused seams.
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
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
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
 * The console content, inside all four providers so it may read the controller
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
 * The `/console` route element. See the module header for the provider stack and
 * the wired loop.
 */
export function ControllerConsoleRoute() {
  return (
    <ExerciseContextProvider>
      <ToolstripProvider>
        <ActivePersonaProvider>
          <StaffShellFrame
            header={<StaffHeader surfaceName="Controller Console" />}
            toolstrip={<Toolstrip />}
          >
            <ControllerConsoleContent />
          </StaffShellFrame>
        </ActivePersonaProvider>
      </ToolstripProvider>
    </ExerciseContextProvider>
  )
}
