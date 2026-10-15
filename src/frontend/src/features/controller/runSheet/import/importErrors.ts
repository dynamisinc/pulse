/**
 * features/controller/runSheet/import/importErrors.ts
 * ---------------------------------------------------------------------------
 * The typed failure of the MSEL import call, shared by the live service and the mock so
 * a refusal reads the same whichever adapter produced it (mock/live parity). STAFF world.
 *
 *   400 'refused'       the server's readable `detail`; nothing was written
 *   409 'conflict'      the run sheet changed while importing; run it again
 *   401/403 'forbidden' not allowed to import here
 *   other / network     'unavailable'
 *   bad 2xx body        'malformed' (fail closed; raised by the service, not here)
 */

import axios from 'axios'

export type InjectImportErrorKind = 'refused' | 'conflict' | 'forbidden' | 'unavailable' | 'malformed'

/** A failed import call, with the server's readable reason when it sent one. */
export class InjectImportError extends Error {
  readonly kind: InjectImportErrorKind
  /** The server's `detail` (ProblemDetails), or '' when it sent none. */
  readonly detail: string

  constructor(kind: InjectImportErrorKind, detail = '') {
    super(detail || kind)
    this.name = 'InjectImportError'
    this.kind = kind
    this.detail = detail
  }
}

function readDetail(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const body = data as { detail?: unknown; title?: unknown }
  if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail
  if (typeof body.title === 'string') return body.title
  return ''
}

/** Axios rejection -> `InjectImportError`. Idempotent. */
export function translateImportError(error: unknown): InjectImportError {
  if (error instanceof InjectImportError) return error
  if (!axios.isAxiosError(error) || !error.response) return new InjectImportError('unavailable')
  const detail = readDetail(error.response.data)
  switch (error.response.status) {
    case 400:
      return new InjectImportError('refused', detail)
    case 409:
      return new InjectImportError('conflict', detail)
    case 401:
    case 403:
      return new InjectImportError('forbidden', detail)
    default:
      return new InjectImportError('unavailable', detail)
  }
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
    case 'conflict':
      return error.detail || 'The run sheet changed while importing. Run the import again.'
    case 'forbidden':
      return "You don't have permission to import into the run sheet."
    case 'malformed':
      return step === 'preview'
        ? `${lead}: the server's answer could not be read.`
        : "The server's answer could not be read. Check the run sheet before importing again."
    case 'unavailable':
      return `${lead}. Couldn't reach the server. Check your connection and try again.`
  }
}
