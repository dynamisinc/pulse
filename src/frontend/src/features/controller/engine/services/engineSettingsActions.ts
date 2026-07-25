/**
 * features/controller/engine/services/engineSettingsActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE engine SETTINGS actions (feature: autonomy-safety, story 06;
 * ADP-025/NFR-005, COR-001, COR-018). STAFF world — pure service module, no
 * UI, no COBRA. Used ONLY when `USE_MOCK_DATA` is false (`@/core/config/
 * mockData`); `useEngineSettings` calls this to read/write the real settings
 * story 05 shipped, mirroring `liveEngineControlActions.ts`'s conventions.
 *
 * THE WIRE CONTRACT (story 05, as merged — build against this verbatim; see
 * `docs/features/autonomy-safety/05-engine-settings-api.md`'s "Build notes (as
 * implemented)"):
 *
 *   GET  /api/engine/settings                    -> 200 EngineSettingsDto | 401 | 403
 *   POST /api/engine/settings/autonomy-default   { actingHumanId, level, timeZone? }
 *                                                 -> 200 EngineSettingsDto | 400 | 401 | 403
 *   POST /api/engine/settings/tier-policy         { actingHumanId, mode, timeZone? }
 *                                                 -> 200 EngineSettingsDto | 400 | 401 | 403
 *
 * ALL THREE return the IDENTICAL `EngineSettingsDto` body on success — one TS
 * type, one parse function, no follow-up GET after a mutation; the caller
 * reconciles straight from the response.
 *
 * `effectiveLevel` (WR-003) is what the loop actually routes on; it is lower
 * than `exerciseDefaultLevel` exactly when `safetyClampActive` is true, and
 * `null` iff `generationStopped` is true. This module never re-derives it —
 * it is read verbatim off the wire, exactly as the contract requires (a
 * consumer inferring "clamp active => Suggest" is the historical bug class
 * this feature exists to fix).
 *
 * NO CLIENT `exerciseId` (COR-001) — every request carries only
 * `actingHumanId` + `timeZone`; scope is resolved server-side from the
 * session. `level`/`mode` are lowercase-only, case-sensitive wire literals
 * (`"Standard"` is a 400) — callers must pass the exact `AutonomyDefaultLevel`/
 * `TierPolicyMode` union values, never a re-cased string.
 *
 * ERROR SHAPES (`describeSettingsError`). A 400 body is a PLAIN STRING naming
 * the problem (e.g. a tier with no configured deployment) — surfaced
 * verbatim, never swallowed into a generic "failed" message, since it names
 * the config key an operator must set. A 403 means "assigned staff but not a
 * controller" (story 05 AC6/#297) — the caller renders the panel read-only
 * rather than a failed-action toast. Every other failure (network, malformed
 * body) falls back to one generic, honest message.
 */

import axios from 'axios'
import { api } from '@/core/services/api'

// ---------------------------------------------------------------------------
// Wire / public types (the ONE shape all three endpoints share)
// ---------------------------------------------------------------------------

/** The exercise autonomy default's two v1-selectable levels (`AutonomyLevels.EnsureSelectable`). */
export type AutonomyDefaultLevel = 'suggest' | 'delayed-auto'

/** The per-exercise tier-policy override mode. `auto` clears the override. */
export type TierPolicyMode = 'standard' | 'ambient' | 'auto'

/** One governed tier's model/deployment mapping — informational, read-only here (WR-002). */
export interface EngineSettingsTierMapping {
  readonly tier: string
  readonly model: string
  readonly deployment: string
  readonly zdrCapable: boolean
}

/** The autonomy read model (mirrors `EngineAutonomyStateDto`'s additive `settings` fields). */
export interface EngineSettingsAutonomy {
  readonly swampedMode: boolean
  /** Kill-switch full stop. `effectiveLevel` is `null` iff this is `true`. */
  readonly generationStopped: boolean
  /** Kill switch OR degraded mode currently clamping the base default down. */
  readonly safetyClampActive: boolean
  readonly degradedReason: string | null
  /** The BASE default (`SetExerciseDefault`'s target) — never label the posture from this alone. */
  readonly exerciseDefaultLevel: AutonomyDefaultLevel
  /** WR-003 — what the loop actually routes on. LABEL THE POSTURE FROM THIS. */
  readonly effectiveLevel: AutonomyDefaultLevel | null
}

/** The one settings snapshot all three endpoints return on 200. */
export interface EngineSettingsDto {
  /** `IGenerationProvider.Name` — read-only, never editable here. */
  readonly provider: string
  /** `Generation:Tiers:*` — governed config, informational only (WR-002). */
  readonly tiers: readonly EngineSettingsTierMapping[]
  readonly autonomy: EngineSettingsAutonomy
  readonly tierPolicyMode: TierPolicyMode
  /** Always `true` today — process memory, no EF entity (see `inMemoryStateNote`). */
  readonly inMemoryState: boolean
  /** Honest reset-on-restart note — surface it, never hide it. */
  readonly inMemoryStateNote: string
}

/** Request context shared by both mutating endpoints — no client `exerciseId` (COR-001). */
export interface EngineSettingsActionContext {
  readonly actingHumanId: string
  readonly timeZone: string
}

// ---------------------------------------------------------------------------
// Wire validation (fail-closed narrowing, never a blind cast)
// ---------------------------------------------------------------------------

const AUTONOMY_DEFAULT_LEVELS: ReadonlySet<string> = new Set(['suggest', 'delayed-auto'])
const TIER_POLICY_MODES: ReadonlySet<string> = new Set(['standard', 'ambient', 'auto'])

