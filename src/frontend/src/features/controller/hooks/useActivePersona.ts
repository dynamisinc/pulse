/**
 * features/controller/hooks/useActivePersona.ts
 * ---------------------------------------------------------------------------
 * The controller console's active-persona STATE (feature: persona-operation,
 * story 02 "Fast persona switching"; CTL-002, D5-004/015/017/018; see
 * docs/features/persona-operation/02-fast-persona-switching.md).
 *
 * `ActivePersonaProvider` + `useActivePersona()` is the shared seam this
 * story's `PersonaPicker` writes to and that sibling Wave-1 stories read from
 * — the composer (persona-operation/01) and the persona-context panel
 * (persona-operation/03) both need the SAME "currently operating as" value,
 * so this cannot be private per-component `useState` (each mount would get
 * its own copy and the picker's selection would never reach the composer).
 * Mirrors the colocated provider+hook shape already used by
 * `core/exerciseContext/exerciseContext.tsx` and
 * `features/staffShell/toolRegistry.ts` — a React context, NOT a
 * module-global store, so mounting a fresh `<ActivePersonaProvider>` per
 * console/exercise mount clears state by construction (no explicit
 * exercise-switch handling needed here — same precedent `toolRegistry.ts`
 * documents for its own registry).
 *
 * ## Where this mounts
 * Out of this story's scope (Wave-1 parallel-build contract): the serial
 * integration step mounts exactly ONE `<ActivePersonaProvider>` inside the
 * `/console` route, above both `PersonaPicker` and the composer/context-panel
 * consumers. This module only needs that ancestor to exist somewhere above
 * any caller of `useActivePersona()`.
 *
 * ## Recents + pins (Wave 1: local-only, no backend)
 * Per the story's Technical Notes, recents/pins are per-controller LOCAL
 * state for Wave 1 — no persistence beyond the provider's lifetime. Recents
 * are a most-recently-used list (deduped, newest first, capped at
 * `MAX_RECENT_PERSONAS`); pins are an unordered toggle set. Both are keyed by
 * persona id, not by the `Persona` object itself, so the picker's own
 * `personas` prop can be swapped (e.g. a differently-sorted or filtered copy)
 * without invalidating pin/recent membership.
 *
 * ## Speed (CTL-002, "≤3s")
 * This module does no async work, no debounce, and no I/O on
 * `selectPersona()`/`togglePinned()` — every update is a synchronous state
 * set so the picker's keyboard flow (type → ↑↓ → Enter) never waits on
 * anything but React's own render, keeping the "⌘K → persona → composer"
 * path well under the 3-second budget.
 *
 * ## Why `StaffPersona`, not `Persona`
 * The active persona flows picker -> this state -> the persona-context panel,
 * which renders the D5-014/2.4 "POSTING AS {category}" chip off
 * `personaType`. That field exists ONLY on the staff projection
 * (`StaffPersona`; the participant `Persona` structurally omits it —
 * SOC-052/D1-008). Holding the narrower shape here would force the panel to
 * cast, so the whole staff chain is typed on `StaffPersona` and the
 * participant shape simply does not compile into it. Consumers that need only
 * the common fields (e.g. the composer) still declare `Persona` — a
 * `StaffPersona` is assignable to it.
 *
 * World: staff (COBRA console). No UI, no COBRA components here — pure
 * state/logic; `../components/PersonaPicker.tsx` is the chrome.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { StaffPersona } from '@/features/personas'

/** Most-recently-used cap (Wave 1: a small, glanceable list — not a full history). */
const MAX_RECENT_PERSONAS = 8

export interface ActivePersonaContextValue {
  /** The persona the controller is currently operating as, or `null` before any selection. */
  activePersona: StaffPersona | null
  /** Persona ids, most-recently-selected first (deduped, capped at {@link MAX_RECENT_PERSONAS}). */
  recentPersonaIds: readonly string[]
  /** Pinned persona ids (insertion order; unordered by the story's own semantics). */
  pinnedPersonaIds: readonly string[]
  /** Sets `persona` as active and records it as the most recent selection. */
  selectPersona: (persona: StaffPersona) => void
  /** Pins `personaId` if unpinned, unpins it if already pinned. */
  togglePinned: (personaId: string) => void
  /** Whether `personaId` is currently pinned. */
  isPinned: (personaId: string) => boolean
}

const ActivePersonaContext = createContext<ActivePersonaContextValue | undefined>(undefined)

export interface ActivePersonaProviderProps {
  children: ReactNode
}

/**
 * Holds the active persona + recents/pins in React state (see module header
 * — "why a context, not a module-global"). Mount exactly ONE per console
 * frame; a remount (e.g. a new exercise) resets all three by construction.
 */
export function ActivePersonaProvider({ children }: ActivePersonaProviderProps) {
  const [activePersona, setActivePersona] = useState<StaffPersona | null>(null)
  const [recentPersonaIds, setRecentPersonaIds] = useState<readonly string[]>([])
  const [pinnedPersonaIds, setPinnedPersonaIds] = useState<readonly string[]>([])

  const selectPersona = useCallback((persona: StaffPersona) => {
    setActivePersona(persona)
    setRecentPersonaIds(prev => {
      const withoutThisPersona = prev.filter(id => id !== persona.id)
      return [persona.id, ...withoutThisPersona].slice(0, MAX_RECENT_PERSONAS)
    })
  }, [])

  const togglePinned = useCallback((personaId: string) => {
    setPinnedPersonaIds(prev => (
      prev.includes(personaId)
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    ))
  }, [])

  const isPinned = useCallback(
    (personaId: string) => pinnedPersonaIds.includes(personaId),
    [pinnedPersonaIds],
  )

  const value = useMemo<ActivePersonaContextValue>(() => ({
    activePersona,
    recentPersonaIds,
    pinnedPersonaIds,
    selectPersona,
    togglePinned,
    isPinned,
  }), [activePersona, recentPersonaIds, pinnedPersonaIds, selectPersona, togglePinned, isPinned])

  // Built with `createElement` (not JSX) so this module can stay a `.ts` file
  // — mirrors `toolRegistry.ts`'s `ToolstripProvider`.
  return createElement(ActivePersonaContext.Provider, { value }, children)
}

/**
 * Reads the shared active-persona state. Throws when called outside an
 * `<ActivePersonaProvider>` (fail-closed, mirroring `useExerciseContext()` /
 * `useToolstrip()`) — there is no default/module-global active persona a
 * caller could silently read `null` from instead.
 */
// Provider + hook intentionally colocated in one module (mirrors
// `core/exerciseContext/exerciseContext.tsx` and `staffShell/toolRegistry.ts`).
export function useActivePersona(): ActivePersonaContextValue {
  const ctx = useContext(ActivePersonaContext)
  if (!ctx) {
    throw new Error(
      'useActivePersona() must be called within an <ActivePersonaProvider>. There is no ' +
      'default or module-global active persona — mount ActivePersonaProvider inside the ' +
      'console frame, above PersonaPicker and any composer/context-panel consumers.',
    )
  }
  return ctx
}
