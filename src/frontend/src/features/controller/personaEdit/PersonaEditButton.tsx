/**
 * features/controller/personaEdit/PersonaEditButton.tsx
 * ---------------------------------------------------------------------------
 * The "Edit persona" button + its dialog — the ONE export the console mounts for
 * persona profile edit (demo-polish story 21 / PE-FE,
 * docs/features/demo-polish/21-persona-profile-edit.md; implementation.md §1.11,
 * §4.2). STAFF world (COBRA).
 *
 * SELF-CONTAINED: it takes the persona to edit and nothing else. The route owner
 * (the orchestrator, `ControllerConsoleRoute.tsx`) mounts it through the persona
 * context panel's `actionsSlot`:
 *
 *   <PersonaContextPanel
 *     persona={activePersona}
 *     actionsSlot={<PersonaEditButton persona={activePersona} />}
 *   />
 *
 * It must render under the console's providers — `ExerciseContextProvider`,
 * `ActivePersonaProvider` (it refreshes the active-persona snapshot after a save)
 * and the app's React Query provider (the media-library picker reads through it) —
 * all of which the console route already supplies.
 *
 * Behaviour: click (or Enter/Space) opens `PersonaEditDialog` for the persona as it is at
 * that moment (a later change of the `persona` prop does not retarget an open dialog);
 * focus is trapped in it and RETURNS TO THIS BUTTON when it closes — however it closes, including
 * Safari, where a click does not focus a button and the browser's own restore would
 * land on `<body>`. After a successful save the dialog closes and a small "Saved"
 * note (icon + word, in a polite live region) appears beside the button for a few
 * seconds, so the outcome is announced and seen even when the only thing that
 * changed is an image.
 */

import { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faPenToSquare } from '@fortawesome/free-solid-svg-icons'
import type { StaffPersona } from '@/features/personas'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { PersonaEditDialog } from './PersonaEditDialog'

export interface PersonaEditButtonProps {
  /** The persona to edit — the console's active persona (the STAFF projection). */
  readonly persona: StaffPersona
}

/** How long the "Saved" note stays beside the button. */
export const SAVED_NOTE_MS = 4000

/** "Edit persona" button + dialog. See the module header. */
export function PersonaEditButton({ persona }: PersonaEditButtonProps) {
  // The persona being edited, FIXED when the dialog opens. The console's active persona can
  // still change while the dialog is up (the console's ⌘K is inert behind a modal, but a
  // persona can be selected by other means, e.g. a "Reply as…" that names one), which changes
  // this component's `persona` prop — the dialog must keep editing the persona the controller
  // clicked Edit on, never silently retarget its draft at another account.
  const [target, setTarget] = useState<StaffPersona | null>(null)
  const open = target !== null
  const [saved, setSaved] = useState<{ readonly personaId: string; readonly count: number } | null>(
    null,
  )
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  // Focus returns to the button after the dialog closes (see the module header). This
  // runs after MUI's own focus-restore cleanup, so it wins.
  useEffect(() => {
    if (wasOpenRef.current && !open) buttonRef.current?.focus()
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (saved === null) return undefined
    const timer = setTimeout(() => setSaved(null), SAVED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [saved])

  const showSaved = saved !== null && saved.personaId === persona.id

  return (
    <Box
      component="span"
      data-testid="persona-edit"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
    >
      <Box
        component="span"
        role="status"
        data-testid="persona-edit-saved"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 12, fontWeight: 700 }}
      >
        {showSaved ? (
          <>
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
            Saved
          </>
        ) : null}
      </Box>
      <CobraSecondaryButton
        ref={buttonRef}
        size="small"
        aria-haspopup="dialog"
        data-testid="persona-edit-button"
        onClick={() => setTarget(persona)}
        startIcon={<FontAwesomeIcon icon={faPenToSquare} />}
        sx={{ paddingLeft: '12px', paddingRight: '12px', fontSize: 12, whiteSpace: 'nowrap' }}
      >
        Edit persona
      </CobraSecondaryButton>
      <PersonaEditDialog
        persona={target ?? persona}
        open={open}
        onClose={() => setTarget(null)}
        onSaved={updated =>
          setSaved(previous => ({ personaId: updated.id, count: (previous?.count ?? 0) + 1 }))}
      />
    </Box>
  )
}
