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
 *     both live in `createPost`. `composeAsPersona` stays PURE (no network
 *     call inside it) — see the live persist below.
 *
 * LIVE PERSIST (UAT fix — behind `USE_MOCK_DATA`, `@/core/config/mockData`).
 * The console still needs the LOCAL `Post` `composeAsPersona` returns (its
 * own-tab optimistic view via `postStore.appendPost`, wired at the
 * integration root, and the R-003 origin-label line), so this path keeps
 * calling `composeAsPersona`/`createPost` in EITHER mode. In LIVE mode this
 * hook ADDITIONALLY fires `livePostActions.publishPost` — fire-and-forget,
 * `origin: 'controller-as-persona'`, no client `exerciseId` (COR-001) — so
 * the post actually PERSISTS and reaches participants via the feed baseline
 * fix (`useFeed`) + the SignalR "▲ N new posts" pill (`useFeedStream`),
 * instead of living only in the console's own tab.
 *
 * ACCEPTED TELEMETRY TRADEOFF: in live mode this path emits the frontend
 * `createPost` XC-004 event AND the backend emits its own authoritative one
 * for the same POST — a known, accepted double-count until Phase-B2 auth
 * makes the server the sole emitter. The participant path
 * (`useComposePost.publish`) avoids this by being POST-only (no local
 * `createPost` call at all) because it has no console view depending on the
 * returned `Post`; this path keeps `createPost` specifically because the
 * console consumes it.
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
 * `livePostActions.publishPost` drops `exerciseId` from the wire body
 * entirely; the server stamps scope from the session.
 *
 * DRAFT SURVIVES UNMOUNT (autonomy-safety story 06, Gate-1 WR-103). The
 * console can unmount `<PersonaComposer>` out from under an in-progress draft
 * for reasons that are NOT an explicit close intent — e.g. `ControllerConsole`
 * closes the persona-dock host when a DIFFERENT toolstrip tool activates
 * (WR-005), which is not the operator choosing to discard their text. A
 * `useState('')` alone would silently drop unsaved text in that case. So the
 * draft is ADDITIONALLY mirrored into a tiny module-level store keyed by
 * `(exerciseId, personaId)` (`draftByKey`, below) on every `setText`; a fresh
 * mount for the SAME target seeds its initial state from that store instead
 * of `''`, and `publish()` clears the stored entry (mirroring the local
 * `setText('')` it already does) so a sent post never reappears as a leftover
 * draft. This does not change the EXPLICIT discard paths (Esc/X on the dock)
 * — those still lose the draft, which is the correct, expected behavior for
 * an explicit close.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { Persona } from '@/features/personas'
import type { Post } from '@/features/social'
import { publishPost } from '@/features/social/services/livePostActions'
import { composeAsPersona } from '../services/composeService'

/** Default per-exercise character limit (mirrors the participant composer, SOC-001). */
export const DEFAULT_CHAR_LIMIT = 280

// ---------------------------------------------------------------------------
// The unsaved-draft-survives-unmount store (Gate-1 WR-103)
// ---------------------------------------------------------------------------

/** `"exerciseId::personaId" -> in-progress draft text`. Absent = no draft (the common case). */
const draftByKey = new Map<string, string>()

function draftKey(exerciseId: string, personaId: string): string {
  return `${exerciseId}::${personaId}`
}

function getPersistedDraft(exerciseId: string, personaId: string): string {
  return draftByKey.get(draftKey(exerciseId, personaId)) ?? ''
}

/** Empty text is never worth remembering — treat it as "no draft" (keeps the map small). */
function setPersistedDraft(exerciseId: string, personaId: string, text: string): void {
  const key = draftKey(exerciseId, personaId)
  if (text === '') {
    draftByKey.delete(key)
  } else {
    draftByKey.set(key, text)
  }
}

/** Clears every persisted draft. Test-only — prevents cross-test pollution. */
function resetForTests(): void {
  draftByKey.clear()
}

/** The module-singleton persisted-draft store. Exposed for test-only reset. */
export const composeAsPersonaDraftStore = { resetForTests }

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

  const [text, setTextState] = useState(() => getPersistedDraft(exerciseId, activePersona.id))

  // If the compose TARGET changes (a different exercise or persona — NOT
  // merely a remount for the SAME one, which the lazy initializer above
  // already handles), adopt THAT target's own persisted draft instead of
  // carrying over whatever was mid-typed for the previous target. One extra
  // render on a genuine target change is an acceptable, standard trade for
  // staying lint-clean (`react-hooks/refs` forbids reading/writing a ref
  // during render, even for this "adjust state" pattern).
  useEffect(() => {
    // Deliberately re-seeds on every mount too (redundant with, but never in
    // conflict with, the lazy initializer above — same value either way).
    setTextState(getPersistedDraft(exerciseId, activePersona.id))
  }, [exerciseId, activePersona.id])

  // Mirrors every keystroke into the persisted-draft store (Gate-1 WR-103) —
  // see the module header. Cheap (a single Map write).
  const setText = useCallback(
    (value: string) => {
      setTextState(value)
      setPersistedDraft(exerciseId, activePersona.id, value)
    },
    [exerciseId, activePersona.id],
  )

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

    const scenarioTime = scenarioNow().toISOString()

    // `composeAsPersona` stays PURE (no network call inside it) — the console
    // needs this LOCAL `Post` for its own-tab optimistic view + R-003 origin
    // label regardless of mode (see the module header).
    const post = composeAsPersona({
      exerciseId,
      timeZone,
      scenarioTime,
      authorPersonaId: activePersona.id,
      actingHumanId,
      text,
    })

    // LIVE PERSIST (UAT fix): additionally fire-and-forget the real POST so
    // the post reaches participants (feed baseline + SignalR pill), never
    // awaited here — a rejection is swallowed, matching `liveReviewActions`'
    // fire-and-forget convention. Accepted telemetry tradeoff: this ALSO
    // means `createPost`'s XC-004 event above fires alongside the backend's
    // own authoritative one for the same post — see the module header.
    if (!USE_MOCK_DATA) {
      publishPost({
        exerciseId,
        timeZone,
        scenarioTime,
        authorPersonaId: activePersona.id,
        actingHumanId,
        text,
        origin: 'controller-as-persona',
      }).catch(() => {})
    }

    // Clears both the local state AND the persisted draft (WR-103) — a sent
    // post must never reappear as a leftover draft on a later remount.
    setText('')
    onPublished?.(post)
  }, [exerciseId, timeZone, activePersona.id, actingHumanId, text, charLimit, onPublished, setText])

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
