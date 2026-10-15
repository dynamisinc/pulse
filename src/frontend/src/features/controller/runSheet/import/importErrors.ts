/**
 * features/controller/runSheet/import/importErrors.ts
 * ---------------------------------------------------------------------------
 * The typed failure of the MSEL import call, shared by the live service and the mock so
 * a refusal reads the same whichever adapter produced it (mock/live parity). STAFF world.
 *
 *   400 'refused'          the server's readable `detail`; nothing was written
 *   401 'unauthenticated'  the staff session expired: sign in again
 *   403 'forbidden'        not allowed to import here
 *   409 'conflict'         the run sheet changed while importing; run it again
 *   413 'tooLarge'         the body broke a proxy / server size cap before the endpoint read it
 *   other status 'server'  the status and any `detail`, so a failure is never silent or vague
 *   no response            'unavailable' (network)
 *   bad 2xx body           'malformed' (fail closed; raised by the service, not here)
 */

import axios from 'axios'

export type InjectImportErrorKind =
  | 'refused'
  | 'unauthenticated'
  | 'forbidden'
  | 'conflict'
  | 'tooLarge'
  | 'server'
  | 'unavailable'
  | 'malformed'

/** A failed import call, with the server's readable reason when it sent one. */
export class InjectImportError extends Error {
  readonly kind: InjectImportErrorKind
  /** The server's `detail` (ProblemDetails), or '' when it sent none. */
  readonly detail: string
  /** The HTTP status, when the server answered. */
  readonly status: number | undefined

  constructor(kind: InjectImportErrorKind, detail = '', status?: number) {
    super(detail || kind)
    this.name = 'InjectImportError'
    this.kind = kind
    this.detail = detail
    this.status = status
  }
}

function readDetail(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const body = data as { detail?: unknown; title?: unknown }
  if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail
  if (typeof body.title === 'string') return body.title
  return ''
}

const KIND_BY_STATUS: Readonly<Record<number, InjectImportErrorKind>> = {
  400: 'refused',
  401: 'unauthenticated',
  403: 'forbidden',
  409: 'conflict',
  413: 'tooLarge',
}

/** Axios rejection -> `InjectImportError`. Idempotent. */
export function translateImportError(error: unknown): InjectImportError {
  if (error instanceof InjectImportError) return error
  if (!axios.isAxiosError(error) || !error.response) return new InjectImportError('unavailable')
  const { status, data } = error.response
  return new InjectImportError(KIND_BY_STATUS[status] ?? 'server', readDetail(data), status)
}

/** The failure, worded for the controller. A 400 carries the server's own reason. */
export function describeImportFailure(error: unknown, step: 'preview' | 'import'): string {
  const lead = step === 'preview' ? 'The file could not be previewed' : 'The file could not be imported'
  if (!(error instanceof InjectImportError)) {
    return `${lead}. Couldn't reach the server. Check your connection and try again.`
  }
  switch (error.kind) {
    case 'refused':
      return error.detail ? `${lead}: ${error.detail}` : `${lead}. The server refused the file.`
    case 'unauthenticated':
      return 'Your session expired. Sign in again, then run the import again.'
    case 'forbidden':
      return "You don't have permission to import into the run sheet."
    case 'conflict':
      return error.detail || 'The run sheet changed while importing. Run the import again.'
    case 'tooLarge':
      return `${lead}: the file is too large. The limit is 2 MB.`
    case 'server': {
      const status = error.status === undefined ? 'an error' : `error ${error.status}`
      return error.detail
        ? `${lead}: the server answered with ${status}: ${error.detail}`
        : `${lead}: the server answered with ${status}. Try again in a moment.`
    }
    case 'malformed':
      return step === 'preview'
        ? `${lead}: the server's answer could not be read.`
        : "The server's answer could not be read. Check the run sheet before importing again."
    case 'unavailable':
      return `${lead}. Couldn't reach the server. Check your connection and try again.`
  }
}
