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
 * DEMO-POLISH WAVE 3 - THE MAIN-AREA SLOTS (docs/features/demo-polish/implementation.md
 * section 4.2; stories 17-20). `ControllerConsole` lays out a LIVE WORLD | RUN SHEET split
 * and renders whatever this route hands it through two render-prop slots; the route is
 * where the independently-built stories meet:
 *
 *   liveWorldSlot  -> C2's `LiveWorldColumn`. Its "Reply as..." (button, or R on a focused
 *                     row) arrives as a `ReplyTarget`. The console's `ctx.openComposer`
 *                     accepts a `replyTo` but does NOT keep it, so THIS route keeps it
 *                     (`useReplyTarget`) and passes it to C1's `PersonaComposer`
 *                     (`replyTo` / `onClearReply`) through `dockSlots`. `onReplyAs` therefore
 *                     does both: `requestReply(target)` then `ctx.openComposer({ replyTo })`.
 *                     With no persona active the console opens the command palette instead
 *                     (never an empty dock) and the target waits there for the pick; the
 *                     hook documents exactly when a target is dropped (composer (x), reply
 *                     sent, dock closed via `onDockClose`, persona or exercise changed,
 *                     palette dismissed without a pick).
 *   runSheetSlot   -> inject-queue 07's `RunSheetPanel` (#453; it REPLACED demo-polish C3's
 *                     browser-only run sheet, #438): the server-side scripted-posts queue,
 *                     prop-less, beside `RunSheetMockPauseBridge` (mock mode only) so PAUSE
 *                     INJECTS / FREEZE set through PausePill reach the mock queue.
 *                     `ControllerConsoleRoute.test.tsx` proves the REAL route mounts it.
 *
 * STABILITY. The console re-renders constantly (the review queue's 1 s scenario-clock tick,
 * every swamped-mode change, each toolstrip toggle) and calls both slot functions each time.
 * Two things keep that cheap: every slot function and callback here has a stable identity
 * (`useCallback` / `useMemo` / module level), and each slot's ROOT is `memo`ized with stable
 * props - `RunSheetSlot` (below) takes no props, and `LiveWorldSlot` takes only `ctx`,
 * `requestReply` and `isRowRemoved` and owns the one `onReplyAs` callback. A console re-render
 * therefore reconciles two memo boundaries instead of re-rendering every run-sheet row and
 * every live-world row. (`isRowRemoved` is deliberately a NEW identity per takedown:
 * the column's memoized rows must re-render then.)
 *
 * C5's takedown rides the live-world column: `renderRowActions={renderTakedown}` (module
 * level, stable) mounts "Take down" on each row, and `isRowRemoved` (from
 * `useIsRowRemoved()`) marks removed rows REMOVED and disables "Reply as..." on them.
 * PE-FE's persona edit button is the `actionsSlot` of `PersonaContextPanel` in the dock.
 *
 * DEMO-POLISH C6 - PREVIEW AS PARTICIPANT + STARTEX / ENDEX (docs/features/demo-polish/
 * 23-preview-and-startex.md).
 *
 *   Preview as participant  -> `PreviewProvider` wraps the frame; `ConsoleStaffHeader` passes
 *                     `previewActive` / `onTogglePreview` to `StaffHeader` (the header shows the
 *                     toggle only when it is handed a handler); `ConsoleWorkArea` swaps the
 *                     console for `PreviewAsParticipant` while the preview is staged - the same
 *                     XOR `EvaluatorDashboardRoute` uses. The console UNMOUNTS while the preview
 *                     is up: its React state is gone on Exit (what survives and what is lost is
 *                     listed in `features/staffShell/README.md`).
 *   StartEx / EndEx  -> `lifecycleSlot={<ExerciseLifecycleControl />}` on `ControllerConsole`
 *                     (its title row). The control is controller-only on the SIGNED-IN SESSION's
 *                     role and renders nothing with no session.
 *
 * SESSION. This route does NOT mount a `SessionProvider` of its own, but one IS in the stack:
 * `app-shell/routes.tsx` hoists `ExerciseContextProvider > SessionProvider` above
 * `RoleAwareEntry`, so every staff route sits under the real session. The console's operating
 * identity for attribution is still `useControllerIdentity()` (a Phase-1 mock). The PREVIEW
 * needs the hoisted session (the real participant channel reads it, and narrows it to a
 * read-only observer); a test that mounts this route directly and opens the preview must supply
 * a `SessionProvider` itself, and one whose session role is `controller` to see StartEx / EndEx.
 */

