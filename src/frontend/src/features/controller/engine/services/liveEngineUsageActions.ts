/**
 * features/controller/engine/services/liveEngineUsageActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE AI-generation usage READ (feature: engine-telemetry-tuning, story
 * 03c; ADP-041). STAFF world — pure service module, no UI, no COBRA. Used
 * ONLY when `USE_MOCK_DATA` is false (`@/core/config/mockData`);
 * `useEngineUsage` calls this to render the real `GET /api/engine/usage`
 * story 03a shipped, mirroring `engineSettingsActions.ts`'s conventions.
 *
 * THE WIRE CONTRACT (story 03a, as merged — build against this verbatim; see
 * `docs/features/engine-telemetry-tuning/03-ai-usage-panel.md`'s "03a (backend
 * edge) — as built"):
 *
 *   GET /api/engine/usage[?windowMinutes=N]  -> 200 EngineUsageDto | 400 | 401 | 403
 *
 * TWO HARD-WON CONTRACT FACTS (do not relitigate — both cost a prior pass real
 * time):
 *  1. `?windowMinutes=` (present but EMPTY) is a `400`, not a fall-through to
 *     the default — the query string binder rejects an empty value before the
 *     service ever sees it. So `getUsage()` OMITS the parameter ENTIRELY when
 *     the caller wants the default window, rather than sending an empty
 *     string; it never sends `windowMinutes` unless the caller passes a
 *     concrete number.
 *  2. Two distinct `400` paths exist server-side (framework binding vs.
 *     service validation) and are NOT reliably distinguishable by status
 *     alone — this module does not try; both surface via the same 400 body
 *     handling below (a plain string naming the problem, mirroring
 *     `describeSettingsError`'s 400 handling).
 *
 * NO CLIENT `exerciseId` (COR-001) — scope is resolved server-side from the
 * session; this module sends only the optional `windowMinutes` query param.
 *
 * ERROR SHAPES (`describeUsageError`). A 400 body is a PLAIN STRING naming the
 * problem (the `windowMinutes` bounds, per the aggregator's `MinWindowMinutes`/
 * `MaxWindowMinutes`) — surfaced verbatim. A 401 means the session's exercise
 * scope could not be resolved (COR-001 fail-closed). A 403 means this staff
 * session is assigned to a DIFFERENT exercise (XC-001/COR-001 isolation) —
 * distinct from story 05/07's 403 (controller-role-only), since usage is a
 * read ANY assigned staff (including an evaluator) may take. Anything else
 * (network failure, malformed body) falls back to one generic, honest
 * message.
 */

import axios from 'axios'
import { api } from '@/core/services/api'

// ---------------------------------------------------------------------------
// Wire / public types — the frozen `EngineUsageDto` shape (story 03a)
// ---------------------------------------------------------------------------

/** Latency summary in milliseconds for a set of calls. */
export interface EngineUsageLatency {
  readonly totalMs: number
  readonly averageMs: number
  readonly maxMs: number
}

/** Call/token/latency totals for a window or for one provider+model within it. */
export interface EngineUsageTotals {
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Kept distinct from {@link inputTokens} — it prices differently. */
  readonly cacheReadInputTokens: number
  /** Kept distinct again — prices differently from both of the above. */
  readonly cacheCreationInputTokens: number
  readonly latency: EngineUsageLatency
}

/**
 * The wall-clock window a usage rollup covers, plus its bucket granularity.
 * AC6/COR-053 staff carve-out.
 */
export interface EngineUsageWindow {
  /** Always the literal `"wall-clock"` — never scenario time (this is a staff live-ops view). */
  readonly clock: string
  readonly fromWallClock: string
  readonly toWallClock: string
  readonly windowMinutes: number
  /**
   * The bucket width in minutes. NOTE (SG-001, backend contract): the FINAL
   * bucket may cover LESS than this many minutes when `windowMinutes` isn't a
   * whole multiple of it — true final span is
   * `windowMinutes - bucketMinutes * (bucketCount - 1)`. Render COUNTS, never
   * a calls-per-minute RATE derived by dividing by this value, or the
   * freshest (last) bucket — the one an operator actually watches — reads
   * understated by up to half.
   */
  readonly bucketMinutes: number
  readonly bucketCount: number
}

/** One bucket of a dense call-count series (always `bucketCount` long, zero-filled). */
export interface EngineUsageBucket {
  readonly startWallClock: string
  readonly calls: number
}

/**
 * One guard-result value and how many calls ended in it — an OPEN vocabulary
 * (`pass` / `drop` / `re-roll` / `unknown` / anything else the log holds), not
 * an enum. A `re-roll` cost money and produced nothing, so it is counted here,
 * never dropped.
 */
export interface EngineUsageGuardResult {
  readonly result: string
  readonly calls: number
}

