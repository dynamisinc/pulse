/**
 * core/media/useMediaUpload.ts
 * ---------------------------------------------------------------------------
 * A tiny state machine around one in-flight upload (demo-polish F0,
 * implementation.md §1.11): what a composer binds its attach tray to.
 *
 *   const { start, state, progress, error, cancel } = useMediaUpload()
 *
 *   state    'idle' | 'uploading' | 'done' | 'error'
 *   progress a MONOTONIC fraction in [0, 1] while uploading (1 once done)
 *   error    the user-facing message (set only in the 'error' state)
 *   start    uploads `file` via `uploadPickedMedia` (image: size read + upload;
 *            video: poster first, then the video) and resolves with the asset
 *   cancel   aborts the in-flight upload; the state returns to 'idle' (an abort
 *            is a choice, not an error)
 *
 * `start()` REJECTS on failure or abort (so a caller that awaits it can react),
 * in addition to recording `state`/`error`. A caller that only reads the state
 * should attach `.catch(() => {})` — never leave the rejection unhandled.
 * Starting a second upload aborts the first. Unmounting aborts the in-flight
 * upload; a late settle after unmount never sets state.
 *
 * World-neutral (`core/`): no UI, no theme, no exercise id.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbortError } from './mediaErrors'
import { uploadPickedMedia } from './uploadMedia'
import type { MediaAssetView } from './types'

/** The phases of one upload. */
export type MediaUploadState = 'idle' | 'uploading' | 'done' | 'error'

/** What {@link useMediaUpload} returns. */
export interface UseMediaUploadResult {
  start(file: File): Promise<MediaAssetView>
  readonly state: MediaUploadState
  readonly progress: number
  readonly error?: string
  cancel(): void
}

/** Falls back to a generic message for a non-`Error` rejection. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The upload failed.'
}

/** Drives a single upload at a time; see the module header for the contract. */
export function useMediaUpload(): UseMediaUploadResult {
  const [state, setState] = useState<MediaUploadState>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)

  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState('idle')
    setProgress(0)
    setError(undefined)
  }, [])

  const start = useCallback(async (file: File): Promise<MediaAssetView> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setState('uploading')
    setProgress(0)
    setError(undefined)

    try {
      const asset = await uploadPickedMedia(file, {
        signal: controller.signal,
        onProgress: fraction => {
          if (controllerRef.current === controller && mountedRef.current) setProgress(fraction)
        },
      })
      if (controllerRef.current === controller && mountedRef.current) {
        setProgress(1)
        setState('done')
      }
      return asset
    } catch (failure) {
      // A superseded or cancelled upload must not stamp state over its successor.
      if (controllerRef.current === controller && mountedRef.current) {
        if (isAbortError(failure)) {
          setState('idle')
          setProgress(0)
        } else {
          setState('error')
          setError(messageOf(failure))
        }
      }
      throw failure
    }
  }, [])

  return error === undefined
    ? { start, state, progress, cancel }
    : { start, state, progress, error, cancel }
}