function isAutonomyDefaultLevel(value: unknown): value is AutonomyDefaultLevel {
  return typeof value === 'string' && AUTONOMY_DEFAULT_LEVELS.has(value)
}

function isEffectiveLevel(value: unknown): value is AutonomyDefaultLevel | null {
  return value === null || isAutonomyDefaultLevel(value)
}

function isWireTier(value: unknown): value is EngineSettingsTierMapping {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.tier === 'string' &&
    typeof t.model === 'string' &&
    typeof t.deployment === 'string' &&
    typeof t.zdrCapable === 'boolean'
  )
}

function isWireAutonomy(value: unknown): value is EngineSettingsAutonomy {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.swampedMode === 'boolean' &&
    typeof a.generationStopped === 'boolean' &&
    typeof a.safetyClampActive === 'boolean' &&
    (a.degradedReason === null || typeof a.degradedReason === 'string') &&
    isAutonomyDefaultLevel(a.exerciseDefaultLevel) &&
    isEffectiveLevel(a.effectiveLevel)
  )
}

function isWireEngineSettings(value: unknown): value is EngineSettingsDto {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.provider === 'string' &&
    Array.isArray(s.tiers) && s.tiers.every(isWireTier) &&
    isWireAutonomy(s.autonomy) &&
    typeof s.tierPolicyMode === 'string' && TIER_POLICY_MODES.has(s.tierPolicyMode) &&
    typeof s.inMemoryState === 'boolean' &&
    typeof s.inMemoryStateNote === 'string'
  )
}

/** Thrown when a 2xx response's body doesn't match the frozen `EngineSettingsDto` shape. */
export class MalformedEngineSettingsResponseError extends Error {
  constructor() {
    super('The server returned a malformed engine-settings response.')
    this.name = 'MalformedEngineSettingsResponseError'
  }
}

function parseSettings(data: unknown): EngineSettingsDto {
  if (!isWireEngineSettings(data)) {
    throw new MalformedEngineSettingsResponseError()
  }
  return data
}

// ---------------------------------------------------------------------------
// The three endpoint calls
// ---------------------------------------------------------------------------

/** `GET /api/engine/settings` (relative to the shared axios client's `/api` base). */
const SETTINGS_PATH = '/engine/settings'

/** `POST /api/engine/settings/autonomy-default`. */
const AUTONOMY_DEFAULT_PATH = '/engine/settings/autonomy-default'

/** `POST /api/engine/settings/tier-policy`. */
const TIER_POLICY_PATH = '/engine/settings/tier-policy'

/** Reads the current settings snapshot. Open to any assigned staff (story 05 AC6). */
export async function getSettings(): Promise<EngineSettingsDto> {
  const response = await api.get<unknown>(SETTINGS_PATH)
  return parseSettings(response.data)
}

/**
 * Sets the exercise autonomy default (`suggest` | `delayed-auto`). Controller-role
 * only (403 otherwise, story 05 AC6/#297). Never lifts an active safety clamp
 * (AC2) — the base level is set underneath; only the server's own restore path
 * lifts a clamp.
 */
export async function setAutonomyDefault(
  level: AutonomyDefaultLevel,
  ctx: EngineSettingsActionContext,
): Promise<EngineSettingsDto> {
  const response = await api.post<unknown>(AUTONOMY_DEFAULT_PATH, {
    actingHumanId: ctx.actingHumanId,
    level,
    timeZone: ctx.timeZone,
  })
  return parseSettings(response.data)
}

/**
 * Sets the per-exercise tier-policy mode (`standard` | `ambient` | `auto`).
 * Controller-role only. `auto` clears the override; `standard`/`ambient` 400s
 * (naming the missing config key) if this deployment has no bound deployment
 * for that tier (WR-002).
 */
export async function setTierPolicyMode(
  mode: TierPolicyMode,
  ctx: EngineSettingsActionContext,
): Promise<EngineSettingsDto> {
  const response = await api.post<unknown>(TIER_POLICY_PATH, {
    actingHumanId: ctx.actingHumanId,
    mode,
    timeZone: ctx.timeZone,
  })
  return parseSettings(response.data)
}

// ---------------------------------------------------------------------------
// Error description — the presentation policy for the three failure shapes
// ---------------------------------------------------------------------------

/** A settings-action failure, described for direct display — never a generic swallow. */
export interface EngineSettingsActionError {
  /** The HTTP status, or `null` for a non-HTTP failure (network error, malformed body). */
  readonly status: number | null
  /** Ready-to-render message. A 400's body is surfaced VERBATIM (it names a config key). */
  readonly message: string
}

/**
 * Describes a rejected settings call for direct display. A 400 body (a plain
 * string) is surfaced verbatim; a 403 is reworded as the read-only/role
 * explanation (never a bare "Forbidden"); a 401 names the unresolved session;
 * anything else (network failure, malformed response) falls back to one
 * generic, honest message. Callers use `status === 403` to decide whether to
 * render the panel read-only rather than just showing a failed action.
 */
export function describeSettingsError(error: unknown): EngineSettingsActionError {
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
          'Only controller-role staff can change engine settings — this panel is read-only for ' +
          'your assignment.',
      }
    }
    if (status === 401) {
      return {
        status,
        message: 'Your session could not be resolved for this exercise — sign back in to steer the engine.',
      }
    }
  }

  if (error instanceof MalformedEngineSettingsResponseError) {
    return { status: null, message: error.message }
  }

  return { status: null, message: 'The engine settings change could not be applied. Try again.' }
}
