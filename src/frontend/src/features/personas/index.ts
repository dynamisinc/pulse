/**
 * features/personas — public barrel.
 *
 * The mock persona seed (feature: persona-management, stories 01 templates + 02
 * casts/seeding). Consumers (Social E2 — PostCard authors, post attribution)
 * import the `Persona` type and the read hooks from `@/features/personas`.
 *
 * Templates are org-library + reusable; instances are exercise-scoped and
 * produced by `seedCast`. Staff/data world — no UI, no COBRA.
 *
 * TWO INSTANCE SHAPES (SOC-052/D1-008 — see `types.ts`'s header):
 *   `Persona`      participant projection — NO `personaType`; read via
 *                  `usePersonas()` / `resolvePersonas()`.
 *   `StaffPersona` staff projection — `Persona` + `personaType`; read via
 *                  `useStaffPersonas()` / `resolveStaffPersonas()`.
 * A staff surface that reads the archetype must take `StaffPersona` and the
 * staff read; casting the participant read is never the answer.
 */

export type {
  PersonaType,
  PersonaKind,
  AudienceBand,
  PersonaTemplate,
  Persona,
  StaffPersona,
} from './types'
export {
  PERSONA_TYPES,
  isPersonaType,
  verificationDefaultFor,
  personaIdForHandle,
} from './types'

export type { Cast } from './casts'
export { FAIRHAVEN_BASELINE, CASTS } from './casts'

export { PERSONA_TEMPLATES, personaTemplateById } from './personaTemplates'

export { seedCast } from './seedCast'

export type { UsePersonasResult, UseStaffPersonasResult } from './personaService'
export {
  SEEDED_PERSONAS,
  personaById,
  toParticipantPersona,
  resolvePersonas,
  usePersonas,
  resolveStaffPersonas,
  useStaffPersonas,
  usePersonaTemplates,
} from './personaService'
