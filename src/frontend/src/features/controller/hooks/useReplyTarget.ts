/**
 * features/controller/hooks/useReplyTarget.ts
 * ---------------------------------------------------------------------------
 * The controller console's REPLY TARGET state (demo-polish Wave 3 integration;
 * implementation.md section 4.2; C1 story 17 "reply as persona", C2 story 18 "Reply
 * as..."). STAFF world, no UI. Owned by `ControllerConsoleRoute`.
 *
 * WHAT IT HOLDS. The post a controller chose "Reply as..." on - the `ReplyTarget` C2's
 * live-world column produces and C1's `PersonaComposer` consumes (`replyTo` /
 * `onClearReply`). `ControllerConsole`'s `ConsoleSlotContext.openComposer` accepts a
 * `replyTo` but deliberately does not keep it, so the ROUTE keeps it - here - and feeds
 * it to the composer through `dockSlots`.
 *
 * WHEN IT GOES AWAY. A reply target that outlives what the controller was looking at is
 * how a post lands under the wrong thread, so the target is dropped as soon as the
 * context it was set in ends:
 *
 *   - the composer asks (`clearReply`): the (x) control, and after the reply went out;
 *   - the dock closes (`clearReply`, driven by `ControllerConsole`'s `onDockClose`: Esc / X,
 *     the ENGINE or USAGE flyout taking over, an exercise switch);
 *   - the ACTIVE PERSONA changes to a different one (the target was set "as persona X");
 *   - the exercise changes (a post id from another exercise must never reach this one's
 *     composer - COR-001; the state is keyed by exercise id and also dropped);
 *   - the command palette is dismissed without a pick (see the next paragraph).
 *
 * THE PALETTE PATH. "Reply as..." with NO active persona cannot open a composer: the console
 * opens the command palette (Cmd/Ctrl+K) so the controller picks who to reply as. That pick
 * IS the continuation of the reply, so the target survives it - it is held as "awaiting a
 * persona" (`personaId: null`) and binds to whichever persona becomes active next. If the
 * palette closes without a pick (Esc, backdrop, Cmd+K again) the target is dropped, so a
 * later, unrelated Cmd+K -> persona never opens a composer already pointing at an old post.
 *
 * What is returned as `replyTo` is DERIVED on every render from the state and the current
 * exercise / persona (never a stale value for one render); the effect then prunes the state
 * so a dropped target cannot reappear when the persona or exercise comes back.
 *
 * KNOWN LIMIT. If a persona is active but the console cannot resolve it (it is left over from
 * another exercise, or the persona list is still loading) the console opens the palette
 * while this state is already bound to that persona, not "awaiting a pick". Picking a
 * DIFFERENT persona then drops the target and the controller presses "Reply as..." again;
 * dismissing the palette leaves the target bound to that persona, so it is shown again only
 * if the dock is later opened for exactly that persona (and the dock closing drops it).
 * The target is never posted anywhere it was not visibly shown: the composer always renders
 * it as a "Replying to @handle" banner with a clear control.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReplyTarget } from '@/features/social'

/** A requested reply, and the context it was requested in. */
interface ReplyState {
  /** The exercise it was requested in; never shown in another one. */
  readonly exerciseId: string
  readonly target: ReplyTarget
  /** The persona it is for; `null` = awaiting a pick in the command palette. */
  readonly personaId: string | null
}

export interface UseReplyTargetOptions {
  /** The current exercise (from `useExerciseContext()`). */
  readonly exerciseId: string
  /** The persona the controller is operating as now, if any. */
  readonly activePersonaId: string | null
  /** Whether the command palette is open (the "Personas" tool's active state). */
  readonly paletteOpen: boolean
}

export interface UseReplyTargetResult {
  /** The target to give the composer (`replyTo`), or `null` for a normal post. */
  readonly replyTo: ReplyTarget | null
  /**
   * Sets the target. Call it in the SAME event as `ctx.openComposer(...)`: the persona it
   * binds to is the active one at this moment, or the next one picked if none is active.
   * Stable identity.
   */
  readonly requestReply: (target: ReplyTarget) => void
  /** Drops the target (composer (x) / reply sent / dock closed). Stable identity. */
  readonly clearReply: () => void
}

/**
 * What the state should be now: unchanged, bound to the persona just picked, or dropped.
 * Pure - see the module header for each rule.
 */
function settle(current: ReplyState | null, now: UseReplyTargetOptions): ReplyState | null {
  if (current === null) return null
  if (current.exerciseId !== now.exerciseId) return null
  if (current.personaId === null) {
    // Awaiting a pick: a persona is active now -> that is the one; else keep waiting while
    // the palette is open, and give up once it closed without one.
    if (now.activePersonaId !== null) return { ...current, personaId: now.activePersonaId }
    return now.paletteOpen ? current : null
  }
  return current.personaId === now.activePersonaId ? current : null
}

/** See the module header. */
export function useReplyTarget(options: UseReplyTargetOptions): UseReplyTargetResult {
  const { exerciseId, activePersonaId, paletteOpen } = options
  const [state, setState] = useState<ReplyState | null>(null)

  // `requestReply` reads the exercise / persona of the latest committed render through a
  // ref, so its identity never changes (the live-world slot depends on it and runs on every
  // console render). Written in a layout effect, never during render.
  const latest = useRef({ exerciseId, activePersonaId })
  useLayoutEffect(() => {
    latest.current = { exerciseId, activePersonaId }
  })

  const requestReply = useCallback((target: ReplyTarget) => {
    const { exerciseId: currentExercise, activePersonaId: currentPersona } = latest.current
    setState({ exerciseId: currentExercise, target, personaId: currentPersona })
  }, [])
  const clearReply = useCallback(() => setState(null), [])

  // Prune: drop or bind per `settle`. Re-runs when the request itself lands (`state`), so a
  // target set while nothing can show it is dropped at once. Bails out (same reference)
  // whenever nothing changes, so it cannot loop.
  useEffect(() => {
    setState(current => settle(current, { exerciseId, activePersonaId, paletteOpen }))
  }, [state, exerciseId, activePersonaId, paletteOpen])

  const replyTo =
    state !== null
    && state.exerciseId === exerciseId
    && (state.personaId === null || state.personaId === activePersonaId)
      ? state.target
      : null

  return { replyTo, requestReply, clearReply }
}
