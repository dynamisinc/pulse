/**
 * features/controller/export/exportService.ts
 * ---------------------------------------------------------------------------
 * Downloads the post activity export (demo-feedback story 09 AC3; backend story 02, DF-8). STAFF
 * world, no UI.
 *
 * THE CALL. `GET /api/staff/exports/posts.xlsx` through the shared axios client, so the session's
 * bearer token rides on it like on every other staff call (and the one-shot silent refresh covers
 * an expired token). It is fetched AS A BLOB and saved by the browser under the SERVER's file name,
 * read from `Content-Disposition`
 * (`attachment; filename="pulse-posts-<slug>-<yyyyMMdd-HHmm>.xlsx"`;
 * the API exposes that header to the cross-origin SPA, seam S-2). A plain link could not carry the
 * bearer token, which is why this is not an `<a href>`.
 *
 * ONE RETRY ON 429 (02 Gate-1 fold). The server builds one export at a time per process and answers
 * 429 to a second request while one is building. The client waits about a second and tries ONCE
 * more; a second 429 shows the server's reason ("Another post export is being built right now...").
 *
 * ERRORS are sentences (`ExportError.message`). With `responseType: 'blob'` an error body arrives
 * as a Blob too, so the ProblemDetails `detail` is read out of it (413 too many posts, 429 busy).
 *
 * MOCK <-> LIVE. Under `USE_MOCK_DATA` the request goes through `mockExportAdapter`, which answers
 * a small CSV under its own file name, so the button, spinner and save path all run in mock mode.
 */

import axios, { AxiosHeaders } from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { api } from '@/core/services/api'
import { mockExportAdapter } from './exportMock'
import { saveBlob } from './saveBlob'

/** The route, relative to the API base (`/api`). */
export const EXPORT_PATH = '/staff/exports/posts.xlsx'

/** Used only when the server sends no usable file name. */
export const FALLBACK_EXPORT_FILE_NAME = 'pulse-posts.xlsx'

/** How long to wait before the one retry after a 429. */
export const EXPORT_RETRY_DELAY_MS = 1000

/** A big exercise takes a while to build; the button shows a spinner meanwhile. */
const REQUEST_TIMEOUT_MS = 120_000

const MAX_DETAIL_LENGTH = 300

/** A failed export, with a message meant for the person who pressed the button. */
export class ExportError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ExportError'
    this.status = status
  }
}

/** What `downloadPostsExport` needs from the outside world (replaced in tests). */
export interface ExportDependencies {
  /** Waits `ms` milliseconds (the 429 back-off). */
  readonly wait: (ms: number) => Promise<void>
  /** Hands the file to the browser to save. */
  readonly save: (blob: Blob, fileName: string) => void
}

const defaultDependencies: ExportDependencies = {
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  save: saveBlob,
}

/** Strips anything that could make a file name a path or hide characters; empty -> undefined. */
function cleanFileName(name: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim()
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : undefined
}

/**
 * The file name in a `Content-Disposition` header: `filename*=UTF-8''...` when present (RFC 6266
 * prefers it), else `filename="..."` or a bare `filename=token`. `undefined` when there is none.
 */
export function fileNameFromContentDisposition(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  const extendedValue = extended?.[2]
  if (extendedValue !== undefined) {
    try {
      const decoded = cleanFileName(decodeURIComponent(extendedValue.trim().replace(/^"|"$/g, '')))
      if (decoded !== undefined) return decoded
    } catch {
      // A malformed percent-encoding: fall through to the plain parameter.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)?.[1]
  if (quoted !== undefined) return cleanFileName(quoted.replace(/\\(.)/g, '$1'))
  const bare = /filename\s*=\s*([^;\s]+)/i.exec(header)?.[1]
  return bare === undefined ? undefined : cleanFileName(bare)
}

/** The ProblemDetails `detail` inside an error body (a Blob under `responseType: 'blob'`). */
export async function problemDetailFromBody(data: unknown): Promise<string | undefined> {
  let body: unknown = data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      body = JSON.parse(await data.text())
    } catch {
      return undefined
    }
  } else if (typeof data === 'string') {
    try {
      body = JSON.parse(data)
    } catch {
      return undefined
    }
  }
  if (typeof body !== 'object' || body === null) return undefined
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail !== 'string') return undefined
  const text = detail.trim()
  if (text.length === 0 || text.length > MAX_DETAIL_LENGTH) return undefined
  if (/[\r\n]/.test(text) || /<\s*[a-z!/?]/i.test(text)) return undefined
  return text
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your console session has expired or has no exercise. Sign in again.'
    case 403:
      return 'Only staff assigned to this exercise can export its posts.'
    case 404:
      return 'This exercise no longer exists.'
    case 413:
      return 'This exercise has too many posts to export in one file.'
    case 429:
      return 'Another post export is being built right now. Try again in a few seconds.'
    default:
      return `The export failed (the server answered ${status}).`
  }
}

async function toExportError(error: unknown): Promise<ExportError> {
  if (error instanceof ExportError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === undefined) {
      return new ExportError('The server could not be reached. The export was not downloaded.')
    }
    const detail = await problemDetailFromBody(error.response?.data)
    return new ExportError(detail ?? messageForStatus(status), status)
  }
  return new ExportError('The export failed. Try again.')
}

/** A response header, case-insensitively (`AxiosHeaders.get`, else a plain lookup). */
function headerValue(headers: unknown, name: string): unknown {
  if (headers instanceof AxiosHeaders) return headers.get(name)
  if (typeof headers !== 'object' || headers === null) return undefined
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return entry?.[1]
}

function requestExport() {
  return api.get<Blob>(EXPORT_PATH, {
    responseType: 'blob',
    timeout: REQUEST_TIMEOUT_MS,
    ...(USE_MOCK_DATA ? { adapter: mockExportAdapter } : {}),
  })
}

/**
 * Fetches the export and saves it under the server's file name. Resolves to that file name;
 * rejects with an {@link ExportError}. A 429 is retried once after {@link EXPORT_RETRY_DELAY_MS}.
 */
export async function downloadPostsExport(
  dependencies: ExportDependencies = defaultDependencies,
): Promise<string> {
  let response
  try {
    try {
      response = await requestExport()
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 429) throw error
      await dependencies.wait(EXPORT_RETRY_DELAY_MS)
      response = await requestExport()
    }
  } catch (error) {
    throw await toExportError(error)
  }

  const blob: unknown = response.data
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
    throw new ExportError('The server sent something that is not a file. The export was not saved.')
  }
  const fileName =
    fileNameFromContentDisposition(headerValue(response.headers, 'content-disposition')) ??
    FALLBACK_EXPORT_FILE_NAME
  dependencies.save(blob, fileName)
  return fileName
}
