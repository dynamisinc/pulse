/**
 * core/services/writeRefusal.ts
 * ---------------------------------------------------------------------------
 * A tiny registry for "the server refused a WRITE with 403" (ended read-only review F-4).
 *
 * Why: a participant tab that lost the EndEx push stays in write mode. Its next write is refused
 * (403) by the lifecycle gate, but nothing re-learns that the exercise has ended, so every later
 * write fails the same way with a generic message. The shared axios client's response interceptor
 * (`api.ts`) reports each refused write here; the participant overlay store
 * (`participant-shell/.../overlayState.ts`) listens and re-GETs `/api/overlay-state`, which
 * carries `ended`, so the ended banner shows and the write controls go away.
 *
 * Kept OUT of `api.ts` on purpose: many tests replace `@/core/services/api` with a bare mock, and
 * a listener registered against that module at import time would crash them. This module has no
 * dependencies beyond axios's type guard.
 *
 * World: shared (no UI). A listener decides for itself whether the refusal concerns it.
 */

import axios from 'axios'

/** Called with the refused request's error. Must not throw (a throw is swallowed). */
export type WriteRefusalListener = (error: unknown) => void

/** The slice of Vite's `import.meta.hot` this registry uses (absent in production builds). */
interface HotModule {
  dispose(callback: () => void): void
}

const listeners = new Set<WriteRefusalListener>()

/** Methods that only READ. A 403 on one of these is not a refused write. */
const READ_METHODS = new Set(['get', 'head', 'options'])

/** True when `error` is an axios 403 for a request that writes (POST / PUT / PATCH / DELETE). */
export function isRefusedWrite(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return false
  const method = (error.config?.method ?? 'get').toLowerCase()
  return !READ_METHODS.has(method)
}

/** Registers `listener`; returns the remover. `hot` drops it on a module hot-swap. */
export function onWriteRefused(listener: WriteRefusalListener, hot?: HotModule): () => void {
  listeners.add(listener)
  const remove = () => {
    listeners.delete(listener)
  }
  hot?.dispose(remove)
  return remove
}

/** Reports `error` to every listener when it is a refused write; otherwise does nothing. */
export function reportIfWriteRefused(error: unknown): void {
  if (!isRefusedWrite(error)) return
  for (const listener of [...listeners]) {
    try {
      listener(error)
    } catch {
      // A failing listener must not change how the original request fails.
    }
  }
}