/**
 * One provider+model's volume within the window. `provider`/`model` name
 * whichever ACTUALLY PRODUCED these historical calls (verbatim from the event
 * log) — a DIFFERENT question from "what is live now"
 * ({@link EngineUsageProviderQuestion}, AC1) — and MAY be an empty string for
 * a thin/partly-null stored payload; render such a row as unattributed rather
 * than hiding it or crashing (the call still cost money).
 */
export interface EngineUsageModel {
  readonly provider: string
  readonly model: string
  readonly totals: EngineUsageTotals
  readonly guardResults: readonly EngineUsageGuardResult[]
  readonly buckets: readonly EngineUsageBucket[]
}

/** The four per-1,000,000-token rates actually applied to a priced model. */
export interface EngineUsageRates {
  readonly inputPer1MTokens: number
  readonly outputPer1MTokens: number
  readonly cacheReadPer1MTokens: number
  readonly cacheCreationPer1MTokens: number
}

/**
 * One provider+model's cost row. `priced: false` is the EXPLICIT AC3 unpriced
 * state — every cost field is `null` in that case, deliberately never `0`
 * (which would read as "this was free").
 */
export interface EngineUsageModelCost {
  readonly provider: string
  readonly model: string
  readonly priced: boolean
  readonly inputCost: number | null
  readonly outputCost: number | null
  readonly cacheReadCost: number | null
  readonly cacheCreationCost: number | null
  readonly totalCost: number | null
  readonly rates: EngineUsageRates | null
}

/** The separately-labelled COST view (AC3) — never mixed into the volume numbers above. */
export interface EngineUsageCost {
  readonly currency: string
  /**
   * The summed cost of PRICED models only. When {@link anyUnpriced} is
   * `true`, this is a FLOOR, not the total spend — label it as such, never as
   * complete spend.
   */
  readonly pricedTotalCost: number
  readonly anyUnpriced: boolean
  readonly byModel: readonly EngineUsageModelCost[]
}

/** The `GET /api/engine/usage` response body (story 03a's frozen wire shape). */
export interface EngineUsageDto {
  readonly window: EngineUsageWindow
  readonly totals: EngineUsageTotals
  /** The aggregate dense call-count series, ordered ascending by `startWallClock`. */
  readonly buckets: readonly EngineUsageBucket[]
  /** Ordered by call count descending, then provider, then model (deterministic). */
  readonly byModel: readonly EngineUsageModel[]
  readonly guardResults: readonly EngineUsageGuardResult[]
  readonly cost: EngineUsageCost
  /**
   * How many `engine.generated` rows in the window had a null/unreadable
   * payload and are therefore excluded from EVERY number above. Non-zero
   * means real usage is undercounted — surface it, never let a silently-low
   * spend number stand unexplained.
   */
  readonly unparseableEvents: number
}

// ---------------------------------------------------------------------------
// Wire validation (fail-closed narrowing, never a blind cast — mirrors
// `engineSettingsActions.ts`'s `isWireEngineSettings` discipline: every
// declared field is checked, not a spot-checked subset)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isWireLatency(value: unknown): value is EngineUsageLatency {
  return (
    isRecord(value) &&
    isFiniteNumber(value.totalMs) &&
    isFiniteNumber(value.averageMs) &&
    isFiniteNumber(value.maxMs)
  )
}

function isWireTotals(value: unknown): value is EngineUsageTotals {
  return (
    isRecord(value) &&
    isFiniteNumber(value.calls) &&
    isFiniteNumber(value.inputTokens) &&
    isFiniteNumber(value.outputTokens) &&
    isFiniteNumber(value.cacheReadInputTokens) &&
    isFiniteNumber(value.cacheCreationInputTokens) &&
    isWireLatency(value.latency)
  )
}

function isWireWindow(value: unknown): value is EngineUsageWindow {
  return (
    isRecord(value) &&
    typeof value.clock === 'string' &&
    typeof value.fromWallClock === 'string' &&
    typeof value.toWallClock === 'string' &&
    isFiniteNumber(value.windowMinutes) &&
    isFiniteNumber(value.bucketMinutes) &&
    isFiniteNumber(value.bucketCount)
  )
}

function isWireBucket(value: unknown): value is EngineUsageBucket {
  return isRecord(value) && typeof value.startWallClock === 'string' && isFiniteNumber(value.calls)
}

function isWireGuardResult(value: unknown): value is EngineUsageGuardResult {
  return isRecord(value) && typeof value.result === 'string' && isFiniteNumber(value.calls)
}

function isWireModel(value: unknown): value is EngineUsageModel {
  return (
    isRecord(value) &&
    // provider/model MAY be empty strings (a thin/partly-null stored
    // payload) — still required to be present as strings, never absent.
    typeof value.provider === 'string' &&
    typeof value.model === 'string' &&
    isWireTotals(value.totals) &&
    Array.isArray(value.guardResults) && value.guardResults.every(isWireGuardResult) &&
    Array.isArray(value.buckets) && value.buckets.every(isWireBucket)
  )
}