import { memo, useCallback, useMemo } from 'react'
import type { ReplyTarget } from '@/features/social'
import { useExerciseContext, type ExerciseStatus } from '@/core/exerciseContext'
import { ToolstripProvider, useToolstrip } from '@/features/staffShell/toolRegistry'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { pauseStatePillConfig } from '@/features/staffShell/components/statePillConfig'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { PreviewProvider, usePreview } from '@/features/staffShell/previewContext'
import { PreviewAsParticipant } from '@/features/staffShell/components/PreviewAsParticipant'
import { ExerciseLifecycleControl } from './lifecycle'
import { usePauseState } from './hooks/usePauseState'
import { postStore } from '@/features/social/services/postStore'
import { EngineDraftEditComposer, type ReviewQueueEditSlotProps } from './engine'
import { ControllerConsole, type ConsoleSlotContext } from './components/ControllerConsole'
import type { CommandPalettePersonaSlot } from './console/CommandPalette'
import { PERSONAS_TOOL_ID, type PersonaDockSlots } from './console/personaDockHost'
import { useControllerIdentity } from './identity/controllerIdentity'
import { ActivePersonaProvider, useActivePersona } from './hooks/useActivePersona'
import { useReplyTarget } from './hooks/useReplyTarget'
import { LiveWorldColumn, type LiveWorldPost } from './liveWorld'
import { TakedownAction } from './liveWorld/TakedownAction'
import { useIsRowRemoved } from './hooks/useRemovedPostIds'
import { PersonaEditButton } from './personaEdit'
import { PersonaPicker } from './components/PersonaPicker'
import { PersonaComposer } from './components/PersonaComposer'
import { PersonaContextPanel } from './components/PersonaContextPanel'
import { RunSheetMockPauseBridge, RunSheetPanel } from './runSheet'

/**
 * The RUN SHEET slot's root (inject-queue story 07, #453, which replaced demo-polish C3's
 * browser-only run sheet): the server-side scripted-posts queue, mounted into
 * `ControllerConsole`'s `runSheetSlot` - the same render-prop seam C4 defined for the live
 * world. `RunSheetPanel` is self-contained (no props; it reads the exercise scope, the
 * personas and the queue itself), so the slot context is not needed.
 * `RunSheetMockPauseBridge` is mock-mode only (it renders nothing live): it hands the pause
 * tier set through PausePill to the mock queue so PAUSE INJECTS / FREEZE work under
 * `npm run dev`.
 *
 * `memo`ized with no props, and `renderRunSheet` is module level, so the console's 1 s
 * review-queue tick reconciles this one boundary instead of re-rendering every row.
 */
const RunSheetSlot = memo(function RunSheetSlot() {
  return (
    <>
      <RunSheetPanel />
      <RunSheetMockPauseBridge />
    </>
  )
})

const renderRunSheet = () => <RunSheetSlot />

/**
 * C5's per-row "Take down" control for the live-world column. MODULE-LEVEL so its
 * identity never changes: the column's rows are memoized and the slot runs on every
 * console render (review queue, swamped mode).
 */
const renderTakedown = (post: LiveWorldPost) => <TakedownAction post={post} />

/**
 * The StartEx / EndEx control for `ControllerConsole`'s `lifecycleSlot` (demo-polish C6). A MODULE-
 * LEVEL element, like `renderRunSheet` above: the console re-renders constantly (the review queue's
 * 1 s tick, every swamped-mode change) and an element built inside the route would be a new object
 * each time, re-rendering the control for nothing. It takes no props, so one shared element is
 * exact.
 */
const LIFECYCLE_SLOT = <ExerciseLifecycleControl />

interface LiveWorldSlotProps {
  readonly ctx: ConsoleSlotContext
  readonly requestReply: (target: ReplyTarget) => void
  readonly isRowRemoved: (post: { readonly id: string }) => boolean
}

/**
 * The LIVE WORLD slot's root (C2 + C5). "Reply as..." sets the reply target AND opens the
 * composer in one go: `ctx.openComposer` selects the active persona and opens the dock, or
 * opens the palette when there is no persona to open it for (the target waits for the pick).
 * `memo`ized, and `onReplyAs` is built once per (`ctx`, `requestReply`) - both stable for the
 * life of the console - so the console's 1 s tick does not re-render the column.
 */
const LiveWorldSlot = memo(function LiveWorldSlot({
  ctx,
  requestReply,
  isRowRemoved,
}: LiveWorldSlotProps) {
  const onReplyAs = useCallback(
    (target: ReplyTarget) => {
      requestReply(target)
      ctx.openComposer({ replyTo: target })
    },
    [ctx, requestReply],
  )
  return (
    <LiveWorldColumn
      onReplyAs={onReplyAs}
      renderRowActions={renderTakedown}
      isRowRemoved={isRowRemoved}
    />
  )
})

/**
 * The console content, inside the provider stack so it may read the controller
 * identity + the active persona and build the wired palette/dock slots.
 */
