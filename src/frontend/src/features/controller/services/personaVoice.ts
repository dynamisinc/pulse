/**
 * features/controller/services/personaVoice.ts
 * ---------------------------------------------------------------------------
 * Pure-read helpers for `<PersonaContextPanel>` (feature: persona-operation,
 * story 03 "Composer shows persona context while writing"; CTL-003, COR-020,
 * SOC-054, D5-014/2.4). Staff world (COBRA) — no UI here, just data reads.
 *
 * GROUNDING CORRECTION this module encodes: `voiceNotes` (COR-020) lives on
 * the org-library `PersonaTemplate`, NOT on the exercise-scoped `Persona`
 * instance — an instance only carries `templateId`. `resolveVoiceNotes` is
 * the one place that indirection happens, so the panel never reads
 * `persona.voiceNotes` (which does not exist on the type) directly.
 *
 * `categoryChipLabel` derives the D5-014/2.4 "POSTING AS {category}"
 * wrong-persona-defense label from `PersonaType` — text-only, never
 * color-only (NFR-001), and exhaustive over every `PersonaType` so a future
 * archetype fails the build here rather than silently rendering blank.
 */

import { personaTemplateById, type Persona, type PersonaType, type AudienceBand } from '@/features/personas'

/**
 * Resolves a persona instance's voice/personality notes (COR-020) via its
 * template. Returns `undefined` if the template cannot be found (e.g. a
 * stale/unknown `templateId`) rather than throwing — the panel renders a
 * clear "not available" state instead of crashing the composer.
 */
export function resolveVoiceNotes(persona: Persona): string | undefined {
  return personaTemplateById(persona.templateId)?.voiceNotes
}

/**
 * The D5-014/2.4 "POSTING AS {category}" chip label — a wrong-persona defense
 * that must be unmissable and distinct per category. The label TEXT itself
 * carries the signal (NFR-001); callers must not rely on color alone.
 *
 * Mapping (per the story's grounding + D5 mockup vocabulary):
 * `citizen` -> "CITIZEN VOICE"; `agency` / `weather-scientific` ->
 * "OFFICIAL ACCOUNT"; `news-outlet` -> "NEWS / MEDIA". The remaining
 * archetypes (`influencer`, `business`, `bad-actor`) are not in the D5
 * mockup's three-way split but still need a distinct, unmissable label so no
 * `PersonaType` ever falls through unlabeled.
 */
export function categoryChipLabel(personaType: PersonaType): string {
  switch (personaType) {
    case 'citizen':
      return 'CITIZEN VOICE'
    case 'agency':
    case 'weather-scientific':
      return 'OFFICIAL ACCOUNT'
    case 'news-outlet':
      return 'NEWS / MEDIA'
    case 'influencer':
      return 'INFLUENCER / CREATOR'
    case 'business':
      return 'BUSINESS ACCOUNT'
    case 'bad-actor':
      return 'UNOFFICIAL / BAD ACTOR'
    default: {
      // Exhaustiveness guard: a future 8th PersonaType fails the build here
      // rather than silently rendering an unlabeled chip.
      const exhaustiveCheck: never = personaType
      return exhaustiveCheck
    }
  }
}

/** Human-readable label for the SOC-054 audience-magnitude band. Read-only
 * vocabulary — never recomputes the band itself (that is E2's concern). */
export function audienceBandLabel(band: AudienceBand): string {
  switch (band) {
    case 'nano':
      return 'Nano audience'
    case 'micro':
      return 'Micro audience'
    case 'mid':
      return 'Mid-size audience'
    case 'large':
      return 'Large audience'
    case 'mega':
      return 'Mega audience'
    default: {
      const exhaustiveCheck: never = band
      return exhaustiveCheck
    }
  }
}
