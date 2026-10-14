/**
 * features/controller/personaEdit — public surface (demo-polish story 21 / PE-FE).
 *
 * The console route mounts exactly one thing from here:
 * `<PersonaEditButton persona={activePersona} />` (through the persona context
 * panel's `actionsSlot`). Everything else in this folder is internal to the edit
 * dialog. Staff world (COBRA) — never import this from a participant surface.
 */

export { PersonaEditButton } from './PersonaEditButton'
export type { PersonaEditButtonProps } from './PersonaEditButton'