function isWireRates(value: unknown): value is EngineUsageRates {
  return (
    isRecord(value) &&
    isFiniteNumber(value.inputPer1MTokens) &&
    isFiniteNumber(value.outputPer1MTokens) &&
    isFiniteNumber(value.cacheReadPer1MTokens) &&
    isFiniteNumber(value.cacheCreationPer1MTokens)
  )
}

function isWireModelCost(value: unknown): value is EngineUsageModelCost {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.model === 'string' &&
    typeof value.priced === 'boolean' &&
    isNullableFiniteNumber(value.inputCost) &&
    isNullableFiniteNumber(value.outputCost) &&
    isNullableFiniteNumber(value.cacheReadCost) &&
    isNullableFiniteNumber(value.cacheCreationCost) &&
    isNullableFiniteNumber(value.totalCost) &&
    (value.rates === null || value.rates === undefined ? true : isWireRates(value.rates))
  )
}

function isWireCost(value: unknown): value is EngineUsageCost {
  return (
    isRecord(value) &&
    typeof value.currency === 'string' &&
    isFiniteNumber(value.pricedTotalCost) &&
    typeof value.anyUnpriced === 'boolean' &&
    Array.isArray(value.byModel) && value.byModel.every(isWireModelCost)
  )
}

/**
 * Validates every property {@link EngineUsageDto} declares. Never a blind
 * cast — a 2xx body missing or mistyping any field throws
 * {@link MalformedEngineUsageResponseError} rather than being trusted, so a
 * silently-wrong render (e.g. a missing `unparseableEvents` reading as `0`)
 * can never happen through this seam.
 */
function isWireEngineUsage(value: unknown): value is EngineUsageDto {
  return (
    isRecord(value) &&
    isWireWindow(value.window) &&
    isWireTotals(value.totals) &&
    Array.isArray(value.buckets) && value.buckets.every(isWireBucket) &&
    Array.isArray(value.byModel) && value.byModel.every(isWireModel) &&
    Array.isArray(value.guardResults) && value.guardResults.every(isWireGuardResult) &&
    isWireCost(value.cost) &&
    isFiniteNumber(value.unparseableEvents)
  )
}

/** Thrown when a 2xx response's body doesn't match the frozen `EngineUsageDto` shape. */
export class MalformedEngineUsageResponseError extends Error {
  constructor() {
    super('The server returned a malformed engine-usage response.')
    this.name = 'MalformedEngineUsageResponseError'
  }
}

function parseUsage(data: unknown): EngineUsageDto {
  if (!isWireEngineUsage(data)) {
    throw new MalformedEngineUsageResponseError()
  }
  return data
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/** `GET /api/engine/usage` (relative to the shared axios client's `/api` base). */
const USAGE_PATH = '/engine/usage'

/**
 * Reads the current exercise's AI-generation usage rollup. Open to any
 * assigned staff (an evaluator may watch, not just a controller).
 *
 * @param windowMinutes The requested wall-clock window length, in minutes.
 *   `undefined` OMITS the query parameter entirely so the server applies its
 *   own default — NEVER pass an explicit empty value; the query binder
 *   rejects that as a `400` rather than falling through to the default (see
 *   module header, fact 1).
 */
export async function getUsage(windowMinutes?: number): Promise<EngineUsageDto> {
  const response = await api.get<unknown>(
    USAGE_PATH,
    windowMinutes === undefined ? undefined : { params: { windowMinutes } },
  )
  return parseUsage(response.data)
}

// ---------------------------------------------------------------------------
// Error description — the presentation policy for the failure shapes
// ---------------------------------------------------------------------------

/** A usage-read failure, described for direct display — never a generic swallow. */
export interface EngineUsageActionError {
  /** The HTTP status, or `null` for a non-HTTP failure (network error, malformed body). */
  readonly status: number | null
  /** Ready-to-render message. A 400's body is surfaced VERBATIM (it names the bounds). */
  readonly message: string
}

/**
 * Describes a rejected usage read for direct display. A 400 body (a plain
 * string) is surfaced verbatim; a 401 names the unresolved session (COR-001
 * fail-closed); a 403 means THIS session is assigned to a different exercise
 * (XC-001 isolation) — a different reason from story 05/07's controller-role
 * 403, since usage reads are open to any assigned staff; anything else
 * (network failure, malformed response) falls back to one generic, honest
 * message.
 */
export function describeUsageError(error: unknown): EngineUsageActionError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null
    const body: unknown = error.response?.data

    if (status === 400 && typeof body === 'string' && body.trim().length > 0) {
      return { status, message: body }
    }
    if (status === 403) {
      return {
        status,
        message:
          'This session is assigned to a different exercise — engine usage for this exercise ' +
          'is not visible here.',
      }
    }
    if (status === 401) {
      return {
        status,
        message: 'Your session could not be resolved for this exercise — sign back in to view engine usage.',
      }
    }
  }

  if (error instanceof MalformedEngineUsageResponseError) {
    return { status: null, message: error.message }
  }

  return { status: null, message: 'Engine usage could not be loaded. Try again.' }
}