function ControllerConsoleContent() {
  const identity = useControllerIdentity()
  const { exerciseId } = useExerciseContext()
  const { activePersona } = useActivePersona()
  // The command palette's open state IS the "Personas" tool's active state (see
  // `ControllerConsole`); the reply target needs it to know a pick is still pending.
  const { isActive } = useToolstrip()
  const paletteOpen = isActive(PERSONAS_TOOL_ID)

  // C5: which live-world rows are taken down. A new predicate identity per removal (and
  // only then), so the column re-renders on a takedown - from this console or another
  // controller's `PostRemoved` - and disables "Reply as..." / R on the removed row.
  const isRowRemoved = useIsRowRemoved()

  // The post being replied to ("Reply as..." in the live world), held here because the
  // console's `openComposer` does not keep it. See `useReplyTarget` for when it is dropped.
  const { replyTo, requestReply, clearReply } = useReplyTarget({
    exerciseId,
    activePersonaId: activePersona?.id ?? null,
    paletteOpen,
  })

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
          contextPanel: (
            <PersonaContextPanel
              persona={activePersona}
              actionsSlot={<PersonaEditButton persona={activePersona} />}
            />
          ),
          composer: (
            <PersonaComposer
              activePersona={activePersona}
              actingHumanId={identity.actingHumanId}
              callSign={identity.callSign}
              onPublished={post => postStore.appendPost(post)}
              replyTo={replyTo ?? undefined}
              onClearReply={clearReply}
              // A draft remounted after the dock closed comes back WITH its reply: the route
              // dropped the target on close, so the composer asks for it back.
              onRestoreReply={requestReply}
            />
          ),
        }
        : undefined,
    [activePersona, identity.actingHumanId, identity.callSign, replyTo, clearReply, requestReply],
  )

  // LIVE WORLD slot (C2 + C5): stable between takedowns - `requestReply` never changes, `ctx`
  // is stable for the life of the console, and `isRowRemoved` changes identity only when a
  // post is taken down.
  const liveWorldSlot = useCallback(
    (ctx: ConsoleSlotContext) => (
      <LiveWorldSlot ctx={ctx} requestReply={requestReply} isRowRemoved={isRowRemoved} />
    ),
    [requestReply, isRowRemoved],
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
      liveWorldSlot={liveWorldSlot}
      runSheetSlot={renderRunSheet}
      onDockClose={clearReply}
      lifecycleSlot={LIFECYCLE_SLOT}
    />
  )
}

/**
 * The work area: the console, or - while "Preview as participant" is staged - the preview stage
 * in its place (the same XOR the evaluator dashboard uses; staff-shell story 04).
 */
function ConsoleWorkArea() {
  const { active } = usePreview()
  return active ? <PreviewAsParticipant /> : <ControllerConsoleContent />
}

/**
 * The lifecycle statuses in which the WORLD IS RUNNING - the only ones a pause tier describes. A
 * tier (INJECTS / ENGINE PAUSED, WORLD FROZEN) means "the exercise is live but held"; before
 * StartEx there is nothing to hold (the server refuses a Freeze then) and after EndEx there is
 * nothing left running. `paused` is the lifecycle's own held state and `active` its legacy alias.
 */
const WORLD_RUNNING_STATUSES: readonly ExerciseStatus[] = ['live', 'paused', 'active']

/**
 * The staff header for the console: the shared `StaffHeader` with its exercise-
 * state pill driven by the world-steering tiered-pause tier (D7-010) — while a
 * tier is active AND THE WORLD IS RUNNING the pill shows INJECTS PAUSED / ENGINE
 * PAUSED / WORLD FROZEN (amber), otherwise the lifecycle status (LIVE / STAGED /
 * ENDEX / …). Reads `usePauseState()` here (inside the provider stack) rather
 * than in the shared header, so the header stays free of the controller-only
 * pause/identity seam.
 *
 * WHY THE TIER ONLY OVERRIDES WHILE THE WORLD IS RUNNING (Gate-2 W-2). The override wins over the
 * lifecycle status, and a tier set before EndEx is still recorded after it - so without this rule
 * a controller who froze the world and then pressed End exercise would see WORLD FROZEN on the
 * header while the exercise had in fact ended, hiding the state change from the very pill that
 * exists to show it. The rule is a pure DISPLAY rule: EndEx moves the pill to ENDEX whatever tier
 * is recorded. (The alternative - resetting the tier on a successful EndEx - would make the
 * lifecycle control issue a second server write, couple two steering features, and still miss
 * the exercise being ended from another console.)
 */
function ConsoleStaffHeader() {
  const { isPaused, label } = usePauseState()
  const { status } = useExerciseContext()
  const { active, toggle } = usePreview()
  const showTier = isPaused && WORLD_RUNNING_STATUSES.includes(status)
  return (
    <StaffHeader
      surfaceName="Controller Console"
      stateOverride={showTier ? pauseStatePillConfig(label) : undefined}
      previewActive={active}
      onTogglePreview={toggle}
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
        <PreviewProvider>
          <StaffShellFrame
            header={<ConsoleStaffHeader />}
            toolstrip={<Toolstrip />}
          >
            <ConsoleWorkArea />
          </StaffShellFrame>
        </PreviewProvider>
      </ActivePersonaProvider>
    </ToolstripProvider>
  )
}
