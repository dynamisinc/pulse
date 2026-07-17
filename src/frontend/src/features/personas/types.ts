/**
 * features/personas/types.ts
 * ---------------------------------------------------------------------------
 * The persona data model (feature: persona-management, stories 01 "Persona
 * templates" + 02 "Casts & seeding"; COR-020, COR-021, SOC-054). Staff world:
 * `PersonaTemplate` is org-library authoring data (planners create/edit/clone/
 * archive these, story 01); `Persona` is the exercise-scoped INSTANCE story 02
 * seeding produces from a template. Do not conflate the two shapes — a
 * template is reusable across exercises, an instance belongs to exactly one.
 *
 * This module is the CONTRACT other Social E2 stories build against (notably
 * `posts/02-post-rendering-identity.md` and `posts/03-post-provenance.md`,
 * which import `Persona` to render/attribute a post's author). The field
 * shapes here are locked; do not add/rename fields without checking those
 * consumers.
 *
 * Design decisions consumed downstream (not rendered here — this module is
 * pure data/logic, no UI, no COBRA):
 * - R-004 (avatar treatment): `kind` distinguishes human (duotone silhouette)
 *   from org (monogram) accounts; `avatarColor` + `initials` are the raw
 *   inputs either rendering consumes.
 * - R-001 (verified seal): `verified` drives the fixed seal-blue `#2D9CDB`
 *   mark — never themed by the exercise accent (SOC-052, COR-030).
 * - SOC-052 (impersonation training): lookalike unverified accounts must be
 *   visually possible, so `verified` is a plain per-template/per-instance
 *   flag, never inferred from `personaType` or `kind` alone.
 *
 * Instance ids are STABLE and DETERMINISTIC (`personaIdForHandle`) precisely
 * so sibling stories (e.g. posts/03 authoring fixture posts) can reference an
 * author id without importing this feature's seeded fixture array.
 */

/** The seven persona archetypes (COR-020). Drives default styling, the
 * verification default (`verificationDefaultFor`), and — later — the E8
 * engine's behavior profile. */
export type PersonaType =
  | 'news-outlet'
  | 'agency'
  | 'weather-scientific'
  | 'citizen'
  | 'influencer'
  | 'business'
  | 'bad-actor'

/** Human (individual) vs org/institutional account. Governs the R-004 avatar
 * treatment (duotone silhouette vs monogram) — never inferred from
 * `personaType`, since a `bad-actor` impersonating an org is still `'org'`. */
export type PersonaKind = 'human' | 'org'

/** Audience magnitude band (SOC-054) — the only follower-count vocabulary;
 * never a raw exact number authored by a planner. Seeding (`seedCast`) derives
 * a concrete `followerCount` from this band. */
export type AudienceBand = 'nano' | 'micro' | 'mid' | 'large' | 'mega'

/**
 * An org-library persona template. Reusable across exercises (NOT
 * exercise-scoped) — story 01. `voiceNotes` is Phase-1-critical (COR-020):
 * the Phase-2 E8 engine's believability depends entirely on the quality of
 * this field, so it is required and must never be an empty string.
 */
export interface PersonaTemplate {
  readonly id: string
  readonly displayName: string
  /** Stored WITHOUT a leading '@' (rendering adds it). */
  readonly handle: string
  readonly kind: PersonaKind
  readonly personaType: PersonaType
  readonly verified: boolean
  readonly avatarColor: string
  readonly initials: string
  readonly bio?: string
  readonly audienceBand: AudienceBand
  /** First-class, Phase-1-critical voice/personality notes (COR-020). Never empty. */
  readonly voiceNotes: string
  readonly backstory?: string
}

/**
 * An exercise-scoped persona INSTANCE, produced by `seedCast` (story 02,
 * COR-021). Carries believable derived state (`followerCount`, `joinedAt`)
 * that a template does not and cannot have, since it depends on which
 * exercise + cast it was seeded into.
 */
export interface Persona {
  readonly id: string
  readonly exerciseId: string
  readonly templateId: string
  readonly displayName: string
  readonly handle: string
  readonly kind: PersonaKind
  readonly personaType: PersonaType
  readonly verified: boolean
  readonly avatarColor: string
  readonly initials: string
  readonly bio?: string
  readonly audienceBand: AudienceBand
  /** Derived from `audienceBand` at seed time (COR-021, SOC-054) — never authored directly. */
  readonly followerCount: number
  /** Scenario ISO instant PREDATING the exercise (rendered later via COR-053; never wall-clock). */
  readonly joinedAt: string
}

/**
 * Persona types whose templates default `verified` to `true` (news outlets,
 * agencies, and weather/scientific bodies are institutionally-verifiable
 * voices). Every other type defaults to `false`. This is a DEFAULT, not a
 * rule: a template may still override it explicitly — SOC-052 requires that
 * an unverified lookalike of a verified-by-default type (e.g. a fake agency
 * account) remain visually possible, so nothing here forbids that override.
 */
const VERIFIED_BY_DEFAULT_PERSONA_TYPES: ReadonlySet<PersonaType> = new Set([
  'news-outlet',
  'agency',
  'weather-scientific',
])

/**
 * The type-driven default for a template's `verified` flag (COR-020's
 * "persona type drives... verification defaults" AC). Overridable per
 * template — this function only supplies the default, it does not enforce it.
 */
export function verificationDefaultFor(personaType: PersonaType): boolean {
  return VERIFIED_BY_DEFAULT_PERSONA_TYPES.has(personaType)
}

/**
 * The stable, deterministic id for a persona INSTANCE seeded from the
 * template with this `handle`: `persona-<handle-lowercased>`. Deterministic
 * so other features (e.g. posts/03's author attribution) can reference an
 * author id without importing this feature's seeded fixture array.
 */
export function personaIdForHandle(handle: string): string {
  return `persona-${handle.toLowerCase()}`
}
