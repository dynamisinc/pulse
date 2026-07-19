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
 * ## What this KEYSTONE story owns (and only this)
 *  - registers the "Personas" consult-on-demand surface tool (icon + label +
 *    tooltip + a never-color-only count badge);
 *  - the ⌘K / Ctrl+K command palette (open/close + key binding here; shell in
 *    `../console/CommandPalette`);
 *  - the persona-dock host mount slot (`../console/personaDockHost`), empty of
 *    persona content until integration;
 *  - the mock controller identity seam (`../identity/controllerIdentity`),
 *    surfaced on the console chrome + consumed by persona-operation as an INPUT.
 *
 * SCOPE GUARD: this does NOT build the MSEL rail, live-world columns, review
 * queue, storylines, rumor tracker, trainee monitor, NEEDS-YOU bar,
 * break-fiction, pause tiers, or the engine cockpit — those are separate
 * features/stories. Continuous-watch surfaces (live world, review queue) will
 * later occupy PERMANENT rail/column space here, NOT the toolstrip (D5-017);
 * this story only stands up the consult-on-demand extension point.
 *
 * ## Entry points to "post as persona" (both funnel to the persona-dock host)
 *  1. ⌘K / Ctrl+K, or activating the "Personas" toolstrip tool → the command
 *     palette opens (its PERSONAS section is the search/select entry point).
 *  2. Selecting a persona in the palette → the palette closes and the
 *     persona-dock host opens for that persona (composer wired at integration).
 * The palette-open state is unified with the "Personas" tool's active state so
 * the toolstrip button reflects the palette being open (one extension point).
 *
 * World: staff (COBRA/Cadence) — everything here is COBRA chrome; the
 * participant OUTPUT (a published post) is `persona-operation`'s via
 * `createPost` and is never drawn here. Never a participant surface (XC-002).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMasksTheater, faTowerBroadcast } from '@fortawesome/free-solid-svg-icons'
import { usePersonas } from '@/features/personas'
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
}

export function ControllerConsole(
  { renderPersonaResults, dockSlots }: ControllerConsoleProps = {},
) {
  const identity = useControllerIdentity()
  const { isActive, toggleTool } = useToolstrip()

  // Phase-1 badge: the count of personas available to post as, exercise-scoped
  // via `usePersonas()` (COR-001). The badge's COUNT is what the shell's
  // Toolstrip renders as visible text (never color-only, NFR-001); its
  // `escalating` flag is a pass-through the shell renders as a red pulse ON TOP
  // of that text — left `false` here until a later story wires an attention
  // source (e.g. queued persona posts). The badge is omitted while empty.
  const { personas } = usePersonas()
  const personaCount = personas.length

  useRegisterSurfaceTool({
    id: PERSONAS_TOOL_ID,
    label: 'PERSONAS',
    icon: faMasksTheater,
    tooltip: 'Post as persona (⌘K) — search a persona and compose',
    badge: personaCount > 0 ? { count: personaCount, escalating: false } : undefined,
  })

  // ⌘K binding lives here (the composition owner); the palette itself is a
  // controlled overlay. The "Personas" tool's active state ALSO opens the
  // palette, so the two share one open state.
  const [keyboardPaletteOpen, setKeyboardPaletteOpen] = useState(false)
  const personasToolActive = isActive(PERSONAS_TOOL_ID)
  const paletteOpen = keyboardPaletteOpen || personasToolActive

  const closePalette = useCallback(() => {
    setKeyboardPaletteOpen(false)
    if (isActive(PERSONAS_TOOL_ID)) toggleTool(PERSONAS_TOOL_ID)
  }, [isActive, toggleTool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        setKeyboardPaletteOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The persona-dock host opens once a persona is selected (from the palette,
  // or — at integration — from the picker). Persona content mounts into its
  // slots at integration; empty here.
  const [dockPersonaId, setDockPersonaId] = useState<string | null>(null)
  const handleSelectPersona = useCallback((personaId: string) => {
    setDockPersonaId(personaId)
  }, [])
  const closeDock = useCallback(() => setDockPersonaId(null), [])

  return (
    <Box
      data-testid="controller-console"
      // Positioning context for the console's own flyouts (persona-dock host),
      // anchored to the work area's edges — mirrors the evaluator dashboard page.
      sx={{ position: 'relative', height: '100%', overflow: 'hidden' }}
    >
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
        <Stack sx={{ gap: 1.5, p: '18px 22px', minHeight: '100%' }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <FontAwesomeIcon icon={faTowerBroadcast} color={staffShellTokens.header.background} />
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

          <Typography sx={{ fontSize: 12, color: staffShellTokens.accent.secondaryText }}>
            Press <Box component="kbd" sx={{ fontWeight: 700 }}>⌘K</Box> (or Ctrl+K), or open the
            Personas tool, to post as a persona. Live world, the review queue, and other surfaces
            dock here as they land.
          </Typography>
        </Stack>
      </Box>

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onSelectPersona={handleSelectPersona}
        renderPersonaResults={renderPersonaResults}
      />

      <PersonaDockHost open={dockPersonaId !== null} onClose={closeDock} slots={dockSlots} />
    </Box>
  )
}
