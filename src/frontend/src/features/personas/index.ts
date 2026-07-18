/**
 * features/personas — public barrel.
 *
 * The mock persona seed (feature: persona-management, stories 01 templates + 02
 * casts/seeding). Consumers (Social E2 — PostCard authors, post attribution)
 * import the `Persona` type and the read hooks from `@/features/personas`.
 *
 * Templates are org-library + reusable; instances (`Persona`) are exercise-
 * scoped and produced by `seedCast`. Staff/data world — no UI, no COBRA.
 */

export type {
  PersonaType,
  PersonaKind,
  AudienceBand,
  PersonaTemplate,
  Persona,
} from './types'
export { verificationDefaultFor, personaIdForHandle } from './types'

export type { Cast } from './casts'
export { FAIRHAVEN_BASELINE, CASTS } from './casts'

export { PERSONA_TEMPLATES, personaTemplateById } from './personaTemplates'

export { seedCast } from './seedCast'

export type { UsePersonasResult } from './personaService'
export {
  SEEDED_PERSONAS,
  personaById,
  resolvePersonas,
  usePersonas,
  usePersonaTemplates,
} from './personaService'
