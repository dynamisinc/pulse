/**
 * features/controller/hooks/useComposeAsPersona.ts
 * ---------------------------------------------------------------------------
 * The compose-as-persona state machine behind `<PersonaComposer>` (feature:
 * persona-operation, story 01; CTL-001, COR-018, COR-053, XC-004). Staff world
 * (Controller Console) — pure hook, no UI, no COBRA.
 *
 * Mirrors the shipped participant `useComposePost`, but for the controller's
 * "speak as the world" path:
 *   - Draft state: `text` + a character counter (`length`/`remaining`/
 *     `isOverLimit`), so an over-length post is blocked before it is fired.
 *   - `publish()`, the single sanctioned path: assembles the STAMPING inputs
 *     (`exerciseId`/`timeZone` from `useExerciseContext()`, `scenarioTime` from
 *     `scenarioNow()`) and calls `composeAsPersona` — which forwards to the
 *     shipped `createPost` with `origin: 'controller-as-persona'`. This hook
 *     re-implements NEITHER sanitization (NFR-004) NOR telemetry (XC-004);
 *     both live in `createPost`.
 *
 * INPUTS, NOT IMPORTS (Wave-1 parallel-build contract):
 *   - `activePersona` — the persona to post AS — is a PROP from
 *     persona-operation/02's `useActivePersona()`. This hook does not import
 *     that feature; it only reads `activePersona.id`.
 *   - `actingHumanId` — the operating controller (COR-018) — is a PROP from
 *     console-shell/01's `useControllerIdentity()`. Not imported here.
 *
 * TIME (COR-053): `scenarioTime` is `scenarioNow().toISOString()` — the
 * participant-visible instant is always scenario time, never wall-clock. (The
 * console's dual-time FIRE readout is a staff-side display concern owned by the
 * component, not this hook.)
 *
 * ISOLATION (COR-001): `exerciseId`/`timeZone` from `useExerciseContext()`
 * STAMP the post/telemetry only — never a fetch-scoping param.
 */

import { useCallback, useMemo, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import type { Persona } from '@/features/personas'
import type { Post } from '@/features/social'
import { composeAsPersona } from '../services/composeService'

/** Default per-exercise character limit (mirrors the participant composer, SOC-001). */
export const DEFAULT_CHAR_LIMIT = 280

/** Options for {@link useComposeAsPersona}. */
export interface UseComposeAsPersonaOptions {
  /** The persona to post AS (persona-operation/02 input — never imported). */
  readonly activePersona: Persona
  /** The operating controller behind the persona (COR-018; console-shell/01 input). */
  readonly actingHumanId: string
  /** Per-exercise character limit; defaults to {@link DEFAULT_CHAR_LIMIT}. */
  readonly charLimit?: number
  /** Called with the created `Post` after a successful publish. Mirrors the
   * shipped `Composer`'s `onPosted` seam — the composer never touches a feed. */
  readonly onPublished?: (post: Post) => void
}

/** The compose surface `<PersonaComposer>` binds to. */
export interface UseComposeAsPersonaResult {
  readonly text: string
  readonly setText: (value: string) => void
  readonly charLimit: number
  /** Code-point length of the current text (emoji-aware). */
  readonly length: number
  /** `charLimit - length` — negative when over the limit. */
  readonly remaining: number
  /** Text is longer than the limit — publish is blocked. */
  readonly isOverLimit: boolean
  /** All conditions met to publish (non-empty content, within limit). */
  readonly canPublish: boolean
  /** Sanitizes + publishes via `composeAsPersona`, clears the draft, fires
   * `onPublished`. A no-op unless `canPublish`. */
  readonly publish: () => void
}

/**
 * The compose-as-persona state + publish machine. See the module header for the
 * full contract; `<PersonaComposer>` is its only intended consumer.
 */
export function useComposeAsPersona(
  options: UseComposeAsPersonaOptions,
): UseComposeAsPersonaResult {
  const { activePersona, actingHumanId, charLimit = DEFAULT_CHAR_LIMIT, onPublished } = options
  const { exerciseId, timeZone } = useExerciseContext()

  const [text, setText] = useState('')

  // Code-point length so a multi-byte emoji counts as one character (X-style).
  const length = useMemo(() => [...text].length, [text])
  const remaining = charLimit - length
  const isOverLimit = remaining < 0
  const hasContent = text.trim().length > 0
  const canPublish = hasContent && !isOverLimit

  const publish = useCallback(() => {
    // Re-derive the guard locally rather than trust a stale `canPublish`
    // closure — a forced submit must still no-op when it shouldn't fire.
    if (text.trim().length === 0) return
    if ([...text].length > charLimit) return

    const post = composeAsPersona({
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      authorPersonaId: activePersona.id,
      actingHumanId,
      text,
    })

    setText('')
    onPublished?.(post)
  }, [exerciseId, timeZone, activePersona.id, actingHumanId, text, charLimit, onPublished])

  return {
    text,
    setText,
    charLimit,
    length,
    remaining,
    isOverLimit,
    canPublish,
    publish,
  }
}
