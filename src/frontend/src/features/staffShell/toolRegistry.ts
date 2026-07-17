/**
 * features/staffShell/toolRegistry.ts
 * ---------------------------------------------------------------------------
 * The staff-shell toolstrip's TOOL-REGISTRATION API (feature: staff-shell,
 * story 02 — "Toolstrip dock — one shell-owned strip, shell-global + surface
 * zones"; D7-011, COR-063; see docs/features/staff-shell/02-toolstrip-dock.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell
 * owns" → "Toolstrip").
 *
 * ## This is THE seam
 * `useRegisterSurfaceTool()` is the `registerSurfaceTool()` seam named in
 * `docs/features/staff-shell/implementation.md` ("Exports (that others
 * import)": **`registerSurfaceTool()` / `<Toolstrip>`**) — the API
 * `console-shell`'s controller toolbox and the evaluator dashboard import to
 * contribute their own tools into the ONE shell-owned toolstrip dock, instead
 * of drawing a second strip of their own (D7-011). `useRegisterShellGlobalTool()`
 * is the sibling seam for shell-global tools — capabilities that belong on
 * every staff surface, not just the current one (story 03's Participant Admin
 * flyout is the first consumer).
 *
 * ## Why this is a React context, not a module-global registry
 * A module-level `let tools: SurfaceTool[] = []` would leak registrations
 * across mounts/unmounts and, worse, across EXERCISES — a controller console
 * remounted for a second exercise would inherit the first exercise's tool
 * registrations (or a stale `activeToolId`) if the registry lived outside
 * React. `ToolstripProvider` holds ALL registry state in `useState` — nothing
 * module-global. Mounting it under the exercise scope (i.e. as a descendant
 * of `ExerciseContextProvider`, in the orchestrator's frame assembly) is what
 * makes the registry exercise-scoped (XC-001, story AC5): a remount for a new
 * exercise clears it by construction, with no explicit exercise-change
 * handling needed in this module.
 *
 * ## Fail-closed, mirroring `useExerciseContext()` (core/exerciseContext)
 * `useToolstrip()`, `useRegisterSurfaceTool()`, and `useRegisterShellGlobalTool()`
 * all THROW when called outside a `<ToolstripProvider>` — there is no
 * default/aggregate registry a caller could silently read from or register
 * into.
 *
 * ## One flyout open at a time
 * `activeToolId` is a SINGLE value shared across BOTH zones (shell-global and
 * surface) — activating any tool closes whichever other tool (in either
 * zone) was previously active; activating the already-active tool closes it.
 * Flyout CONTENT is out of scope for this story — each registrant renders its
 * own flyout, keyed off `useToolstrip().activeToolId` / `isActive(id)`, inside
 * the staff frame (see `components/Toolstrip.tsx`'s module header).
 *
 * World: staff (COBRA/Cadence). No UI in this module — pure registry/state;
 * the dock's chrome lives in `components/Toolstrip.tsx`.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

/** A tool's pending/attention-count badge (D5-017 consult-on-demand signal). */
export interface ToolBadge {
  /** Pending count. Always rendered as visible text — never color-only (NFR-001). */
  count: number
  /**
   * Escalating — the consult-on-demand surface this tool represents needs
   * attention now (D5-017). The toolstrip layers a red pulsing treatment on
   * top of the count when this is `true`, but the count text itself always
   * carries the signal (never color/motion alone).
   */
  escalating?: boolean
}

/** Which zone of the one shell-owned toolstrip a tool registers into. */
export type ToolZone = 'shellGlobal' | 'surface'

/** A single toolstrip-dock tool, as registered by a shell-global capability or a surface. */
export interface SurfaceTool {
  /** Stable id, unique within its zone — registering the same id again upserts it. */
  id: string
  /** Short caption rendered under the icon (e.g. "STORIES"). */
  label: string
  /** FontAwesome icon — never `@mui/icons-material` (CLAUDE.md). */
  icon: IconDefinition
  /** Longer hover/description text (rendered via a tooltip on the dock button). */
  tooltip: string
  /** Optional pending/attention badge. */
  badge?: ToolBadge
}

/** Registered tools grouped by zone. Internal shape — never exported. */
interface ToolsByZone {
  shellGlobal: SurfaceTool[]
  surface: SurfaceTool[]
}

const EMPTY_TOOLS_BY_ZONE: ToolsByZone = { shellGlobal: [], surface: [] }

interface ToolstripContextValue {
  toolsByZone: ToolsByZone
  activeToolId: string | null
  registerTool: (zone: ToolZone, tool: SurfaceTool) => void
  unregisterTool: (zone: ToolZone, id: string) => void
  toggleTool: (id: string) => void
}

const ToolstripContext = createContext<ToolstripContextValue | undefined>(undefined)

export interface ToolstripProviderProps {
  children: ReactNode
}

/**
 * Holds the toolstrip dock's registry (both zones) plus the single
 * active-tool id, entirely in React state (see module header — "why a
 * context, not a module-global"). Mount exactly ONE of these per staff frame,
 * under the exercise scope, so the registry is exercise-scoped by
 * construction (XC-001).
 *
 * Built with `createElement` (not JSX) so this module can stay a `.ts` file —
 * it has no other JSX needs (mirrors `features/participant-shell/mountContract.ts`'s
 * `ShellContextProvider`).
 */
