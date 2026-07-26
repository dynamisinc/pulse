/**
 * features/planner/services/exerciseSettingsService.ts
 * ---------------------------------------------------------------------------
 * The COR-030 per-exercise settings data seam for the staff-console planner
 * surface (feature: exercise-configuration, story 01b — "Settings API +
 * shell-config service + staff editor"; issue #41 / story #67). Consumes the
 * backend contract shipped by `src/Pulse.WebApi/Features/ExerciseConfiguration/`
 * (`ExerciseSettingsEndpoints.cs` + `ExerciseSettingsDtos.cs`):
 *
 *   GET  /api/staff/exercise-settings   -> 200 ExerciseSettingsDto
 *   PUT  /api/staff/exercise-settings   -> 200 ExerciseSettingsDto (re-projected)
 *
 *   400 validation failed — NOTHING persisted, not even the valid fields. The
 *       body is a bare JSON *string* (one message: the server reports the FIRST
 *       failure only).
 *   401 no staff session / no server-resolved exercise scope (empty body).
 *   403 staff session not assigned to the resolved exercise (empty body).
 *   404 the resolved scope has no exercise row (empty body).
 *
 * THE EXERCISE IS NEVER A PARAMETER (COR-001 / XC-001 / XC-002). There is no
 * route value, no query string and no body field naming an exercise: the target
 * is the scope the SERVER resolved for the staff session. `exerciseId` on the
 * response is an ECHO of that scope, useful for display only. Never invent a
 * `/api/staff/exercises/{id}/settings` shape — that is precisely the
 * cross-exercise vector the isolation ACs forbid.
 *
 * PUT IS A FULL REPLACE, NOT A PATCH. An omitted or `null` optional field
 * CLEARS that setting back to "not configured" (the participant projection then
 * falls back to its shipped Phase-1 constant). That is why
 * `ExerciseSettingsUpdate` below declares EVERY settable field as required —
 * `string | null`, never `string | undefined` — so TypeScript refuses to compile
 * a request builder that forgets a field. Forgetting one would silently clear a
 * setting the planner never touched; it is the most likely defect in this story
 * and the type makes it a compile error rather than a support ticket.
 *
 * MOCK SEAM (mirrors `accountImportService.ts` / `core/auth/sessionResolver.ts` /
 * `features/participant-shell/brandTokens.ts`): every request routes through the
 * shared axios client (`@/core/services/api`) so the request shape (method, URL,
 * base URL, headers, and the staff `Authorization` header the client's auth
 * layer attaches) matches the live endpoint exactly. Mock data is swapped at
 * EXACTLY ONE env-guarded flip point (`USE_MOCK_SETTINGS = USE_MOCK_DATA`),
 * never per call, so a real deploy that omits the flag fails closed (COR-001)
 * rather than serving canned configuration.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Exempt from the
 * participant scenario-time rule (COR-053): the two schedule instants are staff
 * planning data (absolute UTC instants), and nothing here renders in-fiction.
 */

import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/** The staff settings route, relative to the shared client's `/api` base URL. */
const SETTINGS_ENDPOINT = '/staff/exercise-settings'

// ---------------------------------------------------------------------------
// Field bounds — mirrors `ExerciseSettingsFieldRules` on the server so the
// editor can fail fast with a field-associated message instead of round-tripping
// to a 400. The SERVER remains the authority; these are a UX courtesy, never a
// substitute for the server guard.
// ---------------------------------------------------------------------------

/** Max length of the staff-facing internal name (server: `MaxNameLength`). */
export const MAX_NAME_LENGTH = 200
/** Max length of the participant-visible world name (server: `MaxWorldNameLength`). */
export const MAX_WORLD_NAME_LENGTH = 200
/** Max length of the BCP-47 locale tag (server: `MaxLocaleLength`). */
export const MAX_LOCALE_LENGTH = 35
/** Max length of the participant-visible brand name (server: `MaxBrandNameLength`). */
export const MAX_BRAND_NAME_LENGTH = 200
/** Max length of a CSS hex color string (server: `MaxColorLength`). */
export const MAX_COLOR_LENGTH = 32
/** Max length of the IANA time-zone id (server: `MaxTimeZoneLength`). */
export const MAX_TIME_ZONE_LENGTH = 128
/** Max number of outlet-name entries (server: `MaxOutletNameEntries`). */
export const MAX_OUTLET_NAME_ENTRIES = 32
/** Max length of an outlet-name key (server: `MaxOutletKeyLength`). */
export const MAX_OUTLET_KEY_LENGTH = 64
/** Max length of an outlet display name (server: `MaxOutletNameLength`). */
export const MAX_OUTLET_NAME_LENGTH = 120

