/**
 * features/controller/components/ControllerConsole.tsx
 * ---------------------------------------------------------------------------
 * The controller console FRAME CONTENT — the staff surface mounted in the
 * shared staff shell's work area (feature: console-shell, story 01 — the
 * KEYSTONE of the Wave-1 integration; D5-004/015/016/017/018, D7-011, COR-018;
 * see docs/features/console-shell/01-toolstrip-flyouts.md).
 *
 * At integration, `App.tsx`'s `/console` route mounts
 * `ExerciseContextProvider > ToolstripProvider > StaffShellFrame` with this
 * component as `children` (mirroring the shipped `/evaluator` composition).
 * This component does NOT draw its own toolstrip — it REGISTERS its
 * consult-on-demand tool(s) into the ONE shell-owned toolstrip dock via
 * `useRegisterSurfaceTool()` (`@/features/staffShell/toolRegistry`, D7-011) and
 * renders its own flyout(s) keyed on `useToolstrip().isActive(id)`.
 *
 * ## What this KEYSTONE story owns
 *  - registers the "Personas" consult-on-demand surface tool (icon + label +
 *    tooltip + a never-color-only count badge);
 *  - the ⌘K / Ctrl+K command palette (open/close + key binding here; shell in
 *    `../console/CommandPalette`);
 *  - the persona-dock host mount slot (`../console/personaDockHost`), empty of
 *    persona content until integration;
 *  - the mock controller identity seam (`../identity/controllerIdentity`),
 *    surfaced on the console chrome + consumed by persona-operation as an INPUT.
 *
 * ## SERIAL INTEGRATION — the engine-review-cockpit is docked HERE
 * (feature: engine-review-cockpit, integration seam; D5-017 "continuous-watch
 * surfaces get permanent space, not a toolstrip flyout"). The work area is a
 * horizontal split:
 *   - the `<EngineControlBar>` chrome strip spans the FULL width at the top
 *     (the kill switch, the degrade indicator, the CTL-034 demand meter, the
 *     inline "N need review / N timers <60s" indicator, and `<SwampedModeToggle>`);
 *   - below it, the main content region (flex 1 — the existing header/⌘K hint/
 *     persona-dock host mount) sits LEFT of a PERMANENT 336px right column
 *     hosting `<ReviewQueue>` — a docked column, NOT a toolstrip flyout, so it
 *     never competes with the consult-on-demand "Personas" tool for the same
 *     extension point.
 * This component also mounts one invisible `<DraftTimerDriver>` per
 * `CountingDown` review item so every outstanding engine draft's countdown
 * actually ticks toward its terminal outcome (auto-HOLD by default; auto-send
 * only under swamped(lead) mode on a still-effectively-Delayed-auto draft — see
 * `DraftTimerDriver`'s module header for the full composition). The persona
 * "post as persona" flow above is UNCHANGED by this integration.
 *
 * SCOPE GUARD: this does NOT build the MSEL rail, storylines, rumor tracker,
 * trainee monitor or break-fiction — those remain separate features/stories.
 * The live world and the run sheet are mounted INTO the main area through the
 * `liveWorldSlot` / `runSheetSlot` render props below (demo-polish C4); this
 * component owns only their layout.
 *
 * ## MAIN-AREA SLOTS (demo-polish C4, docs/features/demo-polish/20-console-cleanup.md)
 * Below the header, shortcut strip and world-steering controls the main region
 * is a two-column split — LIVE WORLD | RUN SHEET — at viewport widths >= 1280px,
 * and the two stacked (live world first) below that. Each column is a labelled
 * `section` landmark that hosts whatever its slot renders. The grid takes the
 * height left under the steering controls (`flex: 1; minHeight: 0`, rows of at
 * least 320px) and each section is a shrinkable flex column, so a slot root using
 * `flex: 1; minHeight: 0; overflow: auto` scrolls INSIDE its own panel; the slot
 * still owns its title and internals. Each slot is a render prop receiving a
 * {@link ConsoleSlotContext} whose `openComposer` selects a persona (into the
 * route's active-persona state) and opens the persona dock. With NEITHER slot
 * supplied the area shows one concise status line (not placeholder panels); with
 * ONE supplied, that column takes the full width.
 *
 * `ControllerConsoleRoute` (orchestrator-owned) supplies the slots and the
 * reply-target state; this file never imports the live-world or run-sheet code.
 * The console must be mounted inside the route's `<ActivePersonaProvider>`
 * (`useActivePersona()` throws otherwise): `openComposer` selects into it so the
 * dock the route derives from the active persona is the persona that was asked for.
 *
 * ## ENGINE SETTINGS tool (feature: autonomy-safety, story 06)
 * A sibling "ENGINE" surface tool, registered the same way as "Personas"
 * (`useRegisterSurfaceTool()`, no badge) — activating it opens
 * `<EngineSettingsPanel>`, keyed on `isActive(ENGINE_SETTINGS_TOOL_ID)`. This
 * is the console admin surface for the exercise autonomy default + tier-policy
 * mode (`../engine`'s `useEngineSettings`, story 05's `GET/POST
 * /api/engine/settings`) — the same one-flyout-at-a-time toolstrip contract,
 * not a new extension point. The persona-dock host is closed whenever ENGINE
 * activates — the toolstrip's one-flyout-at-a-time contract only governs
 * `activeToolId`, but the persona-dock host's `open` is a SEPARATE
 * `dockPersonaId !== null` flag (set by picking a persona from the palette),
 * so without this the engine panel could paint over a still-mounted, still-
 * Tab-reachable persona composer instead of replacing it.
 *
 * ## USAGE tool (feature: engine-telemetry-tuning, story 03c)
 * A second sibling surface tool, registered/gated exactly like ENGINE above
 * — activating it opens `<UsagePanel>`, keyed on
 * `isActive(ENGINE_USAGE_TOOL_ID)`. This is the console's live-ops AI-
 * generation volume/cost view (`../engine`'s `useEngineUsage`, story 03a's
 * `GET /api/engine/usage`) — the SAME shared `activeToolId` already makes
 * ENGINE and USAGE mutually exclusive (one flyout open at a time across the
 * whole toolstrip, D7-011), and the persona-dock host is closed whenever
 * EITHER activates, for the identical obscured-composer reason ENGINE's own
 * note above states.
 *
 * ## Entry points to "post as persona" (both funnel to the persona-dock host)
 *  1. ⌘K / Ctrl+K, or activating the "Personas" toolstrip tool → the command
 *     palette opens (its PERSONAS section is the search/select entry point).
 *  2. Selecting a persona in the palette → the palette closes and the
 *     persona-dock host opens for that persona (composer wired at integration).
 * The palette-open state is unified with the "Personas" tool's active state so
 * the toolstrip button reflects the palette being open (one extension point).
 *
 * ## ⌘K yields to other modals (demo-polish integration, Wave 3 Gate-2 L-11)
 * The chord is IGNORED while any `[aria-modal="true"]` layer outside the console is
 * mounted - a run-sheet dialog, PE-FE's persona edit dialog, the pause-tier popover, any
 * shell-level overlay that declares itself modal (`core/a11y/modalPriority.ts`
 * `hasOtherModalMounted`, measured from the console root so the palette's own panel never
 * counts). Opened over such a layer the palette would sit hidden behind it (same z-index,
 * earlier in the DOM) while its focus-on-open fought that layer's focus trap. A layer that
 * is deliberately NON-modal does not declare `aria-modal`, so ⌘K still works over it: C5's
 * takedown step is one - the palette opens over it and focus landing there closes the step.
 * (The shell's Pause / EndEx overlay is the participant `OverlayLayer`; it never mounts on
 * /console, where the pause control is the pause-tier popover above.)
 *
 * ## `onDockClose` (the route's reply target)
 * `ControllerConsoleRoute` holds the reply target of "Reply as…" and feeds it to the
 * composer; this component reports back when an OPEN dock closes, for any reason (Esc /
 * X, an ENGINE / USAGE flyout taking over, an exercise switch), so the target never
 * outlives the dock that showed it.
 *
 * World: staff (COBRA/Cadence) — everything here is COBRA chrome; the
 * participant OUTPUT (a published post) is `persona-operation`'s / the engine
 * review queue's via `createPost` and is never drawn here. Never a participant
 * surface (XC-002).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Stack, Typography, useMediaQuery } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartLine,
  faGear,
  faKeyboard,
  faMasksTheater,
  faTowerBroadcast,
} from '@fortawesome/free-solid-svg-icons'
import { useStaffPersonas, type StaffPersona } from '@/features/personas'
import { useExerciseContext } from '@/core/exerciseContext'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'
import { useRegisterSurfaceTool, useToolstrip } from '@/features/staffShell/toolRegistry'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { CommandPalette, type CommandPalettePersonaSlot } from '../console/CommandPalette'
// The component lives in `personaDockHost.tsx`; the shared ids/types in the
// sibling `personaDockHost.ts`. A bare `./personaDockHost` specifier resolves
// to the `.ts`, so the component is imported with its explicit `.tsx`
// extension (allowed by `allowImportingTsExtensions`), while `PERSONAS_TOOL_ID`
// comes from the `.ts`.
import { PersonaDockHost } from '../console/personaDockHost.tsx'
import { PERSONAS_TOOL_ID, type PersonaDockSlots } from '../console/personaDockHost'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { useActivePersona } from '../hooks/useActivePersona'
import { EscalationDial } from './steering/EscalationDial'
import { PausePill } from './steering/PausePill'
import {
  DraftDisposition,
  DraftTimerDriver,
  ENGINE_SETTINGS_TOOL_ID,
  ENGINE_USAGE_TOOL_ID,
  EngineControlBar,
  EngineSettingsPanel,
  ReviewQueue,
  UsagePanel,
  useEngineControl,
  useReviewQueue,
  useSwampedMode,
  type DelayedAutoCountdown,
  type EngineReviewItem,
  type ReviewQueueEditSlotProps,
} from '../engine'
import type { ReplyTarget } from '@/features/social'

/** The docked review-queue column's fixed width (D5 §6 "336px, sole tenant"). */
const REVIEW_QUEUE_WIDTH_PX = 336

