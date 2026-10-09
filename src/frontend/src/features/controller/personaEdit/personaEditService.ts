/**
 * features/controller/personaEdit/personaEditService.ts
 * ---------------------------------------------------------------------------
 * The WRITE seam of the persona profile edit (demo-polish story 21 / PE-FE,
 * docs/features/demo-polish/21-persona-profile-edit.md; COR-020, COR-024,
 * NFR-004, XC-001). Staff world, pure service module — no React, no theme, no
 * telemetry (the console hook emits the one `steering_action`; the server emits
 * none, DP-9).
 *
 *   PATCH /api/staff/personas/{personaId}
 *   Content-Type: application/merge-patch+json
 *   body  = a JSON merge-patch (RFC 7396) of ONLY the changed fields
 *
 * PE-BE's shipped contract, as this client relies on it:
 *   200  the updated `StaffPersonaResponseDto` (the same shape as a staff
 *        `GET /api/personas` entry, with `avatarUrl` / `bannerUrl` / `location`
 *        absent — never `null` — when unset);
 *   400  a JSON STRING body — a human-written, staff-facing sentence such as
 *        "displayName must be 1 to 100 characters." — shown to the controller
 *        VERBATIM (`PersonaEditError.message` IS that text). Since PE-BE's Gate-1
 *        fold this includes: a lone UTF-16 surrogate, C0/C1 controls and bidi
 *        overrides in the text fields, a display name with no visible character,
 *        and raw text over 4x a field's bound;
 *   415  any Content-Type other than merge-patch / JSON (the console never sends one);
 *   401  no live staff session; 403 unassigned / not a controller / read-only;
 *   404  (empty body) unknown or cross-exercise persona.
 * Each gets clear staff copy below. A network failure and a malformed 2xx get
 * their own messages. Nothing is swallowed: every failure rejects with a
 * {@link PersonaEditError}.
 *
 * ## No client scope (COR-001)
 * The request names the persona by its (opaque) id only. No `exerciseId` is sent;
 * the staff session binds the exercise server-side, and the server answers 404 for
 * another exercise's persona.
 *
 * ## A retry is safe
 * A merge-patch re-sent with the same body is idempotent, so the dialog lets the
 * controller press Save again after ANY failure, including an ambiguous one (a
 * dropped connection after the server applied the change).
 *
 * ## Mock / live
 * `USE_MOCK_DATA` (the one flip point) routes the SAME call through
 * `personaEditMock`'s adapter, which edits the mock persona directory and speaks
 * the contract's exact 400 texts. There is deliberately no second flag.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { isPersonaType, type StaffPersona } from '@/features/personas'
import { personaPatchMockAdapter } from './personaEditMock'
import type { PersonaPatch } from './types'

/**
 * The merge-patch media type (RFC 7396). The server REQUIRES this or
 * `application/json` for the body and answers 415 for anything else; the console
 * always sends this one.
 */
export const MERGE_PATCH_CONTENT_TYPE = 'application/merge-patch+json'

/**
 * How long a save may take before the console gives up on it. The dialog stays
 * open (and non-dismissable) while saving, so an unanswered request must end.
 */
export const PERSONA_EDIT_TIMEOUT_MS = 30_000

/** What went wrong, for the dialog and for tests. */
export type PersonaEditFailureKind =
  | 'rejected' // 400 — the server refused the content
  | 'unauthenticated' // 401
  | 'forbidden' // 403
  | 'notFound' // 404
  | 'server' // other non-2xx
  | 'network' // no response at all
  | 'malformed' // a 2xx whose body is not a persona

/** The staff copy for every failure that is not the server's own 400 sentence. */
export const PERSONA_EDIT_ERROR_TEXT = {
  rejectedFallback: 'The server rejected this edit.',
  unauthenticated:
    'Your staff session has ended or could not be verified. Sign in again, then save once '
    + 'more — your edits are still in this dialog.',
  forbidden:
    'You are not allowed to edit personas in this exercise. Only a controller assigned to '
    + 'it can, and a read-only session cannot.',
  notFound:
    'This persona was not found in the current exercise — it may have been removed, or the '
    + 'console is now pointed at a different exercise. Close this dialog and pick the '
    + 'persona again.',
  unsupportedMediaType:
    'The server did not accept the format of this request (HTTP 415). That is a console '
    + 'fault, not something to fix in this dialog — tell your lead.',
  server: (status: number) =>
    `The server could not save this edit (HTTP ${status}). Try again in a moment.`,
  network:
    'Could not reach the server, so the edit may not have been saved. Your changes are '
    + 'still in this dialog — try Save again.',
  malformed:
    'The server accepted the edit but sent back a reply this console could not read. '
    + 'Reload the persona list to confirm the change before editing again.',
} as const

