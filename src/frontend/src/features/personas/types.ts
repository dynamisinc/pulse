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
 * FOLLOW-GRAPH COUNT FIELDS (profiles-social-graph/02 + backend story 07,
 * SOC-051/SOC-054): `followerCount` is the DISPLAYED count (magnitude + real
 * inbound follow edges); `followingCount` is the real outbound-edge count;
 * `audienceMagnitude` is the raw SOC-054 simulated-crowd number
 * `followerCount` is composed from. All three now ride the wire
 * (`GET /api/personas`) on BOTH world shapes — they carry no archetype tell,
 * unlike `personaType`. They are declared OPTIONAL here (not narrowed at the
 * read seam the way `bio` is) because the Wave-1 mock cast
 * (`personaService.SEEDED_PERSONAS` / `seedCast`) does not populate
 * `followingCount`/`audienceMagnitude` yet — only `followerCount` — and
 * making them required would force an unrelated mock-fixture rewrite outside
 * this story's scope. A real backend response supplies both; treat their
 * absence as "not yet known" (e.g. render nothing / a loading dash), never as
 * zero.
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
 *
 * TWO INSTANCE SHAPES, DELIBERATELY SEPARATE (SOC-052 / D1-008; mirrors the
 * XC-002 `Post` / `ParticipantPostView` split in
 * `@/features/social/types/post.ts`):
 *
 *   - `Persona` — the ONLY shape a participant surface may ever receive. It
 *     has NO `personaType` field: not hidden, not optional, structurally
 *     ABSENT, so a participant surface cannot even compile a read of
 *     `persona.personaType`. This is the whole point — `personaType` is a
 *     machine-readable tell that would identify the `bad-actor` impersonator
 *     without reference to the verified seal, and SOC-052/D1-008 require that
 *     ABSENCE OF THE VERIFIED MARK be the only signal a participant gets.
 *
 *   - `StaffPersona` — the participant shape WIDENED by exactly that one
 *     field, for the staff world (persona picker/type filter, the composer's
 *     "POSTING AS {category}" chip). Mirrors the backend's
 *     `PersonaResponseDto` / `StaffPersonaResponseDto` split: `GET
 *     /api/personas` projects the staff DTO only for a live staff-kind
 *     session, and the participant DTO for everyone else (anonymous /
 *     participant / read-only / expired).
 *
 * `personaType` is deliberately NOT optional on either shape. An optional
 * field would weaken staff typing and let a missing value fail SILENTLY at
 * runtime (an unlabeled category chip, a type filter that matches nothing)
 * instead of loudly at compile time / at the read seam. See
 * `personaService.resolveStaffPersonas` for the runtime half of that guard.
 */

/** The seven persona archetypes (COR-020). Drives default styling, the
 * verification default (`verificationDefaultFor`), and — later — the E8
 * engine's behavior profile.
 *
 * Declared as a `const` tuple so the union and the runtime vocabulary
 * (`isPersonaType`, used by the staff read seam's validator) can never drift
 * apart — an 8th archetype is added in exactly one place. */
export const PERSONA_TYPES = [
  'news-outlet',
  'agency',
  'weather-scientific',
  'citizen',
  'influencer',
  'business',
  'bad-actor',
] as const

export type PersonaType = typeof PERSONA_TYPES[number]

/**
 * Runtime membership test for the `PersonaType` vocabulary. Used by the STAFF
 * read seam to reject a body whose `personaType` is missing or out of
 * vocabulary, rather than let an `undefined` flow into the console's type
 * filter / category chip (where it would silently mis-render).
 */
export function isPersonaType(value: unknown): value is PersonaType {
  return typeof value === 'string' && (PERSONA_TYPES as readonly string[]).includes(value)
}

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
 * COR-021), in the PARTICIPANT projection. Carries believable derived state
 * (`followerCount`, `joinedAt`) that a template does not and cannot have,
 * since it depends on which exercise + cast it was seeded into.
 *
 * Deliberately has NO `personaType` field — that key does not exist on this
 * type at all (SOC-052/D1-008; see the module header). A participant may only
 * ever infer an account's trustworthiness from the presence/absence of the
 * verified mark, never from a machine-readable archetype label.
 * `personaService.toParticipantPersona` is the sole sanctioned way to narrow a
 * `StaffPersona` down to this shape.
 */
export interface Persona {
  readonly id: string
  readonly exerciseId: string
  readonly templateId: string
  readonly displayName: string
  readonly handle: string
  readonly kind: PersonaKind
  readonly verified: boolean
  readonly avatarColor: string
  readonly initials: string
  readonly bio?: string
  readonly audienceBand: AudienceBand
  /** Derived from `audienceBand` at seed time (COR-021, SOC-054) — never authored directly.
   * This is the DISPLAYED count (magnitude + real inbound follow edges, backend story 07). */
  readonly followerCount: number
  /**
   * The real outbound follow-edge count (profiles-social-graph/02+07,
   * SOC-051) — how many accounts THIS persona follows. Optional: see the
   * module header's "FOLLOW-GRAPH COUNT FIELDS" note. Absence means "not yet
   * known", never zero.
   */
  readonly followingCount?: number
  /**
   * The raw SOC-054 audience-magnitude number `followerCount` is composed
   * from (profiles-social-graph/05's `audienceReach()`/`FollowerList` consume
   * this once story 05 wires it live). Optional: see the module header's
   * "FOLLOW-GRAPH COUNT FIELDS" note. Absence means "not yet known", never
   * zero.
   */
  readonly audienceMagnitude?: number
  /** Scenario ISO instant PREDATING the exercise (rendered later via COR-053; never wall-clock). */
  readonly joinedAt: string
}

/**
 * The STAFF projection of a persona instance: `Persona` widened by exactly
 * one field, `personaType`. Served only to a live staff-kind session (the
 * backend's `StaffPersonaResponseDto`); resolved only through
 * `personaService.resolveStaffPersonas()` / `useStaffPersonas()`.
 *
 * Because it EXTENDS `Persona`, a `StaffPersona` is freely usable anywhere a
 * `Persona` is expected — a staff component that reads only the common fields
 * (name/handle/avatar/verified) should keep declaring `Persona` and say so;
 * only components that actually read the archetype take `StaffPersona`.
 *
 * NEVER hand one of these to a participant surface as-is — narrow it through
 * `toParticipantPersona` first.
 */
export interface StaffPersona extends Persona {
  /** The archetype (COR-020). STAFF-ONLY (SOC-052/D1-008) — never participant-visible. */
  readonly personaType: PersonaType
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
