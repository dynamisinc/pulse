/**
 * features/planner/services/chromeSettingsService.ts
 * ---------------------------------------------------------------------------
 * The COR-031 COMPLIANCE-CHROME config data seam for the staff-console planner
 * surface (feature: exercise-configuration, story 02 — "Compliance chrome:
 * per-exercise config + NFR-008 guard"; issue #41 / story #68). Consumes the
 * backend contract shipped by
 * `src/Pulse.WebApi/Features/ExerciseConfiguration/Chrome/`
 * (`ChromeSettingsEndpoints.cs` + `ChromeSettingsDtos.cs`):
 *
 *   GET  /api/staff/chrome-settings   -> 200 ChromeSettingsDto
 *   PUT  /api/staff/chrome-settings   -> 200 ChromeSettingsDto (re-projected)
 *
 *   400 validation failed — NOTHING persisted, not even the valid fields. The
 *       body is a bare JSON *string* (one message: the server reports the FIRST
 *       failure only). The NFR-008 both-off rejection arrives this way.
 *   401 no staff session / no server-resolved exercise scope (empty body).
 *   403 staff session not assigned to the resolved exercise (empty body).
 *   404 the resolved scope has no exercise row (empty body).
 *
 * THIS IS THE STAFF SHAPE, NOT THE PARTICIPANT ONE. Participants read chrome
 * from the FROZEN `GET /api/chrome-config` body
 * (`{ enabled, top{text,fg,bg}, bottom{text,fg,bg} }`), consumed by
 * `features/participant-shell/chromeConfig.ts` — a different, Complete feature
 * whose seam this story does not touch and never reshapes. The shape below is
 * flat, nullable, and carries `watermarkEnabled`, which no participant response
 * may ever contain (XC-002).
 *
 * THE EXERCISE IS NEVER A PARAMETER (COR-001 / XC-001 / XC-002). There is no
 * route value, no query string and no body field naming an exercise: the target
 * is the scope the SERVER resolved for the staff session. `exerciseId` on the
 * response is an ECHO of that scope, useful for display only.
 *
 * PUT IS A FULL REPLACE, NOT A PATCH. An omitted or `null` banner field CLEARS
 * that setting back to "not configured", and the participant projection then
 * falls back to its shipped Phase-1 banner. `ChromeSettingsUpdate` therefore
 * declares EVERY field as required (`string | null`, never `string |
 * undefined`), so forgetting one is a COMPILE ERROR rather than silent data
 * loss.
 *
 * NFR-008 IS A SERVER INVARIANT, MIRRORED HERE ONLY AS A COURTESY.
 * `violatesWatermarkInvariant()` lets the editor explain the rule before a round
 * trip; the SERVER remains the authority and rejects the pair with a 400
 * regardless of what this client sends.
 *
 * MOCK SEAM (mirrors `exerciseSettingsService.ts`): every request routes through
 * the shared axios client (`@/core/services/api`) so the request shape matches
 * the live endpoint exactly, with mock data swapped at EXACTLY ONE env-guarded
 * flip point (`USE_MOCK_CHROME_SETTINGS = USE_MOCK_DATA`) — never per call — so
 * a real deploy that omits the flag fails closed rather than serving canned
 * configuration.
 *
 * CLIENT-CONTRACT TYPES ARE LOCAL TO THIS MODULE ON PURPOSE:
 * `features/planner/types.ts` is a shared file other wave-3 builders would also
 * touch (see implementation.md -> "Integration seams"), so these types live
 * here and are re-exported from the feature barrel by the orchestrator.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): nothing here renders in-fiction.
 */

import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/** The staff chrome route, relative to the shared client's `/api` base URL. */
const CHROME_SETTINGS_ENDPOINT = '/staff/chrome-settings'

// ---------------------------------------------------------------------------
// Field bounds — mirrors `ChromeFieldRules` / `ExerciseSettingsFieldRules` on
// the server so the editor can fail fast with a field-associated message
// instead of round-tripping to a 400. The SERVER remains the authority.
// ---------------------------------------------------------------------------

/** Max length of a compliance-banner text (server: `ChromeFieldRules.MaxBannerTextLength`). */
export const MAX_BANNER_TEXT_LENGTH = 512
/** Max length of a CSS hex color string (server: `ExerciseSettingsFieldRules.MaxColorLength`). */
export const MAX_CHROME_COLOR_LENGTH = 32

/** CSS hex color the server accepts: `#rgb` or `#rrggbb`. */
export const CHROME_HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ---------------------------------------------------------------------------
// Client contract types
// ---------------------------------------------------------------------------

