/**
 * features/controller/console/personaDockHost.ts
 * ---------------------------------------------------------------------------
 * Shared ids + slot contract for the console's PERSONA-DOCK HOST (feature:
 * console-shell, story 01 — "Toolstrip + flyouts"; D5-004/015/017/018,
 * D7-011; see docs/features/console-shell/01-toolstrip-flyouts.md AC
 * "Persona-dock host").
 *
 * The persona-dock host is a console-owned, NAMED flyout mount slot that
 * subsequent `persona-operation` content — picker → composer → context panel —
 * renders INTO at the serial integration step. This story ships the slot
 * itself (`personaDockHost.tsx`) and this module's shared vocabulary; it ships
 * NO persona content (that would duplicate `persona-operation`'s ownership).
 *
 * The `PersonaDockSlots` interface is the INPUT contract the integration step
 * fills: `persona-operation`'s components are passed in as `ReactNode` slots
 * (never imported by this feature — parallel-build contract). Empty of persona
 * content until then; the host renders a neutral placeholder in the meantime.
 *
 * World: staff (COBRA/Cadence). Pure ids/types — no UI, no participant surface
 * (XC-002).
 */

import type { ReactNode } from 'react'

/**
 * Stable toolstrip-registry id for the console's "Personas" surface tool —
 * exported so the console + its tests never hand-copy the string. Unique across
 * the WHOLE toolstrip (both zones), per the registry's cross-zone-id invariant.
 */
export const PERSONAS_TOOL_ID = 'personas'

/** Accessible/section title for the persona-dock host flyout. */
export const PERSONA_DOCK_HOST_TITLE = 'Post as persona'

/**
 * The named mount slots the persona-dock host exposes. The integration step
 * fills these with `persona-operation`'s components:
 *   - `picker`  → persona-operation/02's `PersonaPicker`
 *   - `composer`→ persona-operation/01's `PersonaComposer`
 *   - `contextPanel` → persona-operation/03's `PersonaContextPanel`
 * All optional so the host renders standalone (empty) during the fan-out; a
 * host with no slots filled shows a neutral "wired at integration" placeholder.
 */
export interface PersonaDockSlots {
  /** Persona picker slot (persona-operation/02) — choose which persona to post as. */
  picker?: ReactNode
  /** Persona composer slot (persona-operation/01) — the "post as persona" surface. */
  composer?: ReactNode
  /** Persona context panel slot (persona-operation/03) — who/what you're posting as. */
  contextPanel?: ReactNode
}