/** CSS hex color the server accepts: `#rgb` or `#rrggbb`. */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ---------------------------------------------------------------------------
// Client contract types. Kept LOCAL to this module on purpose:
// `features/planner/types.ts` is a shared module another wave edits
// concurrently (see implementation.md → "Integration seams"), so settings
// types live here and are re-exported from the feature barrel by the
// orchestrator.
// ---------------------------------------------------------------------------

/**
 * One row of the CLOSED channel catalog, exactly as the server reports it.
 *
 * `enabled` is the EFFECTIVE value — the exercise's configured set, or the
 * platform default (Social only) when it has never configured one. The editor
 * renders its checkbox list from this array and never hardcodes ids: an id the
 * client invented is a 400 from the strict server-side parser.
 */
export interface ExerciseChannelOption {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
}

/**
 * `GET`/`PUT /api/staff/exercise-settings` response body.
 *
 * Every key is always present. `null` on an optional field means "NOT
 * CONFIGURED" — the participant world falls back to a shipped constant. The
 * editor must therefore show an EMPTY field for `null`, never the constant:
 * pre-filling the fallback and saving turns a fallback into stored
 * configuration.
 */
export interface ExerciseSettings {
  /** Echo of the SERVER-resolved scope. Never an input. */
  readonly exerciseId: string
  /** The staff-facing internal name — always a string. */
  readonly name: string
  readonly worldName: string | null
  /** BCP-47 tag, or `null` when not configured. */
  readonly locale: string | null
  /** The exercise's single IANA zone (XC-008) — always a string. */
  readonly timeZone: string
  /** ISO-8601 instant, or `null` when unscheduled. */
  readonly scheduledStartAt: string | null
  /** ISO-8601 instant, or `null` when unscheduled. */
  readonly scheduledEndAt: string | null
  /** The FULL closed catalog, in server order. */
  readonly channels: readonly ExerciseChannelOption[]
  readonly brandName: string | null
  readonly brandPrimary: string | null
  readonly brandAccent: string | null
  readonly brandSurface: string | null
  readonly brandOnSurface: string | null
  /** Always present; `{}` when unconfigured. */
  readonly outletNames: Readonly<Record<string, string>>
}

/**
 * `PUT /api/staff/exercise-settings` request body — a FULL REPLACE.
 *
 * EVERY field is REQUIRED here even though most are optional on the wire. That
 * is the point: `null` and "absent" mean the same thing to the server (clear the
 * setting), so an accidentally-omitted field silently wipes configuration the
 * planner never touched. Declaring them `T | null` rather than `T | undefined`
 * makes "submit every field you manage" a compile-time obligation.
 *
 * `enabledChannels` is the one field with asymmetric semantics: `null` clears
 * the selection back to the platform default, while `[]` is a **400** (the
 * server refuses to blank the participant world). The editor therefore always
 * sends a non-empty array and blocks submission when nothing is checked.
 */
export interface ExerciseSettingsUpdate {
  /** REQUIRED on the wire, 1–200 chars. */
  readonly name: string
  readonly worldName: string | null
  readonly locale: string | null
  /** REQUIRED on the wire; IANA only ("Eastern Standard Time" is a 400). */
  readonly timeZone: string
  readonly scheduledStartAt: string | null
  readonly scheduledEndAt: string | null
  /** Catalog ids; `null` clears to the platform default, `[]` is a 400. */
  readonly enabledChannels: readonly string[] | null
  readonly brandName: string | null
  readonly brandPrimary: string | null
  readonly brandAccent: string | null
  readonly brandSurface: string | null
  readonly brandOnSurface: string | null
  readonly outletNames: Readonly<Record<string, string>> | null
}

