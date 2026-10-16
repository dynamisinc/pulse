/**
 * features/social/edit/editPostService.ts
 * ---------------------------------------------------------------------------
 * The edit-own-post HTTP seam (demo-feedback story 20; DF-29/DF-31), the participant client for
 * story 19's two routes:
 *
 *   - `editPost(postId, text)`        `PATCH /api/posts/{id}` `{ text }`  -> `EditPostResult`
 *   - `getPostEditHistory(postId)`    `GET /api/posts/{id}/edits`         -> `PostEditHistory`
 *
 * Both go through the shared axios client (`VITE_API_URL`; the exercise comes from the session,
 * never from a client-supplied id, COR-001) and, under `USE_MOCK_DATA`, through `mockEdits`'
 * adapter - the same flip point every other participant service uses.
 *
 * ERRORS. A failure rejects with an `EditPostError` whose `reason` is a closed vocabulary the UI
 * maps to plain messages: the 409 reasons `window-closed` / `edit-limit` / `frozen` (the
 * contract), `forbidden` (403: not yours / not editable), `not-found` (404), `invalid` (400) and
 * `failed` (anything else, network included). The server is authoritative on all of them.
 *
 * RESULT. The 200 body is a post-shaped DTO; only what the client needs is read, strictly: the
 * current `text`, the `edited` summary (null/absent only for an identical-text no-op on a
 * never-edited post) and `viewer.editableForSeconds` (a duration; the client re-counts it down).
 *
 * World: participant services; no UI, no COBRA. Never logs the text.
 */

import { isAxiosError, type AxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { PostEditedSummary, PostEditHistory, PostEditVersion } from '../types/post'
import { mockEditAdapter } from './mockEdits'

export type EditPostFailureReason =
  | 'window-closed'
  | 'edit-limit'
  | 'frozen'
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'failed'

/** A failed edit; `reason` is what the dialog turns into a message. */
export class EditPostError extends Error {
  readonly reason: EditPostFailureReason

  constructor(reason: EditPostFailureReason) {
    super(`editPost: ${reason}`)
    this.name = 'EditPostError'
    this.reason = reason
  }
}

/** What a successful save resolves with. */
export interface EditPostResult {
  readonly postId: string
  readonly text: string
  /** Absent only when nothing was ever written (identical text on a never-edited post). */
  readonly edited?: PostEditedSummary
  /** Seconds left in the window after this save; 0 at the edit limit. */
  readonly editableForSeconds: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toSummary(value: unknown): PostEditedSummary | null {
  if (!isRecord(value)) return null
  const { count, scenarioTime } = value
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null
  if (typeof scenarioTime !== 'string' || Number.isNaN(Date.parse(scenarioTime))) return null
  return { count, scenarioTime }
}

function toResult(data: unknown, postId: string): EditPostResult | null {
  if (!isRecord(data) || typeof data.text !== 'string') return null
  const edited = data.edited == null ? undefined : toSummary(data.edited)
  if (edited === null) return null
  const viewer = data.viewer
  const seconds = isRecord(viewer) ? viewer.editableForSeconds : undefined
  return {
    postId,
    text: data.text,
    ...(edited !== undefined ? { edited } : {}),
    editableForSeconds: typeof seconds === 'number' && seconds > 0 ? Math.floor(seconds) : 0,
  }
}

function toVersion(value: unknown): PostEditVersion | null {
  if (!isRecord(value)) return null
  const { editNumber, text, scenarioTime } = value
  if (typeof editNumber !== 'number' || !Number.isInteger(editNumber) || editNumber < 0) return null
  if (typeof text !== 'string') return null
  if (typeof scenarioTime !== 'string' || scenarioTime.length === 0) return null
  return { editNumber, text, scenarioTime }
}

function toHistory(data: unknown, postId: string): PostEditHistory | null {
  if (!isRecord(data) || data.postId !== postId || !Array.isArray(data.versions)) return null
  const versions: PostEditVersion[] = []
  for (const raw of data.versions) {
    const version = toVersion(raw)
    if (version === null) return null
    versions.push(version)
  }
  return { postId, versions }
}

function toFailure(error: unknown): EditPostError {
  if (!isAxiosError(error) || error.response === undefined) return new EditPostError('failed')
  const { status, data } = error.response
  if (status === 409) {
    const reason = isRecord(data) ? data.reason : undefined
    if (reason === 'window-closed' || reason === 'edit-limit' || reason === 'frozen') {
      return new EditPostError(reason)
    }
    return new EditPostError('failed')
  }
  if (status === 403) return new EditPostError('forbidden')
  if (status === 404) return new EditPostError('not-found')
  if (status === 400) return new EditPostError('invalid')
  return new EditPostError('failed')
}

function postUrl(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`
}

const mockConfig: AxiosRequestConfig | undefined =
  USE_MOCK_DATA ? { adapter: mockEditAdapter } : undefined

/** Saves a new text for the viewer's own post (sent RAW; the server sanitizes, NFR-004). */
export async function editPost(postId: string, text: string): Promise<EditPostResult> {
  try {
    const response = await api.patch<unknown>(postUrl(postId), { text }, mockConfig)
    const result = toResult(response.data, postId)
    if (result === null) throw new EditPostError('failed')
    return result
  } catch (error) {
    throw error instanceof EditPostError ? error : toFailure(error)
  }
}

/** Reads a post's edit history, newest first (any session in the exercise). */
export async function getPostEditHistory(postId: string): Promise<PostEditHistory> {
  try {
    const response = await api.get<unknown>(`${postUrl(postId)}/edits`, mockConfig)
    const history = toHistory(response.data, postId)
    if (history === null) throw new EditPostError('failed')
    return history
  } catch (error) {
    throw error instanceof EditPostError ? error : toFailure(error)
  }
}

/** The plain message for a failed save (the dialog and tests share it). */
export function editFailureMessage(reason: EditPostFailureReason): string {
  switch (reason) {
    case 'window-closed':
      return 'The 15-minute edit window has closed'
    case 'edit-limit':
      return "You've reached the edit limit"
    case 'frozen':
      return 'Posting is paused right now'
    case 'forbidden':
      return "You can't edit this post"
    case 'not-found':
      return 'This post is no longer available'
    case 'invalid':
      return "That text can't be saved. Check it and try again"
    default:
      return "Couldn't save your edit. Try again"
  }
}
