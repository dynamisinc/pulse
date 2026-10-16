/**
 * features/social/edit/editedPostsStore.ts
 * ---------------------------------------------------------------------------
 * The session's edited-post overlay (demo-feedback story 20, DF-31/DF-33). A LEAF module
 * (no imports beyond React and types) holding, per post id, the latest text and "Edited"
 * summary the client learned about OUTSIDE the post it was rendered from:
 *
 *   - a `PostEdited` push from the exercise group (any author's edit),
 *   - the viewer's own successful save (the PATCH response),
 *   - an optimistic text while their own save is in flight.
 *
 * `PostBody` and `PostHeader` read through it (`useEditedPost`), so a card mounted
 * ANYWHERE (feed, thread, profile, Pinned) updates without a reload and
 * without any page wiring - the same trick as `postCountsStore`'s version gate. (A quoted
 * embed is not a `PostBody` and does NOT show edits live.)
 *
 * VERSION GATE. `PostEdited.version` is the post's edit count, monotonic per post (DF-33).
 * A frame is applied only when its version is STRICTLY greater than the one held, so a
 * stale, replayed or duplicated frame is dropped. Equal is dropped too (an own save and the
 * push of that same edit both arrive; the second is a no-op).
 *
 * BASE. `noteBase` records the `edited` summary a card was RENDERED with (from a feed or
 * thread read), so the header can show "Edited" before any push. When a fresher read
 * carries a higher count than the held override, the read's text REPLACES the override (so
 * every mounted card of the post moves up to it, none falls back to older text).
 *
 * RESET. The store is identity-scoped state living for the TAB, so `reset()` runs from
 * `core/auth/endSession.ts` (sign-out and every identity switch) and bumps a GENERATION: an
 * in-flight save that started under the previous identity passes its generation back and is
 * ignored if it no longer matches, so a late response never repopulates a new session.
 *
 * XC-002: only `text` and `edited` are kept; nothing else a frame carried survives.
 */

import { useSyncExternalStore } from 'react'
import type { PostEditedSummary } from '../types/post'

/** A validated `PostEdited` frame (see `realtimeFeed.toPostEditedEvent`). */
export interface PostEditedEvent {
  readonly postId: string
  readonly text: string
  readonly edited: PostEditedSummary
  /** Equals `edited.count`. */
  readonly version: number
}

/** What a card reads for one post: any field may be absent (then the card's own data stands). */
export interface EditedPostView {
  readonly text?: string
  readonly edited?: PostEditedSummary
}

interface Override {
  readonly text: string
  readonly edited: PostEditedSummary
  readonly version: number
}

const EMPTY: EditedPostView = Object.freeze({})

const overrides = new Map<string, Override>()
const bases = new Map<string, PostEditedSummary>()
const pending = new Map<string, string>()
const resolved = new Map<string, EditedPostView>()
const listeners = new Set<() => void>()
let generation = 0

function changed(postId?: string): void {
  // Drop the memo so a post's next snapshot is a fresh object (and only that post's: a burst
  // of edits must not re-render every other mounted card).
  if (postId === undefined) resolved.clear()
  else resolved.delete(postId)
  for (const listener of [...listeners]) listener()
}

function resolve(postId: string): EditedPostView {
  const cached = resolved.get(postId)
  if (cached !== undefined) return cached
  const override = overrides.get(postId)
  const text = pending.get(postId) ?? override?.text
  const edited = override?.edited ?? bases.get(postId)
  const view: EditedPostView =
    text === undefined && edited === undefined
      ? EMPTY
      : {
        ...(text !== undefined ? { text } : {}),
        ...(edited !== undefined ? { edited } : {}),
      }
  resolved.set(postId, view)
  return view
}

/** The resolved overlay for a post (stable between mutations). */
function get(postId: string): EditedPostView {
  return resolve(postId)
}

/**
 * Applies a `PostEdited` frame or the viewer's own save result. Returns whether it was
 * applied. Dropped when stale/duplicate (version not above the held one), when a base read
 * already shows a count at or above it, or when `expectedGeneration` is from a previous session.
 */
function apply(event: PostEditedEvent, expectedGeneration?: number): boolean {
  if (expectedGeneration !== undefined && expectedGeneration !== generation) return false
  const held = overrides.get(event.postId)
  if (held !== undefined && event.version <= held.version) return false
  const base = bases.get(event.postId)
  if (held === undefined && base !== undefined && event.version <= base.count) return false
  overrides.set(event.postId, {
    text: event.text,
    edited: { count: event.edited.count, scenarioTime: event.edited.scenarioTime },
    version: event.version,
  })
  pending.delete(event.postId)
  changed(event.postId)
  return true
}

/** Records the `edited` summary a card was rendered with (absent = never edited). */
function noteBase(
  postId: string,
  edited: PostEditedSummary | null | undefined,
  text?: string,
): void {
  const previous = bases.get(postId)
  if (edited == null) {
    if (previous === undefined) return
    bases.delete(postId)
    changed(postId)
    return
  }
  if (previous?.count === edited.count && previous.scenarioTime === edited.scenarioTime) return
  bases.set(postId, edited)
  const held = overrides.get(postId)
  if (held !== undefined && edited.count > held.version) {
    // The read is newer than the held override. Keep its text as the override (so a mounted card
    // still on older text moves up, never back); without the read's text, the override can no
    // longer be trusted and is dropped.
    if (text !== undefined) {
      overrides.set(postId, { text, edited: { ...edited }, version: edited.count })
    } else {
      overrides.delete(postId)
    }
  }
  changed(postId)
}

/** Shows `text` immediately while the viewer's own save is in flight (`null` clears it). */
function setPendingText(postId: string, text: string | null, expectedGeneration?: number): void {
  if (expectedGeneration !== undefined && expectedGeneration !== generation) return
  if (text === null) {
    if (!pending.delete(postId)) return
  } else {
    if (pending.get(postId) === text) return
    pending.set(postId, text)
  }
  changed(postId)
}

/** The current session generation (see the module header). */
function getGeneration(): number {
  return generation
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Forgets everything and starts a new generation (sign-out / identity switch). */
function reset(): void {
  generation += 1
  if (overrides.size === 0 && bases.size === 0 && pending.size === 0) return
  overrides.clear()
  bases.clear()
  pending.clear()
  changed()
}

/** Test-only: reset plus drop every listener. */
function resetForTests(): void {
  generation += 1
  overrides.clear()
  bases.clear()
  pending.clear()
  resolved.clear()
  listeners.clear()
}

/** The module-singleton edited-posts store. See the module header. */
export const editedPostsStore = {
  get,
  apply,
  noteBase,
  setPendingText,
  getGeneration,
  subscribe,
  reset,
  resetForTests,
}

/**
 * Subscribes a component to one post's edited overlay. `null` (id not known yet) reads as
 * "no overlay". Re-renders only when that post's overlay changes identity.
 */
export function useEditedPost(postId: string | null): EditedPostView {
  return useSyncExternalStore(
    editedPostsStore.subscribe,
    () => (postId === null ? EMPTY : editedPostsStore.get(postId)),
    () => EMPTY,
  )
}