/**
 * `GET`/`PUT /api/staff/chrome-settings` response body.
 *
 * Every key is always present. `null` on a banner field means "NOT CONFIGURED"
 * — the participant world falls back to the shipped Phase-1 banner for it. The
 * editor must therefore show an EMPTY field for `null`, never the constant:
 * pre-filling the fallback and saving turns a fallback into stored config.
 */
export interface ChromeSettings {
  /** Echo of the SERVER-resolved scope. Never an input. */
  readonly exerciseId: string
  /** Whether the compliance banners are shown. Chrome-off is legal (D7-008). */
  readonly chromeEnabled: boolean
  /** Whether the in-content EXERCISE watermark is on (NFR-008). */
  readonly watermarkEnabled: boolean
  readonly topText: string | null
  readonly topFg: string | null
  readonly topBg: string | null
  readonly bottomText: string | null
  readonly bottomFg: string | null
  readonly bottomBg: string | null
}

/**
 * `PUT /api/staff/chrome-settings` request body — a FULL REPLACE.
 *
 * Both switches are REQUIRED booleans: the server refuses to default a missing
 * one, because defaulting a switch is exactly how an exercise would quietly
 * lose its last exercise marking (NFR-008). The banner fields are `T | null`
 * rather than `T | undefined` so "submit every field you manage" is a
 * compile-time obligation.
 */
export interface ChromeSettingsUpdate {
  readonly chromeEnabled: boolean
  readonly watermarkEnabled: boolean
  readonly topText: string | null
  readonly topFg: string | null
  readonly topBg: string | null
  readonly bottomText: string | null
  readonly bottomFg: string | null
  readonly bottomBg: string | null
}

/**
 * The NFR-008 mutual invariant, mirrored client-side for a fast, explanatory
 * message: compliance chrome and the in-content watermark are never BOTH off.
 *
 * This is a COURTESY, not the enforcement point — the server evaluates the same
 * rule in `ComplianceChromeGuard` and returns a 400 whatever the client does.
 */
export function violatesWatermarkInvariant(
  chromeEnabled: boolean,
  watermarkEnabled: boolean,
): boolean {
  return !chromeEnabled && !watermarkEnabled
}

// ---------------------------------------------------------------------------
// Transport-agnostic error
// ---------------------------------------------------------------------------

/** Construction options for {@link ChromeSettingsError}. */
export interface ChromeSettingsErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

/**
 * A transport-agnostic failure the chrome seam throws so the panel renders
 * status-aware feedback WITHOUT coupling to axios internals. `status` is the
 * HTTP status when the server responded (400/401/403/404), or `undefined` when
 * the request never reached a response (network failure). `serverMessage` is the
 * server's own single validation reason — for a both-off attempt, the NFR-008
 * explanation itself.
 */
export class ChromeSettingsError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: ChromeSettingsErrorInit = {}) {
    super(message)
    this.name = 'ChromeSettingsError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime guard — this seam must fail closed on an out-of-shape body rather
// than casting blindly and rendering nonsense into a full-replace form (which
// would then SAVE that nonsense).
// ---------------------------------------------------------------------------

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** Fail-closed guard over the `GET`/`PUT` response body. */
function isChromeSettingsBody(value: unknown): value is ChromeSettings {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseId === 'string' &&
    typeof body.chromeEnabled === 'boolean' &&
    typeof body.watermarkEnabled === 'boolean' &&
    isNullableString(body.topText) &&
    isNullableString(body.topFg) &&
    isNullableString(body.topBg) &&
    isNullableString(body.bottomText) &&
    isNullableString(body.bottomFg) &&
    isNullableString(body.bottomBg)
  )
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * Pulls the server's reason off an error body. The chrome endpoint's 400 body is
 * a **bare JSON string** (`Results.BadRequest("…")`), so the string branch is the
 * live one; the object branch covers a ProblemDetails-shaped body from a proxy.
 */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into a `ChromeSettingsError`. */
function toChromeError(error: unknown): ChromeSettingsError {
  if (axios.isAxiosError(error)) {
    return new ChromeSettingsError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new ChromeSettingsError(error.message, { cause: error })
  }
  return new ChromeSettingsError('The compliance-chrome request failed for an unknown reason.', {
    cause: error,
  })
}

// ---------------------------------------------------------------------------
// Mock seam (DEMO CONFIG — deleted when every environment has the backend).
// ---------------------------------------------------------------------------

/**
 * The canned chrome config the mock serves. DELIBERATELY PART-CONFIGURED: the
 * bottom banner and every color are `null`, so the "a `null` field renders
 * EMPTY, never the shipped participant constant" rule is exercised the moment
 * anyone opens the editor on mock data.
 *
 * Mutable module state on purpose — the mock PUT replaces it, so the dev/UAT
 * demo shows a real full-replace round trip rather than a write that evaporates.
 */
let mockChromeSettings: ChromeSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  chromeEnabled: true,
  watermarkEnabled: true,
  topText: 'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
  topFg: null,
  topBg: null,
  bottomText: null,
  bottomFg: null,
  bottomBg: null,
}

