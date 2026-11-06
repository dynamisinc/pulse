/**
 * features/social/edit/mockEdits.ts
 * ---------------------------------------------------------------------------
 * The MOCK server for edit-own-post (demo-feedback story 20; the live server is story 19).
 * Behind `USE_MOCK_DATA` only: `editPostService` hands its axios calls to the adapters here, and
 * `postService.createPost` tells this module about each participant post it creates so that post
 * has a window and an original version.
 *
 * It mirrors the FROZEN contract (WAVE-4): `PATCH /posts/{id}` `{ text }` answers a post-shaped
 * 200 carrying `edited { count, scenarioTime }` and `viewer.editableForSeconds`, or a 409
 * `{ reason: 'window-closed' | 'edit-limit' | 'frozen' }`, a 404 for an unknown post and a 400 for
 * empty / too-long text; an identical text is a no-op 200 (nothing written, nothing pushed);
 * `GET /posts/{id}/edits` answers `{ postId, versions }` newest first (current = editNumber
 * `count`, original = 0). Each real edit also emits the `PostEdited` frame - in the mock there is
 * no hub, so it is applied straight to `editedPostsStore` through the SAME frame shape the live
 * validator accepts, which is what makes a card elsewhere in the tab update.
 *
 * Time. The window is a DURATION counted from when the mock post was created (wall clock used
 * ONLY to measure it, never rendered); every version carries a SCENARIO time (`scenarioNow()`).
 * A leaf-ish module: imports only the sanitizer, the scenario clock, the limits and the store.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { scenarioNow } from '@/core/clock'
import { sanitizeText } from '../services/sanitize'
import { EDIT_LIMIT, EDIT_WINDOW_SECONDS } from './editLimits'
import { editedPostsStore } from './editedPostsStore'

const MAX_TEXT_LENGTH = 280

interface MockVersion {
  readonly text: string
  readonly scenarioTime: string
}

interface MockPostRecord {
  /** `performance.now()` at creation: a monotonic duration clock, never rendered. */
  readonly startedAt: number
  readonly original: MockVersion
  readonly edits: MockVersion[]
}

const records = new Map<string, MockPostRecord>()

/** A mock switch the demo / tests can flip to see the 409 messages. */
let forcedConflict: 'window-closed' | 'edit-limit' | 'frozen' | null = null
let forcedForbidden = false

/** Records a participant post the mock created (called from `createPost`, mock mode only). */
export function noteMockPostCreated(id: string, text: string, scenarioTime: string): void {
  records.set(id, { startedAt: performance.now(), original: { text, scenarioTime }, edits: [] })
}

/** Test/demo hook: make the next edits answer this 409 reason (`null` clears it). */
export function setMockEditConflict(reason: 'window-closed' | 'edit-limit' | 'frozen' | null): void {
  forcedConflict = reason
}

/** Test/demo hook: make the next edit saves answer 403 (the ended-exercise write gate). */
export function setMockEditForbidden(forbidden: boolean): void {
  forcedForbidden = forbidden
}

/** Test-only: forget every mock record and switch. */
export function resetMockEditsForTests(): void {
  records.clear()
  forcedConflict = null
  forcedForbidden = false
}

function secondsLeft(record: MockPostRecord): number {
  if (record.edits.length >= EDIT_LIMIT) return 0
  const elapsed = (performance.now() - record.startedAt) / 1000
  return Math.max(0, Math.floor(EDIT_WINDOW_SECONDS - elapsed))
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: String(status), headers: {}, config }
  if (status >= 400) {
    return Promise.reject(
      new AxiosError(`mock edit ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response),
    )
  }
  return Promise.resolve(response)
}

function postIdFromUrl(url: string | undefined): string {
  const match = /\/posts\/([^/?]+)/.exec(url ?? '')
  return match === null ? '' : decodeURIComponent(match[1] ?? '')
}

function currentOf(record: MockPostRecord): MockVersion {
  return record.edits[record.edits.length - 1] ?? record.original
}

/** The mock `PATCH /posts/{id}` and `GET /posts/{id}/edits` handler. */
export const mockEditAdapter: AxiosAdapter = config => {
  const postId = postIdFromUrl(config.url)
  const record = records.get(postId)
  if (record === undefined) return respond(config, 404, { error: 'not found' })

  if (config.method === 'get') {
    const all = [record.original, ...record.edits]
    const versions = all
      .map((version, editNumber) => ({
        editNumber,
        text: version.text,
        scenarioTime: version.scenarioTime,
      }))
      .reverse()
    return respond(config, 200, { postId, versions })
  }

  let body: unknown = config.data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }
  const rawText = (body as { text?: unknown } | null)?.text
  if (typeof rawText !== 'string') return respond(config, 400, { error: 'text required' })
  const text = sanitizeText(rawText).trim()
  if (text === '' || [...text].length > MAX_TEXT_LENGTH) {
    return respond(config, 400, { error: 'invalid text' })
  }

  if (forcedForbidden) return respond(config, 403, { error: 'forbidden' })
  if (forcedConflict !== null) return respond(config, 409, { reason: forcedConflict })
  if (record.edits.length >= EDIT_LIMIT) return respond(config, 409, { reason: 'edit-limit' })
  if (secondsLeft(record) <= 0) return respond(config, 409, { reason: 'window-closed' })

  const current = currentOf(record)
  if (text !== current.text) {
    const scenarioTime = scenarioNow().toISOString()
    record.edits.push({ text, scenarioTime })
    // The `PostEdited` push (DF-33): applied through the same frame the live validator accepts.
    editedPostsStore.apply({
      postId,
      text,
      edited: { count: record.edits.length, scenarioTime },
      version: record.edits.length,
    })
  }
  const count = record.edits.length
  return respond(config, 200, {
    id: postId,
    text: currentOf(record).text,
    ...(count > 0 ? { edited: { count, scenarioTime: currentOf(record).scenarioTime } } : {}),
    viewer: { liked: false, reposted: false, editableForSeconds: secondsLeft(record) },
  })
}