// ---------------------------------------------------------------------------
// Transport-agnostic error
// ---------------------------------------------------------------------------

/** Construction options for {@link ExerciseSettingsError}. */
export interface ExerciseSettingsErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

/**
 * A transport-agnostic failure the settings seam throws so the panel renders
 * status-aware feedback WITHOUT coupling to axios internals. `status` is the
 * HTTP status when the server responded (400/401/403/404), or `undefined` when
 * the request never reached a response (network failure). `serverMessage` is the
 * server's own single validation reason, when present.
 */
export class ExerciseSettingsError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: ExerciseSettingsErrorInit = {}) {
    super(message)
    this.name = 'ExerciseSettingsError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime guard — this seam must fail closed on an out-of-shape body rather
// than casting blindly into `ExerciseSettings` and rendering nonsense into a
// full-replace form (which would then SAVE that nonsense).
// ---------------------------------------------------------------------------

function isChannelOption(value: unknown): value is ExerciseChannelOption {
  if (typeof value !== 'object' || value === null) return false
  const channel = value as Record<string, unknown>
  return (
    typeof channel.id === 'string' &&
    typeof channel.label === 'string' &&
    typeof channel.enabled === 'boolean'
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(entry => typeof entry === 'string')
}

/** Fail-closed guard over the `GET`/`PUT` response body. */
function isSettingsBody(value: unknown): value is ExerciseSettings {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseId === 'string' &&
    typeof body.name === 'string' &&
    typeof body.timeZone === 'string' &&
    isNullableString(body.worldName) &&
    isNullableString(body.locale) &&
    isNullableString(body.scheduledStartAt) &&
    isNullableString(body.scheduledEndAt) &&
    isNullableString(body.brandName) &&
    isNullableString(body.brandPrimary) &&
    isNullableString(body.brandAccent) &&
    isNullableString(body.brandSurface) &&
    isNullableString(body.brandOnSurface) &&
    Array.isArray(body.channels) &&
    body.channels.every(isChannelOption) &&
    isStringMap(body.outletNames)
  )
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * Pulls the server's reason off an error body. The settings endpoint's 400 body
 * is a **bare JSON string** (`Results.BadRequest("…")`), so the string branch is
 * the live one; the object branch covers a ProblemDetails-shaped body from a
 * proxy or a future hardening of the endpoint.
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

/** Translates any thrown transport failure into an `ExerciseSettingsError`. */
function toSettingsError(error: unknown): ExerciseSettingsError {
  if (axios.isAxiosError(error)) {
    return new ExerciseSettingsError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new ExerciseSettingsError(error.message, { cause: error })
  }
  return new ExerciseSettingsError('The settings request failed for an unknown reason.', {
    cause: error,
  })
}

// ---------------------------------------------------------------------------
// Mock seam (DEMO CONFIG — deleted when every environment has the backend).
// ---------------------------------------------------------------------------

/**
 * The closed catalog the MOCK serves, mirroring the server's `ChannelCatalog`.
 *
 * This lives ONLY in the mock: the panel renders its checkbox list from the
 * `channels` array of whatever the seam returned, so no component ever depends
 * on this constant. It exists so the mock's catalog matches what a real server
 * would send.
 */
const MOCK_CHANNEL_CATALOG: readonly { id: string; label: string }[] = [
  { id: 'social', label: 'Social' },
  { id: 'portal', label: 'Portal' },
  { id: 'news', label: 'News' },
  { id: 'press', label: 'Press Room' },
  { id: 'weather', label: 'Weather' },
]

/** The platform default when an exercise has never configured a channel set. */
const MOCK_DEFAULT_ENABLED_IDS: readonly string[] = ['social']

/**
 * The canned settings the mock serves. DELIBERATELY PART-CONFIGURED: several
 * optional fields are `null` so the "a `null` field renders EMPTY, never the
 * shipped participant constant" rule is exercised the moment anyone opens the
 * editor on mock data.
 *
 * Mutable module state on purpose — the mock PUT replaces it, so the dev/UAT
 * demo shows a real full-replace round trip (save, reload, the change persists
 * for the tab's lifetime) rather than a write that evaporates.
 */
let mockSettings: ExerciseSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  name: 'Atlanta Coastal Incident Exercise 2026',
  worldName: 'Metro Atlanta',
  locale: 'en-US',
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.0000000+00:00',
  scheduledEndAt: null,
  channels: MOCK_CHANNEL_CATALOG.map(entry => ({
    ...entry,
    enabled: MOCK_DEFAULT_ENABLED_IDS.includes(entry.id),
  })),
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: {},
}

/** Projects a mock full-replace write onto the response shape the server returns. */
function applyMockUpdate(update: ExerciseSettingsUpdate): ExerciseSettings {
  const enabled = update.enabledChannels ?? MOCK_DEFAULT_ENABLED_IDS
  mockSettings = {
    exerciseId: mockSettings.exerciseId,
    name: update.name,
    worldName: update.worldName,
    locale: update.locale,
    timeZone: update.timeZone,
    scheduledStartAt: update.scheduledStartAt,
    scheduledEndAt: update.scheduledEndAt,
    channels: MOCK_CHANNEL_CATALOG.map(entry => ({
      ...entry,
      enabled: enabled.includes(entry.id),
    })),
    brandName: update.brandName,
    brandPrimary: update.brandPrimary,
    brandAccent: update.brandAccent,
    brandSurface: update.brandSurface,
    brandOnSurface: update.brandOnSurface,
    outletNames: update.outletNames ?? {},
  }
  return mockSettings
}

/**
 * Short-circuits the network with the canned settings while still exercising
 * the shared axios client's request pipeline exactly as a live call would.
 */
const mockAdapter: AxiosAdapter = config => {
  const method = (config.method ?? 'get').toLowerCase()
  // Axios has already run `transformRequest` by the time an adapter sees the
  // config, so a PUT body arrives as the serialized JSON string.
  const body: unknown =
    typeof config.data === 'string' ? JSON.parse(config.data) : config.data
  const data =
    method === 'put' && typeof body === 'object' && body !== null
      ? applyMockUpdate(body as ExerciseSettingsUpdate)
      : mockSettings
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

/**
 * The SINGLE mock/live flip point (mirrors `accountImportService.ts`'s
 * `USE_MOCK_ACCOUNT_IMPORT`): mock in dev/test, the real
 * `GET/PUT /api/staff/exercise-settings` in a production build.
 */
const USE_MOCK_SETTINGS = USE_MOCK_DATA

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/**
 * Reads the COR-030 settings of the exercise the SERVER resolved for this staff
 * session. Takes no arguments by design — there is no exercise parameter
 * anywhere in this surface (COR-001).
 *
 * Throws `ExerciseSettingsError` on a transport failure (401/403/404/network) or
 * a malformed response body.
 */
export async function getExerciseSettings(): Promise<ExerciseSettings> {
  let data: unknown
  try {
    const response = await api.get<unknown>(
      SETTINGS_ENDPOINT,
      USE_MOCK_SETTINGS ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toSettingsError(error)
  }

  if (!isSettingsBody(data)) {
    throw new ExerciseSettingsError('The settings response was empty or malformed.')
  }
  return data
}

/**
 * FULL-REPLACES the resolved exercise's COR-030 settings block and returns the
 * freshly re-projected settings.
 *
 * Callers must render from the RETURNED value, not from their local form state:
 * the server normalizes (sanitized free text, canonicalized channel ids,
 * round-trip-formatted instants), so the response is the truth about what was
 * stored.
 *
 * Throws `ExerciseSettingsError` on 400 (validation — nothing was persisted, and
 * `serverMessage` carries the single first failure), 401/403/404, a network
 * failure, or a malformed response body.
 */
export async function updateExerciseSettings(
  update: ExerciseSettingsUpdate,
): Promise<ExerciseSettings> {
  let data: unknown
  try {
    const response = await api.put<unknown>(
      SETTINGS_ENDPOINT,
      update,
      USE_MOCK_SETTINGS ? { adapter: mockAdapter } : undefined,
    )
    data = response.data
  } catch (error) {
    throw toSettingsError(error)
  }

  if (!isSettingsBody(data)) {
    throw new ExerciseSettingsError('The settings response was empty or malformed.')
  }
  return data
}
