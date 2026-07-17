/**
 * features/personas/casts.ts
 * ---------------------------------------------------------------------------
 * Named casts (feature: persona-management, story 02; COR-021). A Cast is a
 * planner-assembled, reusable grouping of org-library templates ("Mid-size US
 * city baseline: 2 news outlets, 6 agencies, 40 citizens" is the epic's
 * example) that seeds an exercise in one action (`seedCast`).
 *
 * Staff world (authoring data) — no UI, no COBRA. Casts reference templates by
 * id and carry no exercise-scoped state themselves; the instances do.
 */

import { PERSONA_TEMPLATES } from './personaTemplates'

/** A named, reusable grouping of persona templates (COR-021). */
export interface Cast {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Ordered template ids this cast instantiates. */
  readonly templateIds: readonly string[]
}

/**
 * The Fairhaven baseline cast — every template in the seed library, in a
 * sensible feed order (official voices, outlets, then citizens). Instantiated
 * by `seedCast` into exercise-scoped personas.
 */
export const FAIRHAVEN_BASELINE: Cast = {
  id: 'cast-fairhaven-baseline',
  name: 'Fairhaven baseline',
  description:
    'Baseline Fairhaven water-arc population: official utility + county EM, a broadcast and a ' +
    'sensational outlet, a lookalike impersonator (SOC-052), and a handful of citizens.',
  templateIds: PERSONA_TEMPLATES.map(t => t.id),
}

/** All named casts available to seed from (a single baseline for now). */
export const CASTS: readonly Cast[] = [FAIRHAVEN_BASELINE]