/** Viewport width at which Live world | Run sheet sit side by side (C4 AC). */
const SLOT_SPLIT_MIN_WIDTH_PX = 1280

/** Smallest height a main-area slot row is given before the region scrolls. */
const SLOT_MIN_HEIGHT_PX = 320

/**
 * A slot's section: a flex column that may shrink below its content
 * (`minHeight: 0`), so a slot root using `flex: 1; minHeight: 0; overflow: auto`
 * scrolls inside its own panel instead of stretching the console.
 */
const SLOT_SECTION_SX = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
} as const

/** A keycap in the shortcut strip. */
const KBD_SX = {
  fontFamily: staffShellTokens.classificationTag.fontFamily,
  fontSize: 11,
  fontWeight: 700,
  color: staffShellTokens.header.background,
  border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
  borderRadius: '4px',
  bgcolor: staffShellTokens.toolstrip.background,
  px: 0.75,
  py: 0.125,
} as const

/**
 * A post being replied to, as the live-world column hands it to the composer
 * (implementation.md §1.11). Owned by demo-polish F0 (`@/features/social`); re-exported here
 * so slot authors import the console's whole slot contract from one place. `excerpt` is at most
 * 140 chars.
 */
export type { ReplyTarget }

/**
 * What the console hands to each main-area slot (implementation.md §1.11).
 *
 * `openComposer` opens the persona dock AS A PERSONA, and the dock content is
 * whatever the route derives from the shared active persona — so the console
 * makes the two agree by selecting the persona in `ActivePersonaProvider` first
 * (the same `selectPersona` the ⌘K picker calls) and only then opening the dock:
 *  - `personaId` given: that persona, looked up in this exercise's staff persona
 *    list;
 *  - no `personaId`: the persona already active (the one last worked with).
 * If the persona cannot be resolved — unknown id, none active, the list not yet
 * loaded, or a persona left over from another exercise — the ⌘K palette opens
 * instead so the controller picks who to post as. An empty dock, or a dock
 * showing a DIFFERENT persona's composer than the one requested, is never
 * opened: that is how a post goes out as the wrong persona.
 *
 * `replyTo` is accepted so a slot can pass its target through one call; the
 * console itself does not hold it — the route owns the reply-target state and
 * feeds the composer through `dockSlots` (implementation.md §4.2).
 *
 * The function identity is stable for the life of the console, so a slot that
 * lists it as an effect/memo dependency is not re-run on every console render.
 */