/** Projects a mock full-replace write onto the response shape the server returns. */
function applyMockUpdate(update: ChromeSettingsUpdate): ChromeSettings {
  mockChromeSettings = {
    exerciseId: mockChromeSettings.exerciseId,
    chromeEnabled: update.chromeEnabled,
    watermarkEnabled: update.watermarkEnabled,
    topText: update.topText,
    topFg: update.topFg,
    topBg: update.topBg,
    bottomText: update.bottomText,
    bottomFg: update.bottomFg,
    bottomBg: update.bottomBg,
  }
  return mockChromeSettings
}

/**
 * Short-circuits the network with the canned config while still exercising the
 * shared axios client's request pipeline exactly as a live call would.
 *
 * The mock enforces the NFR-008 guard too — rejecting a both-off write the way
 * the server does — so the mock path can never demo a state the real backend
 * refuses to store.
 */
const mockAdapter: AxiosAdapter = config => {
  const method = (config.method ?? 'get').toLowerCase()
  // Axios has already run `transformRequest` by the time an adapter sees the
  // config, so a PUT body arrives as the serialized JSON string.
  const body: unknown = typeof config.data === 'string' ? JSON.parse(config.data) : config.data

  if (method === 'put' && typeof body === 'object' && body !== null) {
    const update = body as ChromeSettingsUpdate
    if (violatesWatermarkInvariant(update.chromeEnabled, update.watermarkEnabled)) {
      return Promise.reject(
        new axios.AxiosError(
          'Request failed with status code 400',
          'ERR_BAD_REQUEST',
          config,
          null,
          {
            data: 'Compliance chrome and the in-content EXERCISE watermark must not both be off (NFR-008).',
            status: 400,
            statusText: 'Bad Request',
            headers: {},
            config,
          },
        ),
      )
    }
    return Promise.resolve({
      data: applyMockUpdate(update),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
  }

  return Promise.resolve({
    data: mockChromeSettings,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

/**
 * The SINGLE mock/live flip point (mirrors `exerciseSettingsService.ts`'s
 * `USE_MOCK_SETTINGS`): mock in dev/test, the real
 * `GET/PUT /api/staff/chrome-settings` in a production build.
 */
const USE_MOCK_CHROME_SETTINGS = USE_MOCK_DATA

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/**
 * Reads the compliance-chrome config of the exercise the SERVER resolved for
 * this staff session. Takes no arguments by design — there is no exercise
 * parameter anywhere in this surface (COR-001).
 *
 * Throws `ChromeSettingsError` on a transport failure (401/403/404/network) or a
 * malformed response body.
 */
export async function getChromeSettings(): Promise<ChromeSettings> {
  let data: unknown
  try {
    const response = await api.get<unknown>(
      CHROME_SETTINGS_ENDPOINT,
      USE_MOCK_CHROME_SETTINGS ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toChromeError(error)
  }

  if (!isChromeSettingsBody(data)) {
    throw new ChromeSettingsError('The compliance-chrome response was empty or malformed.')
  }
  return data
}

/**
 * FULL-REPLACES the resolved exercise's compliance-chrome block and returns the
 * freshly re-projected config.
 *
 * Callers must render from the RETURNED value, not from their local form state:
 * the server sanitizes banner text (NFR-004), so the response is the truth about
 * what was stored.
 *
 * Throws `ChromeSettingsError` on 400 (validation — nothing was persisted, and
 * `serverMessage` carries the single first failure, including the NFR-008
 * both-off rejection), 401/403/404, a network failure, or a malformed body.
 */
export async function updateChromeSettings(
  update: ChromeSettingsUpdate,
): Promise<ChromeSettings> {
  let data: unknown
  try {
    const response = await api.put<unknown>(
      CHROME_SETTINGS_ENDPOINT,
      update,
      USE_MOCK_CHROME_SETTINGS ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toChromeError(error)
  }

  if (!isChromeSettingsBody(data)) {
    throw new ChromeSettingsError('The compliance-chrome response was empty or malformed.')
  }
  return data
}
