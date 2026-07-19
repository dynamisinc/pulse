/**
 * features/controller/services/composeService.ts
 * ---------------------------------------------------------------------------
 * The post-as-persona publish SEAM (feature: persona-operation, story 01 —
 * "Post as any persona into an enabled channel"; CTL-001, COR-018, SOC-003,
 * XC-002, R-003). Staff world (Controller Console) — pure model/service
 * module, no UI, no COBRA.
 *
 * KEYSTONE, SECURITY-CRITICAL. This is the one place the console turns a
 * controller's compose action into a published post. It does exactly ONE
 * thing: forward to the SHIPPED `createPost` (`@/features/social`) with
 * `origin: 'controller-as-persona'` and the acting-human attribution
 * (COR-018). It is a thin, deliberately un-clever wrapper:
 *
 *   - It does NOT re-implement sanitization (NFR-004) — `createPost` owns it.
 *   - It does NOT build/emit the XC-004 telemetry event — `createPost` emits
 *     exactly one `'post'` event via the caller-safe `buildAndEmit`. Never
 *     call `buildAndEmit` here for a post; that would double-count.
 *   - It does NOT read the clock or the exercise context — those are supplied
 *     as inputs by the caller (`useComposeAsPersona`), keeping this pure and
 *     unit-testable (mirrors `postService.createPost`'s own pure contract).
 *
 * TWO WORLDS / ISOLATION
 *   - The produced `Post` carries staff/telemetry-only provenance (`origin`,
 *     `actingHumanId`, `createdWallClock`). That provenance must NEVER reach a
 *     participant surface — the ONLY participant path is `toParticipantView`
 *     (`@/features/social`), which structurally drops those fields (XC-002,
 *     SOC-003). This module never narrows to a participant view itself.
 *   - `exerciseId`/`timeZone` are STAMPING inputs only (COR-001) — never a
 *     client query-scoping param.
 *
 * SCOPE (Wave 1): POST-ONLY. The shipped `Post` model has no parent/thread/
 * quote field, so reply-, repost/quote-, and DM-as-persona are not
 * representable and are a documented Post-model-extension follow-up — not
 * built here.
 */

import { createPost, type Post, type PostMedia } from '@/features/social'

/**
 * Input to {@link composeAsPersona}. Mirrors the participant-safe subset of
 * `CreatePostInput` — but `origin` is NOT accepted: it is fixed to
 * `'controller-as-persona'` inside, so a caller can never post-as-persona under
 * any other provenance. `authorPersonaId` is the ACTIVE persona's id (the world
 * the controller is speaking as); `actingHumanId` is the operating controller
 * (COR-018), supplied by the caller — never inferred here.
 */
export interface ComposeAsPersonaInput {
  /** Stamping only (COR-001) — from `useExerciseContext()`. */
  readonly exerciseId: string
  /** Stamping only (COR-001) — from `useExerciseContext()`. */
  readonly timeZone: string
  /** Scenario ISO instant (COR-053) — `scenarioNow().toISOString()`. */
  readonly scenarioTime: string
  /** The ACTIVE persona's INSTANCE id — the account the post is authored as. */
  readonly authorPersonaId: string
  /** The operating controller behind the shared persona (COR-018). */
  readonly actingHumanId: string
  readonly text: string
  readonly media?: PostMedia[]
}

/**
 * Publishes a post AS the active persona, through the shipped `createPost`
 * pipeline with a fixed `origin: 'controller-as-persona'`. Returns the full
 * `Post` (staff-side); sanitization (NFR-004) and the single XC-004 telemetry
 * event both happen inside `createPost` — this function adds neither.
 *
 * Never throws because of telemetry — `createPost`'s `buildAndEmit` is
 * caller-safe, so a dead telemetry pipeline can never block a controller's
 * post.
 */
export function composeAsPersona(input: ComposeAsPersonaInput): Post {
  return createPost({
    exerciseId: input.exerciseId,
    timeZone: input.timeZone,
    scenarioTime: input.scenarioTime,
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text: input.text,
    ...(input.media !== undefined ? { media: input.media } : {}),
    // FIXED provenance — the whole point of this seam (SOC-003, R-003). A
    // controller posting AS a persona is always `controller-as-persona`.
    origin: 'controller-as-persona',
  })
}