export interface ConsoleSlotContext {
  openComposer(opts?: { personaId?: string; replyTo?: ReplyTarget }): void
}

/**
 * The persona with `personaId` from the exercise's staff persona list, or
 * `undefined`. A persona that carries an `exerciseId` different from the
 * current exercise is rejected (defence in depth for a list or an active
 * persona left over from before an exercise switch); the live wire may omit it,
 * which is accepted.
 */
function findExercisePersona(
  personas: readonly StaffPersona[],
  personaId: string,
  exerciseId: string,
): StaffPersona | undefined {
  return personas.find(persona => {
    if (persona.id !== personaId) return false
    const personaExerciseId: string | undefined = persona.exerciseId
    return personaExerciseId === undefined || personaExerciseId === exerciseId
  })
}

/**
 * A callback with a STABLE identity that always runs the latest `fn`. The ref is
 * refreshed in a layout effect (never during render), so what a stable caller
 * invokes is the closure of the most recent committed render.
 */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}

/** Narrows a `CountingDown` item down to one guaranteed to carry a countdown. */
function hasCountdown(
  item: EngineReviewItem,
): item is EngineReviewItem & { countdown: DelayedAutoCountdown } {
  return item.disposition === DraftDisposition.CountingDown && item.countdown !== null
}

export interface ControllerConsoleProps {
  /**
   * Renders the searchable persona LIST into the ⌘K palette's PERSONAS section
   * (`persona-operation/02`'s `PersonaPicker`) — supplied by the `/console`
   * route at integration. Absent in isolation (cs01 standalone tests), where the
   * palette shows its neutral placeholder.
   */
  renderPersonaResults?: (slot: CommandPalettePersonaSlot) => ReactNode
  /**
   * The persona-dock host content slots (`persona-operation`'s context panel +
   * composer for the active persona) — supplied by the `/console` route. Absent
   * in isolation, where the dock shows its neutral placeholder.
   */
  dockSlots?: PersonaDockSlots
  /**
   * The docked `<ReviewQueue>`'s edit composer slot (`engine-review-cockpit`'s
   * `EngineDraftEditComposer`) — supplied by the `/console` route at
   * integration. Absent in isolation, where the queue's E (edit) action is
   * inert (mirrors `ReviewQueue`'s own standalone behavior).
   */
  reviewEditSlot?: (props: ReviewQueueEditSlotProps) => ReactNode
  /**
   * The LIVE WORLD column (demo-polish C2's `LiveWorldColumn`) — supplied by the
   * `/console` route. Left column of the main-area split. Absent = not rendered.
   */
  liveWorldSlot?: (ctx: ConsoleSlotContext) => ReactNode
  /**
   * The RUN SHEET panel (demo-polish C3's `RunSheetPanel`) — supplied by the
   * `/console` route. Right column of the main-area split. Absent = not rendered.
   */
  runSheetSlot?: (ctx: ConsoleSlotContext) => ReactNode
  /**
   * Called when an OPEN persona dock closes, for ANY reason: the operator's Esc / X, the
   * ENGINE or USAGE flyout displacing it, or an exercise switch. It is never called for a
   * dock that was not open, nor while the dock merely changes persona. The route uses it to
   * drop the reply target it holds (the dock content is what showed that target, so it
   * must not outlive the dock). Give it a stable identity (`useCallback`).
   */
  onDockClose?: () => void
}

