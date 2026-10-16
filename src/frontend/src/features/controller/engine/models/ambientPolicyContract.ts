/**
 * features/controller/engine/models/ambientPolicyContract.ts
 * ---------------------------------------------------------------------------
 * The ONE place the ambient-chatter policy wire contract lives on the frontend
 * (story `docs/features/ambient-chatter/01-ambient-background-posting.md`, #168,
 * AC1 + AC2). STAFF world — pure types/constants, no UI.
 *
 * Wire contract (server is authoritative):
 *
 *   GET  /api/engine/settings                    -> EngineSettingsDto gains `ambientPolicy`
 *   POST /api/engine/settings/ambient-policy      body `AmbientPolicyRequestBody`
 *                                                  -> 200 EngineSettingsDto | 400 | 401 | 403
 *
 * A 400 for `mode: 'autonomous'` means PROVIDER-GOVERNANCE §8 does not (yet)
 * authorize autonomous ambient posting in this environment (AC0); `review`
 * stays available. Policy is held in server process memory and resets to
 * `off` on restart.
 */

/** `off` publishes nothing; `review` queues drafts; `autonomous` publishes within the caps. */
export type AmbientMode = 'off' | 'review' | 'autonomous'

/** The ambient policy as served on `EngineSettingsDto.ambientPolicy`. */
export interface AmbientPolicyDto {
  readonly mode: AmbientMode
  readonly maxPerMinute: number
  readonly maxPerHour: number
  /** Topic ids from the server vocabulary. EMPTY means "nothing allowed", never "everything". */
  readonly topicAllowList: readonly string[]
  /** Persona ids of THIS exercise. EMPTY means "nothing allowed". */
  readonly personaAllowList: readonly string[]
  /** If exposed: whether `autonomous` is authorized here (AC0). Absent = unknown, derive from a 400. */
  readonly autonomousAuthorized?: boolean
  /** Server topic vocabulary, if exposed; otherwise {@link FALLBACK_AMBIENT_TOPIC_VOCABULARY}. */
  readonly topicVocabulary?: readonly string[]
  /**
   * Persona ids the engine loop actually voices. Only these post ambient chatter.
   * Absent or `null` = unknown (no loop registered / older server): show no labels.
   */
  readonly voiceablePersonaIds?: readonly string[] | null
}

/** The editable subset sent on POST (plus the acting human / time zone added by the service). */
export interface AmbientPolicyDraft {
  readonly mode: AmbientMode
  readonly maxPerMinute: number
  readonly maxPerHour: number
  readonly topicAllowList: readonly string[]
  readonly personaAllowList: readonly string[]
}

/** POST body: the draft plus the same context fields the other engine-settings POSTs send. */
export interface AmbientPolicyRequestBody extends AmbientPolicyDraft {
  readonly actingHumanId: string
  readonly timeZone: string
}

export const AMBIENT_MODES: readonly AmbientMode[] = ['off', 'review', 'autonomous']

/**
 * Mirrors the server's fixed topic vocabulary (AC1). Used only when
 * `ambientPolicy.topicVocabulary` is absent.
 */
export const FALLBACK_AMBIENT_TOPIC_VOCABULARY: readonly string[] = [
  'local-color',
  'traffic-mundane',
  'food',
  'sports',
  'community-events',
  'pets',
  'local-business',
  'family-school',
]

/** Shown when a save of `autonomous` is rejected with a 400 (AC0 / PROVIDER-GOVERNANCE §8). */
export const AMBIENT_AUTONOMOUS_NOT_AUTHORIZED_MESSAGE =
  'Autonomous ambient posting is not authorized for this environment (PROVIDER-GOVERNANCE §8)'

/** Honest reset-on-restart note, shown in the section regardless of the server's own note. */
export const AMBIENT_RESET_NOTE =
  'Ambient policy is held in server memory and resets to Off when the server restarts.'

/** Fail-safe default: ambient is dark until a controller turns it on. */
export const DEFAULT_AMBIENT_POLICY: AmbientPolicyDto = {
  mode: 'off',
  maxPerMinute: 2,
  maxPerHour: 30,
  topicAllowList: [],
  personaAllowList: [],
}

/** Display label for a vocabulary id (`traffic-mundane` -> `Traffic mundane`). */
export function topicLabel(id: string): string {
  const spaced = id.replace(/[-_]+/g, ' ').trim()
  return spaced.length === 0 ? id : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