/** A failed persona edit. `message` is ready to show to the controller. */
export class PersonaEditError extends Error {
  readonly kind: PersonaEditFailureKind
  readonly status: number | undefined
  /** True when the server may well have applied the edit (a malformed 2xx). */
  readonly mayHaveSaved: boolean

  constructor(
    kind: PersonaEditFailureKind,
    message: string,
    details: {
      readonly status?: number
      readonly mayHaveSaved?: boolean
      readonly cause?: unknown
    } = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined)
    this.name = 'PersonaEditError'
    this.kind = kind
    this.status = details.status
    this.mayHaveSaved = details.mayHaveSaved ?? false
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The server's human sentence from an error body: a JSON/plain string (PE-BE's
 * 400), or — defensively — a ProblemDetails-ish object. Trimmed; `undefined` when
 * there is nothing to show.
 */
function serverSentence(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    }
  }
  return undefined
}

/** Maps anything thrown by the PATCH call to a {@link PersonaEditError}. */
export function toPersonaEditError(failure: unknown): PersonaEditError {
  if (failure instanceof PersonaEditError) return failure

  if (axios.isAxiosError(failure)) {
    const status = failure.response?.status
    if (status === undefined) {
      return new PersonaEditError('network', PERSONA_EDIT_ERROR_TEXT.network, { cause: failure })
    }
    switch (status) {
      case 400:
        return new PersonaEditError(
          'rejected',
          serverSentence(failure.response?.data) ?? PERSONA_EDIT_ERROR_TEXT.rejectedFallback,
          { status, cause: failure },
        )
      case 401:
        return new PersonaEditError('unauthenticated', PERSONA_EDIT_ERROR_TEXT.unauthenticated, {
          status,
          cause: failure,
        })
      case 403:
        return new PersonaEditError('forbidden', PERSONA_EDIT_ERROR_TEXT.forbidden, {
          status,
          cause: failure,
        })
      case 404:
        return new PersonaEditError('notFound', PERSONA_EDIT_ERROR_TEXT.notFound, {
          status,
          cause: failure,
        })
      case 415:
        return new PersonaEditError('server', PERSONA_EDIT_ERROR_TEXT.unsupportedMediaType, {
          status,
          cause: failure,
        })
      default:
        return new PersonaEditError('server', PERSONA_EDIT_ERROR_TEXT.server(status), {
          status,
          cause: failure,
        })
    }
  }

  return new PersonaEditError(
    'network',
    failure instanceof Error && failure.message.length > 0
      ? failure.message
      : PERSONA_EDIT_ERROR_TEXT.network,
    { cause: failure },
  )
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Any string, INCLUDING the empty one (see `parseStaffPersonaResponse`). */
function anyString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Absent or `null` (treated as absent), or a string. */
function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

/** Absent or `null` (treated as absent), or a finite number. */
function optionalNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Reads the 200 body as a `StaffPersona`, REBUILT from the contract's keys (a
 * stray key or a `null` optional never reaches the console's active-persona
 * snapshot), or `undefined` when it is not a staff persona. Fails closed on a
 * participant-shaped body (no `personaType`) — the same guard
 * `resolveStaffPersonas` applies to a list read — and on an `id` other than the
 * persona that was edited.
 *
 * ## Validate what the console relies on — not more (Gate-1 H-1)
 * The body is the server's `StaffPersonaResponseDto.FromPersona`, and several of its
 * members are legitimately EMPTY STRINGS: `templateId` is `""` for every persona
 * without a template (`PersonaTemplateId?.ToString() ?? string.Empty` — the entire
 * seeded demo cast), and `initials` is documented "an empty string if none could be
 * derived". A parser that demanded non-empty values for those turned every
 * successful live save into "could not read" (no active-persona refresh, no
 * telemetry). So:
 *   - REQUIRED and non-empty: `id` (must equal the edited persona), `displayName`,
 *     `handle` — what the console shows and keys on;
 *   - REQUIRED and in vocabulary: `kind`, `personaType` (the staff projection's tell);
 *   - REQUIRED and typed: `verified` (boolean), `followerCount` (number);
 *   - ANY string, empty allowed: `exerciseId`, `avatarColor`, `initials`, `audienceBand`
 *     (like the list read, which does not vocabulary-check it) and `joinedAt`;
 *   - `templateId`: a string ("" for a template-less persona), or absent / `null`, which
 *     means the same and is rebuilt as "";
 *   - OPTIONAL, `null` treated as absent: `bio`, `avatarUrl`, `bannerUrl`, `location`
 *     (strings), `followingCount`, `audienceMagnitude` (numbers). The server OMITS
 *     the strings when unset or when signing an image URL failed.
 */
export function parseStaffPersonaResponse(
  data: unknown,
  expectedId: string,
): StaffPersona | undefined {
  if (!isRecord(data)) return undefined
  const {
    id, exerciseId, templateId, displayName, handle, kind, personaType, verified,
    avatarColor, initials, bio, audienceBand, followerCount, followingCount,
    audienceMagnitude, joinedAt, avatarUrl, bannerUrl, location,
  } = data

  if (id !== expectedId) return undefined
  if (!nonEmptyString(displayName) || !nonEmptyString(handle)) return undefined
  if (kind !== 'human' && kind !== 'org') return undefined
  if (!isPersonaType(personaType)) return undefined
  if (typeof verified !== 'boolean') return undefined
  if (typeof followerCount !== 'number' || !Number.isFinite(followerCount)) return undefined
  if (
    !anyString(exerciseId) || !anyString(avatarColor) ||
    !anyString(initials) || !anyString(audienceBand) || !anyString(joinedAt)
  ) {
    return undefined
  }
  // `templateId` is "" today for a template-less persona; should the server ever OMIT it (or
  // send null) it still means "no template" — never a reason to refuse a saved edit.
  if (!optionalString(templateId)) return undefined
  if (!optionalNumber(followingCount) || !optionalNumber(audienceMagnitude)) return undefined
  if (!optionalString(bio) || !optionalString(avatarUrl)) return undefined
  if (!optionalString(bannerUrl) || !optionalString(location)) return undefined

  return {
    id: expectedId,
    exerciseId,
    templateId: typeof templateId === 'string' ? templateId : '',
    displayName,
    handle,
    kind,
    personaType,
    verified,
    avatarColor,
    initials,
    audienceBand: audienceBand as StaffPersona['audienceBand'],
    followerCount,
    joinedAt,
    ...(typeof bio === 'string' ? { bio } : {}),
    ...(typeof avatarUrl === 'string' ? { avatarUrl } : {}),
    ...(typeof bannerUrl === 'string' ? { bannerUrl } : {}),
    ...(typeof location === 'string' ? { location } : {}),
    ...(typeof followingCount === 'number' ? { followingCount } : {}),
    ...(typeof audienceMagnitude === 'number' ? { audienceMagnitude } : {}),
  }
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Applies a merge-patch to one persona and resolves with the UPDATED staff
 * persona. Rejects with a {@link PersonaEditError} on every failure — never
 * swallows, never resolves with a body it could not read.
 *
 * @param personaId the persona to edit (its instance id; opaque)
 * @param patch only the CHANGED fields (see `buildPersonaPatch`); `{}` is valid
 */
export async function patchPersona(
  personaId: string,
  patch: PersonaPatch,
): Promise<StaffPersona> {
  let data: unknown
  try {
    const response = await api.patch<unknown>(
      `/staff/personas/${encodeURIComponent(personaId)}`,
      patch,
      {
        headers: { 'Content-Type': MERGE_PATCH_CONTENT_TYPE },
        timeout: PERSONA_EDIT_TIMEOUT_MS,
        ...(USE_MOCK_DATA ? { adapter: personaPatchMockAdapter } : {}),
      },
    )
    data = response.data
  } catch (failure) {
    throw toPersonaEditError(failure)
  }

  const updated = parseStaffPersonaResponse(data, personaId)
  if (updated === undefined) {
    throw new PersonaEditError('malformed', PERSONA_EDIT_ERROR_TEXT.malformed, {
      mayHaveSaved: true,
    })
  }
  return updated
}