export function ControllerConsole(
  { renderPersonaResults, dockSlots, reviewEditSlot, liveWorldSlot, runSheetSlot, onDockClose }:
  ControllerConsoleProps = {},
) {
  const identity = useControllerIdentity()
  const { exerciseId, timeZone } = useExerciseContext()
  const { isActive, toggleTool } = useToolstrip()
  // The console's root element: the reference point for "is some OTHER modal on top of
  // the console?" (see the ⌘K handler below).
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The engine-review-cockpit's own continuous-watch inputs (D5-017 permanent
  // column, not a toolstrip flyout). `useReviewQueue()`/`useEngineControl()`/
  // `useSwampedMode()` are singleton-store-backed, so this read and the
  // `<EngineControlBar>`/`<ReviewQueue>` children's own reads of the same hooks
  // all agree by construction (D5-014/2.1 counts-consistency).
  const { items } = useReviewQueue()
  const { swampedMode } = useSwampedMode()
  const engineControl = useEngineControl()
  const draftTimerCtx = useMemo(
    () => ({ exerciseId, timeZone, actingHumanId: identity.actingHumanId }),
    [exerciseId, timeZone, identity.actingHumanId],
  )
  const countingDownItems = useMemo(() => items.filter(hasCountdown), [items])

  // Phase-1 badge: the count of personas available to post as, exercise-scoped
  // via `useStaffPersonas()` (COR-001). The badge's COUNT is what the shell's
  // Toolstrip renders as visible text (never color-only, NFR-001); its
  // `escalating` flag is a pass-through the shell renders as a red pulse ON TOP
  // of that text — left `false` here until a later story wires an attention
  // source (e.g. queued persona posts). The badge is omitted while empty.
  // The STAFF read (one fetch, shared with `openComposer`'s persona lookup
  // below): selecting a persona into the route's `ActivePersonaProvider` takes a
  // `StaffPersona` (SOC-052/D1-008), and this is the staff console.
  const { personas } = useStaffPersonas()
  const personaCount = personas.length
  // The shared "operating as" seam the route mounts above this console. The
  // console selects into it when a slot opens the composer (see `openComposer`).
  const { activePersona, selectPersona } = useActivePersona()

  useRegisterSurfaceTool({
    id: PERSONAS_TOOL_ID,
    label: 'PERSONAS',
    icon: faMasksTheater,
    tooltip: 'Post as persona (⌘K) — search a persona and compose',
    badge: personaCount > 0 ? { count: personaCount, escalating: false } : undefined,
  })

  // The "ENGINE" consult-on-demand tool (feature: autonomy-safety, story 06) —
  // the console admin surface for the exercise autonomy default + tier-policy
  // mode (story 05's API). No badge (this is a settings surface, not a
  // pending-attention one). Its flyout is keyed on `isActive(...)` below,
  // exactly like the "Personas" tool's palette above.
  useRegisterSurfaceTool({
    id: ENGINE_SETTINGS_TOOL_ID,
    label: 'ENGINE',
    icon: faGear,
    tooltip: 'Engine settings — autonomy default, tier policy, provider (read-only)',
  })
  const engineSettingsOpen = isActive(ENGINE_SETTINGS_TOOL_ID)
  const closeEngineSettings = useCallback(() => {
    if (isActive(ENGINE_SETTINGS_TOOL_ID)) toggleTool(ENGINE_SETTINGS_TOOL_ID)
  }, [isActive, toggleTool])

  // The "USAGE" consult-on-demand tool (feature: engine-telemetry-tuning,
  // story 03c) — the console's live-ops AI-generation volume/cost view
  // (story 03a's `GET /api/engine/usage`). No badge (an observability
  // surface, not a pending-attention one). Registered + gated exactly like
  // ENGINE above: the SAME shared `activeToolId` already makes ENGINE and
  // USAGE mutually exclusive (one flyout open at a time, D7-011), and
  // activating USAGE closes an already-open persona dock the same way
  // ENGINE does (see the `dockPersonaOpen`/effect below).
  useRegisterSurfaceTool({
    id: ENGINE_USAGE_TOOL_ID,
    label: 'USAGE',
    icon: faChartLine,
    tooltip: 'AI generation usage — call volume, tokens, latency, and cost (read-only)',
  })
  const engineUsageOpen = isActive(ENGINE_USAGE_TOOL_ID)
  const closeEngineUsage = useCallback(() => {
    if (isActive(ENGINE_USAGE_TOOL_ID)) toggleTool(ENGINE_USAGE_TOOL_ID)
  }, [isActive, toggleTool])

  // The "Personas" toolstrip tool's active state is the SINGLE source of truth
  // for whether the ⌘K palette is open, so the toolstrip button always reflects
  // the palette and ⌘K + the button toggle the exact same state — opening via
  // one and closing via the other both work. ⌘K therefore toggles the tool
  // (functional toggle in the registry, so no stale-closure race).
  const paletteOpen = isActive(PERSONAS_TOOL_ID)

  const closePalette = useCallback(() => {
    if (isActive(PERSONAS_TOOL_ID)) toggleTool(PERSONAS_TOOL_ID)
  }, [isActive, toggleTool])

  // ⌘K / Ctrl+K toggles the palette - UNLESS another modal layer is up (a run-sheet
  // dialog, the persona edit dialog, the pause-tier popover: anything declaring aria-modal).
  // The palette is a hand-built fixed layer at the same z-index as MUI's modals, so
  // opening it over one would put it BEHIND the dialog (hidden), while its focus-on-open
  // fought the dialog's focus trap (core/a11y/modalPriority.ts). The chord is still
  // swallowed (`preventDefault`) so the browser's own Ctrl+K does not fire in its place.
  // The palette's own panel sits inside `rootRef`, so it never counts as "another" modal:
  // with only the palette open, the chord still closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        const root = rootRef.current
        if (root !== null && hasOtherModalMounted(root)) return
        toggleTool(PERSONAS_TOOL_ID)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleTool])

  // The persona-dock host opens once a persona is selected (from the palette,
  // or — at integration — from the picker). Persona content mounts into its
  // slots at integration; empty here.
  //
  // The dock persona is remembered WITH the exercise it was opened in, and only
  // counts while that is still the current exercise: the console does not
  // remount on an exercise switch (the scope commits in place), so persona
  // memory keyed on nothing would survive into the next exercise. Deriving
  // `dockPersonaId` closes the dock in the same render the scope changes; the
  // effect below drops the stale memory so switching back never revives it.
  const [dockState, setDockState] = useState<{ exerciseId: string; personaId: string } | null>(
    null,
  )
  const dockPersonaId =
    dockState !== null && dockState.exerciseId === exerciseId ? dockState.personaId : null
  const setDockPersonaId = useCallback(
    (personaId: string | null) => {
      setDockState(personaId === null ? null : { exerciseId, personaId })
    },
    [exerciseId],
  )
  useEffect(() => {
    setDockState(current =>
      current !== null && current.exerciseId !== exerciseId ? null : current,
    )
  }, [exerciseId])
  const handleSelectPersona = useCallback(
    (personaId: string) => setDockPersonaId(personaId),
    [setDockPersonaId],
  )
  // The EXPLICIT close (Esc/X on the dock) is the operator choosing to
  // discard whatever draft was in progress — so this ALSO clears the
  // persisted-draft store (`useComposeAsPersona`'s Gate-1 WR-103 mirror),
  // otherwise a later re-open for the SAME persona would silently pre-fill
  // text the operator just explicitly dismissed. This is deliberately here,
  // not in `useComposeAsPersona` itself: that hook's unmount (e.g. this
  // console closing the dock for an UNRELATED reason, like ENGINE
  // activating below) must NOT discard the draft — only an explicit close
  // intent should.
  const closeDock = useCallback(() => {
    if (dockPersonaId !== null) {
      composeAsPersonaDraftStore.discardDraft(exerciseId, dockPersonaId)
    }
    setDockPersonaId(null)
  }, [dockPersonaId, exerciseId, setDockPersonaId])

  // The persona-dock host's `open` (`dockPersonaId !== null`) is independent
  // of the toolstrip's one-flyout-at-a-time `activeToolId` — activating
  // ENGINE does not, by itself, close a dock left open from an earlier
  // persona selection. Both flyouts render at the same edge/width/z-index, so
  // without this a still-mounted, still-Tab-reachable persona composer would
  // sit obscured underneath the engine panel instead of being replaced by it.
  //
  // Gating the RENDERED `open` prop DIRECTLY (`dockPersonaOpen`, below) — not
  // via a `useEffect` calling `setDockPersonaId(null)` — so the dock closes in
  // the SAME commit ENGINE opens in: an effect-driven close would land one
  // render later than `EngineSettingsPanel`'s own open-transition focus
  // effect, and `PersonaDockHost`'s focus-RESTORE effect firing in that later,
  // separate commit would steal focus back — overriding, rather than being
  // overridden by, the engine panel's own focus. `PersonaDockHost` is
  // declared BEFORE `EngineSettingsPanel` in the JSX below, so within the ONE
  // commit ENGINE opens in, the dock's closing (focus-restoring) effect fires
  // FIRST and the engine panel's own focus, firing second, is what's left
  // standing. The `useEffect` below still clears the underlying
  // `dockPersonaId` STATE (one render later, with no visible/focus effect —
  // the dock is already not rendered by then; note it deliberately does NOT
  // discard the persisted draft — see `closeDock`'s own comment) so a LATER
  // close of the engine panel doesn't resurrect a stale dock.
  const dockPersonaOpen = dockPersonaId !== null && !engineSettingsOpen && !engineUsageOpen
  useEffect(() => {
    if (engineSettingsOpen || engineUsageOpen) setDockPersonaId(null)
  }, [engineSettingsOpen, engineUsageOpen, setDockPersonaId])

  // Tell the route when an OPEN dock closes, whatever closed it (`onDockClose`). Watching
  // the RENDERED open flag - not `closeDock` - is what makes the ENGINE/USAGE takeover
  // and the exercise switch count too; a dock that merely changes persona stays open and
  // reports nothing.
  const wasDockOpen = useRef(false)
  useEffect(() => {
    if (wasDockOpen.current && !dockPersonaOpen) onDockClose?.()
    wasDockOpen.current = dockPersonaOpen
  }, [dockPersonaOpen, onDockClose])

  // The context every main-area slot receives. `openComposer` is the ONE way a
  // slot (live-world "Reply as…", a run-sheet row, …) opens the persona dock:
  //   - resolve WHO: the requested `personaId`, else the persona already active,
  //     looked up in THIS exercise's staff persona list;
  //   - resolved: SELECT it into the route's active-persona state (the very
  //     persona the dock content is derived from — so the composer that opens is
  //     the requested persona's, even if another was active), then open the dock
  //     for it. Unlike the ⌘K picker, which selects inside the picker itself and
  //     only then reports the id, nothing selects for a slot — so this must;
  //   - NOT resolved (unknown id, none active, list still loading, a persona from
  //     another exercise): open the ⌘K palette so the controller picks. Never an
  //     empty dock, never a dock showing someone else's composer;
  //   - an open ENGINE/USAGE flyout is closed first (one flyout at a time, and
  //     the dock is gated off while either is open — see `dockPersonaOpen`).
  // `replyTo` is not held here (see `ConsoleSlotContext`). The identity is stable
  // (`useStableCallback`), so slots can depend on it freely.
  const openComposer = useStableCallback<
    Parameters<ConsoleSlotContext['openComposer']>,
    void
  >(opts => {
    const requestedId = opts?.personaId ?? activePersona?.id
    const persona =
      requestedId === undefined ? undefined : findExercisePersona(personas, requestedId, exerciseId)
    if (persona === undefined) {
      if (!isActive(PERSONAS_TOOL_ID)) toggleTool(PERSONAS_TOOL_ID)
      return
    }
    closeEngineSettings()
    closeEngineUsage()
    selectPersona(persona)
    handleSelectPersona(persona.id)
  })
  const slotContext = useMemo<ConsoleSlotContext>(() => ({ openComposer }), [openComposer])

  // Live world | Run sheet side by side from 1280px, stacked below (C4 AC).
  // `noSsr` reads the real viewport on the first render (this is a client-only
  // SPA), so a wide screen never flashes the stacked layout.
  const slotsSplit = useMediaQuery(`(min-width:${SLOT_SPLIT_MIN_WIDTH_PX}px)`, { noSsr: true })
  const liveWorld = liveWorldSlot ? liveWorldSlot(slotContext) : null
  const runSheet = runSheetSlot ? runSheetSlot(slotContext) : null
  const hasSlots = Boolean(liveWorldSlot) || Boolean(runSheetSlot)
  // Two columns only when BOTH panels exist and the viewport is wide enough — a
  // lone panel takes the full width instead of sitting in half a split.
  const slotsTwoColumn = slotsSplit && Boolean(liveWorldSlot) && Boolean(runSheetSlot)

  return (
    <Box
      ref={rootRef}
      data-testid="controller-console"
      // The last-resort home for focus (`CommandPalette`'s fallback when the layer it was opened
      // over has closed): focusable by script only, no tab stop, no ring on a container.
      data-console-root=""
      tabIndex={-1}
      // Positioning context for the console's own flyouts (persona-dock host),
      // anchored to the work area's edges — mirrors the evaluator dashboard page.
      sx={{ position: 'relative', height: '100%', overflow: 'hidden', outline: 'none' }}
    >
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* The engine-control chrome strip — full width, top of the work area
            (D5 §2). Reads the SAME useReviewQueue()/useEngineControl()/
            useSwampedMode() singleton-store hooks as the driver map + the
            docked queue below (D5-014/2.1 counts-consistency). */}
        <Box sx={{ flex: 'none' }}>
          <EngineControlBar />
        </Box>

        <Stack direction="row" sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Main content region — the existing header/⌘K hint/persona-dock
              host mount, unchanged by this integration. */}
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
            {/* Fixed to the work area's height (not just a minimum) so the slot
                grid below can take the REMAINING height and each slot can own
                its own scroll; if the area is too short, this box overflows and
                the region itself scrolls instead. */}
            <Stack sx={{ gap: 1.5, p: '18px 22px', height: '100%', boxSizing: 'border-box' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <FontAwesomeIcon
                  icon={faTowerBroadcast}
                  color={staffShellTokens.header.background}
                />
                <Typography
                  component="h1"
                  sx={{
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    color: staffShellTokens.header.background,
                  }}
                >
                  CONTROLLER CONSOLE
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography
                  data-testid="controller-callsign"
                  sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: staffShellTokens.accent.secondaryText,
                  }}
                >
                  {identity.callSign}
                </Typography>
              </Stack>

              {/* Shortcut strip — the one place the console says how to start. */}
              <Stack
                direction="row"
                data-testid="console-shortcut-strip"
                sx={{
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: staffShellTokens.accent.secondaryText,
                }}
              >
                <FontAwesomeIcon icon={faKeyboard} aria-hidden="true" />
                <Box component="kbd" sx={KBD_SX}>⌘K</Box>
                <Box component="span">/</Box>
                <Box component="kbd" sx={KBD_SX}>Ctrl+K</Box>
                <Box component="span">Post as a persona</Box>
              </Stack>

              {/* World-steering (world-steering feature): the tiered-pause control + the
                  storyline escalation dial. PausePill drives usePauseState (the
                  header state pill reflects the tier); EscalationDial sets the
                  storyline target the engine will follow (loop deferred). Both
                  are self-contained COBRA staff controls. */}
              <Stack
                data-testid="world-steering-panel"
                sx={{ gap: 1.5, mt: 0.5, maxWidth: 520 }}
              >
                <PausePill />
                <EscalationDial />
              </Stack>

              {/* Main-area slots: Live world | Run sheet (split >= 1280px,
                  stacked below). Nothing supplied = one status line, never
                  placeholder panels. */}
              {hasSlots ? (
                <Box
                  data-testid="console-slots"
                  data-layout={slotsTwoColumn ? 'split' : 'stacked'}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: slotsTwoColumn
                      ? 'repeat(2, minmax(0, 1fr))'
                      : 'minmax(0, 1fr)',
                    // Rows share the remaining height, never below a usable floor.
                    gridAutoRows: `minmax(${SLOT_MIN_HEIGHT_PX}px, 1fr)`,
                    gap: 2,
                    alignItems: 'stretch',
                    // Fill the height left under the steering controls, and be
                    // allowed to shrink to it (a slot can then own its scroll).
                    flex: 1,
                    minHeight: 0,
                    mt: 0.5,
                  }}
                >
                  {liveWorldSlot && (
                    <Box
                      component="section"
                      aria-label="Live world"
                      data-testid="console-slot-live-world"
                      sx={SLOT_SECTION_SX}
                    >
                      {liveWorld}
                    </Box>
                  )}
                  {runSheetSlot && (
                    <Box
                      component="section"
                      aria-label="Run sheet"
                      data-testid="console-slot-run-sheet"
                      sx={SLOT_SECTION_SX}
                    >
                      {runSheet}
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography
                  data-testid="console-slots-status"
                  sx={{ fontSize: 12, color: staffShellTokens.accent.secondaryText }}
                >
                  Live world and run sheet are not connected to this console.
                </Typography>
              )}
            </Stack>
          </Box>

          {/* The engine review queue — a PERMANENT docked column (D5-017), NOT
              a toolstrip flyout. Self-contained; reads useReviewQueue()
              internally. The edit slot is supplied by the /console route. */}
          <Box
            data-testid="review-queue-column"
            sx={{
              flex: 'none',
              width: REVIEW_QUEUE_WIDTH_PX,
              minWidth: REVIEW_QUEUE_WIDTH_PX,
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <ReviewQueue editSlot={reviewEditSlot} />
          </Box>
        </Stack>
      </Box>

      {/* One invisible driver per CountingDown item — the safety demo (see
          `DraftTimerDriver`'s module header). Auto-HOLDs by default; the ONLY
          timeout auto-send is swamped(lead) on a still-effectively-Delayed-auto
          draft, and a STOP/Suggest-only/degraded engine holds even then. */}
      {countingDownItems.map(item => (
        <DraftTimerDriver
          key={item.draftId}
          item={item}
          countdown={item.countdown}
          swampedMode={swampedMode}
          effective={engineControl.effective}
          ctx={draftTimerCtx}
        />
      ))}

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onSelectPersona={handleSelectPersona}
        renderPersonaResults={renderPersonaResults}
      />

      <PersonaDockHost open={dockPersonaOpen} onClose={closeDock} slots={dockSlots} />

      <EngineSettingsPanel open={engineSettingsOpen} onClose={closeEngineSettings} />

      <UsagePanel open={engineUsageOpen} onClose={closeEngineUsage} />
    </Box>
  )
}