export function ToolstripProvider({ children }: ToolstripProviderProps) {
  const [toolsByZone, setToolsByZone] = useState<ToolsByZone>(EMPTY_TOOLS_BY_ZONE)
  const [activeToolId, setActiveToolId] = useState<string | null>(null)

  const registerTool = useCallback((zone: ToolZone, tool: SurfaceTool) => {
    setToolsByZone(prev => {
      const zoneTools = prev[zone]
      const existingIndex = zoneTools.findIndex(existing => existing.id === tool.id)
      const nextZoneTools = existingIndex === -1
        ? [...zoneTools, tool]
        : zoneTools.map(existing => (existing.id === tool.id ? tool : existing))
      return { ...prev, [zone]: nextZoneTools }
    })
  }, [])

  const unregisterTool = useCallback((zone: ToolZone, id: string) => {
    setToolsByZone(prev => ({ ...prev, [zone]: prev[zone].filter(tool => tool.id !== id) }))
    // An unregistered tool can't stay "active" (its flyout, if any, is gone).
    setActiveToolId(current => (current === id ? null : current))
  }, [])

  const toggleTool = useCallback((id: string) => {
    setActiveToolId(current => (current === id ? null : id))
  }, [])

  const value = useMemo<ToolstripContextValue>(() => ({
    toolsByZone,
    activeToolId,
    registerTool,
    unregisterTool,
    toggleTool,
  }), [toolsByZone, activeToolId, registerTool, unregisterTool, toggleTool])

  return createElement(ToolstripContext.Provider, { value }, children)
}

/** Fail-closed accessor mirroring `useExerciseContext()` — see module header. */
function useToolstripContextValue(): ToolstripContextValue {
  const ctx = useContext(ToolstripContext)
  if (!ctx) {
    throw new Error(
      'useToolstrip() / useRegisterSurfaceTool() / useRegisterShellGlobalTool() must be called ' +
      'within a <ToolstripProvider>. There is no default or module-global toolstrip registry ' +
      '(XC-001) — mount ToolstripProvider inside the staff frame, under the exercise scope.',
    )
  }
  return ctx
}

/**
 * Shared register/update/unregister lifecycle behind both zone-specific hooks
 * below.
 *
 * Deliberately depends on `tool`'s PRIMITIVE fields, never the `tool` object
 * reference itself. The ordinary calling pattern is `useRegisterSurfaceTool({
 * id: ..., badge: { count } })` — a fresh object literal constructed on every
 * render of the registrant. Depending on that object's identity would re-fire
 * this effect (and therefore call `registerTool`, which always produces a new
 * registry array) on every unrelated re-render of the registrant — an
 * infinite update loop the moment ANY ancestor (starting with
 * `ToolstripProvider` itself, right after the first registration) causes the
 * registrant to re-render. Keying on the primitives means the effect — and
 * the registry array — only changes when something the dock actually renders
 * differently (label/icon/tooltip/badge) has changed.
 */
function useRegisterTool(zone: ToolZone, tool: SurfaceTool): void {
  const { registerTool, unregisterTool } = useToolstripContextValue()
  const { id, label, tooltip, icon, badge } = tool
  const badgeCount = badge?.count
  const badgeEscalating = badge?.escalating

  useEffect(() => {
    registerTool(zone, tool)
    return () => unregisterTool(zone, id)
    // Keyed on primitives, not `tool`'s object identity — see rationale above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, id, label, tooltip, icon, badgeCount, badgeEscalating, registerTool, unregisterTool])
}

/**
 * Registers `tool` into the toolstrip's SURFACE zone (below the divider) for
 * as long as the calling component stays mounted — the `registerSurfaceTool()`
 * seam `console-shell`'s toolbox and the evaluator dashboard import (see
 * module header). Registers on mount, upserts whenever `tool` changes
 * (label/icon/tooltip/badge — so a pending count updates live), and
 * unregisters on unmount. Throws if called outside a `<ToolstripProvider>`.
 */
export function useRegisterSurfaceTool(tool: SurfaceTool): void {
  useRegisterTool('surface', tool)
}

/**
 * Registers `tool` into the toolstrip's SHELL-GLOBAL zone (top, above the
 * divider) — for capabilities that belong on every staff surface (e.g. story
 * 03's Participant Admin), not just the current one. Same
 * register/update/unregister lifecycle as {@link useRegisterSurfaceTool}.
 * Throws if called outside a `<ToolstripProvider>`.
 */
export function useRegisterShellGlobalTool(tool: SurfaceTool): void {
  useRegisterTool('shellGlobal', tool)
}

/**
 * What {@link useToolstrip} hands back to the dock UI and to registrants
 * rendering their own flyout.
 */
export interface UseToolstripResult {
  /** Tools registered into the shell-global zone (top). */
  shellGlobalTools: SurfaceTool[]
  /** Tools registered into the surface zone (below the divider). */
  surfaceTools: SurfaceTool[]
  /** The single active tool id across BOTH zones, or `null` if none is open. */
  activeToolId: string | null
  /**
   * Activates `id` (closing whichever other tool was active), or
   * deactivates it if it was already the active one.
   */
  toggleTool: (id: string) => void
  /**
   * `true` when `id` is the active tool — for a registrant deciding whether
   * to render its flyout.
   */
  isActive: (id: string) => boolean
}

/**
 * Reads the toolstrip registry — both zones' tools, the single active-tool
 * id, and the toggle operation. Consumed by `<Toolstrip>` (the dock chrome,
 * `components/Toolstrip.tsx`) and by any registrant that renders its own
 * flyout keyed off `activeToolId` / `isActive(id)` (flyout content is this
 * story's Out-of-Scope). Throws if called outside a `<ToolstripProvider>`
 * (fail-closed, mirroring `useExerciseContext()`).
 */
export function useToolstrip(): UseToolstripResult {
  const { toolsByZone, activeToolId, toggleTool } = useToolstripContextValue()

  const isActive = useCallback(
    (id: string) => activeToolId === id,
    [activeToolId],
  )

  return {
    shellGlobalTools: toolsByZone.shellGlobal,
    surfaceTools: toolsByZone.surface,
    activeToolId,
    toggleTool,
    isActive,
  }
}
