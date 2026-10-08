/**
 * features/controller/runSheet/injectErrors.ts
 * ---------------------------------------------------------------------------
 * Typed failures of the inject-queue API (story 06's wire contract, frozen in
 * `implementation.md` § Demo slice) and the translation from a raw axios error.
 * STAFF world, no UI. Shared by the live service, the mock and the hook so a
 * 409 means the same thing whichever adapter produced it (mock/live parity).
 *
 *   409 -> `InjectConflictError`   a ProblemDetails with a readable `detail` and,
 *                                  when the item exists, its CURRENT state in
 *                                  `extensions.item` so the console can refresh
 *                                  the row without a second call. (ASP.NET Core
 *                                  serialises ProblemDetails `Extensions` inline,
 *                                  so `item` may also arrive at the TOP level of
 *                                  the body — both shapes are accepted.)
 *   400 -> `InjectValidationError` a readable message, plus an optional `errors`
 *                                  map (field path -> first message) so the editor
 *                                  can put the message on the field.
 *   404 -> `InjectNotFoundError`   unknown id — and a cross-exercise id is
 *                                  deliberately the same response (COR-001).
 *
 * Anything else (401/403/5xx/network) is left as the original error: the panel
 * shows a generic "couldn't reach the server" notice for those.
 */

import axios from 'axios'
import type { InjectItemDto } from './types'
import { isInjectItemDto } from './injectGuards'

/** A 409: the transition/edit was refused. `item` is the server's current view, when it exists. */
export class InjectConflictError extends Error {
  readonly status = 409 as const
  /** The server's readable reason (ProblemDetails `detail`). Empty when the server sent none. */
  readonly detail: string
  /** The item's current state, so the row can be refreshed without a second call. */
  readonly item: InjectItemDto | undefined

  constructor(detail: string, item?: InjectItemDto) {
    super(detail || 'Conflict')
    this.name = 'InjectConflictError'
    this.detail = detail
    this.item = item
  }
}

/** A 400: the write was invalid. `fieldErrors` keys are normalised paths (`posts.0.text`). */
export class InjectValidationError extends Error {
  readonly status = 400 as const
  readonly detail: string
  readonly fieldErrors: Readonly<Record<string, string>>

  constructor(detail: string, fieldErrors: Record<string, string> = {}) {
    super(detail || 'Invalid request')
    this.name = 'InjectValidationError'
    this.detail = detail
    this.fieldErrors = fieldErrors
  }
}

/** A 404: the item does not exist in this exercise (or never did). */
export class InjectNotFoundError extends Error {
  readonly status = 404 as const

  constructor(detail = 'Not found') {
    super(detail)
    this.name = 'InjectNotFoundError'
  }
}

/**
 * `posts[0].Text` / `Posts[0].Text` / `posts.0.text` -> `posts.0.text`. The server's
 * validation keys are not guaranteed to match our casing, and the editor looks fields
 * up by this normalised form.
 */
export function normalizeFieldPath(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(segment => segment.length > 0)
    .map(segment =>
      /^\d+$/.test(segment) ? segment : segment.charAt(0).toLowerCase() + segment.slice(1),
    )
    .join('.')
}

interface ProblemBody {
  detail?: unknown
  title?: unknown
  item?: unknown
  extensions?: { item?: unknown } | null
  errors?: unknown
}

function asProblemBody(data: unknown): ProblemBody {
  return typeof data === 'object' && data !== null ? (data as ProblemBody) : {}
}

function readDetail(body: ProblemBody): string {
  if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail
  if (typeof body.title === 'string') return body.title
  return ''
}

function readItem(body: ProblemBody): InjectItemDto | undefined {
  const candidate = body.extensions?.item ?? body.item
  return isInjectItemDto(candidate) ? candidate : undefined
}

/** ValidationProblemDetails `errors` (`{ "Title": ["…"] }`) -> `{ title: '…' }`, first each. */
function readFieldErrors(body: ProblemBody): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof body.errors !== 'object' || body.errors === null) return out
  for (const [key, value] of Object.entries(body.errors as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value.find(v => typeof v === 'string') : value
    if (typeof first === 'string' && first.length > 0) out[normalizeFieldPath(key)] = first
  }
  return out
}

/**
 * Converts an axios rejection into the typed error for its status; passes
 * everything else through unchanged. Idempotent (typed errors pass through).
 */
export function translateInjectError(error: unknown): unknown {
  if (
    error instanceof InjectConflictError ||
    error instanceof InjectValidationError ||
    error instanceof InjectNotFoundError
  ) {
    return error
  }
  if (!axios.isAxiosError(error) || !error.response) return error

  const body = asProblemBody(error.response.data)
  switch (error.response.status) {
    case 409:
      return new InjectConflictError(readDetail(body), readItem(body))
    case 400: {
      const fieldErrors = readFieldErrors(body)
      const detail = readDetail(body) || Object.values(fieldErrors)[0] || ''
      return new InjectValidationError(detail, fieldErrors)
    }
    case 404:
      return new InjectNotFoundError(readDetail(body) || 'Not found')
    default:
      return error
  }
}
