/**
 * features/controller/noise/noiseTypes.ts
 * ---------------------------------------------------------------------------
 * The white-noise wire contract on the client (demo-feedback story 09, DF-12/DF-13; the FROZEN
 * `NoiseStateDto` in docs/features/demo-feedback/implementation.md §Types). STAFF world only:
 * this state reaches the console through `GET/PUT /api/staff/noise` and the staff-group
 * `NoiseStateChanged` push, never a participant.
 *
 * `parseNoiseState` is the ONE place an untyped payload (an HTTP body or a hub frame) becomes a
 * `NoiseStateDto`: it rebuilds the object from its contract keys and returns `undefined` for
 * anything malformed, so a stray or garbled frame can never drive the knob.
 */

/** The four levels, in knob order (Off first). */
export const NOISE_LEVELS = ['off', 'low', 'medium', 'high'] as const

/** `off | low | medium | high` (DF-12). */
export type NoiseLevel = (typeof NOISE_LEVELS)[number]

/** The visible label for each level. */
export const NOISE_LEVEL_LABELS: Readonly<Record<NoiseLevel, string>> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/** The white-noise state the server reports (frozen contract). */
export interface NoiseStateDto {
  readonly level: NoiseLevel
  /** 0 / 2 / 6 / 15 posts per minute. */
  readonly ratePerMinute: number
  /** How many entries the pool holds. */
  readonly poolSize: number
  /** Total noise posts published in this exercise. */
  readonly postedCount: number
  /** Scenario time of the latest noise post; absent before the first. */
  readonly lastPostedAt?: string
  /**
   * Whether noise is actually being released: false while the level is off, the pool is empty,
   * the world is frozen, the clock is frozen or not running, or the lifecycle is not staged/live.
   */
  readonly running: boolean
}

export function isNoiseLevel(value: unknown): value is NoiseLevel {
  return typeof value === 'string' && (NOISE_LEVELS as readonly string[]).includes(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Narrows an untyped payload to a {@link NoiseStateDto}, rebuilt key by key. A `null` or absent
 * `lastPostedAt` is treated as "no post yet"; anything else malformed returns `undefined`.
 */
export function parseNoiseState(payload: unknown): NoiseStateDto | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const raw = payload as Record<string, unknown>
  if (!isNoiseLevel(raw.level)) return undefined
  if (!isCount(raw.ratePerMinute) || !isCount(raw.poolSize) || !isCount(raw.postedCount)) {
    return undefined
  }
  if (typeof raw.running !== 'boolean') return undefined
  const lastPostedAt = raw.lastPostedAt
  if (lastPostedAt !== undefined && lastPostedAt !== null && typeof lastPostedAt !== 'string') {
    return undefined
  }
  return {
    level: raw.level,
    ratePerMinute: raw.ratePerMinute,
    poolSize: raw.poolSize,
    postedCount: raw.postedCount,
    ...(typeof lastPostedAt === 'string' ? { lastPostedAt } : {}),
    running: raw.running,
  }
}
