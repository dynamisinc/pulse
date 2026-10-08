/**
 * features/controller/media/useAttachmentTray.ts
 * ---------------------------------------------------------------------------
 * The controller composer's ATTACH TRAY state (demo-polish C1, story 17; SOC-001,
 * NFR-001, NFR-004). STAFF world - a pure hook, no UI, no theme. The view is
 * `AttachmentTray.tsx`; the composer hook (`useComposeAsPersona`) owns one of these
 * and turns it into the request's `media[]`.
 *
 * WHAT A TRAY ITEM IS. A tray holds up to 4 images OR 1 video, each from ONE of two
 * sources:
 *   - 'upload'  a file the controller picked. The ROW component runs the upload
 *               through `core/media`'s `useMediaUpload` (one hook instance per row, so
 *               four images upload in parallel with their own progress + cancel) and
 *               reports back through {@link UseAttachmentTrayResult.markUploaded} /
 *               `markFailed`. Videos go through `uploadVideoWithPoster` inside that
 *               client (poster first, then the video carrying `posterMediaId`).
 *   - 'library' an asset already in the exercise's staff media library, picked via
 *               `MediaLibraryPicker`. It is `ready` at once (it already exists on the
 *               server) and keeps its poster (DP-3) - the server links a video's poster
 *               from the asset, so no `posterMediaId` is sent for it.
 * Both need a REQUIRED alt text before the post can go out (NFR-001); videos have no
 * captions this push (DP-12), so the alt is their only text alternative.
 *
 * RULES (see `attachmentRules.ts`): at most 4 images OR 1 video, never mixed. A batch
 * of files is validated up front and refused WHOLE on the first failure, with the
 * message in `attachError` (a partial, surprising attach never happens).
 *
 * WHAT IT DOES NOT DO. It owns no network call (the rows do), no exercise id and no
 * persistence: attachments do not survive an unmount (the draft-survives-unmount
 * store covers the text only; a picked library asset is one click away again, and a
 * File cannot be persisted).
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { MediaAssetView, MediaKind, StaffMediaAssetView } from '@/core/media'
import type { CreatePostMedia } from '@/features/social'
import {
  MAX_IMAGES,
  checkKinds,
  effectiveAlt,
  kindLimit,
  validateAttachBatch,
} from './attachmentRules'

/** Where one tray item is in its life. */
export type TrayItemStatus = 'uploading' | 'ready' | 'failed'

/** One attachment in the tray. */
export interface TrayItem {
  /** Tray-unique, stable across renders (NOT the server's asset id). */
  readonly key: string
  readonly source: 'upload' | 'library'
  readonly kind: MediaKind
  /** What to call it in the UI: the picked file's name / the library file name. */
  readonly name: string
  readonly status: TrayItemStatus
  /** The author-entered description (required before the post can go out). */
  readonly alt: string
  /** The picked file (upload source only) - the row uploads it on mount. */
  readonly file?: File
  /** The asset: set when an upload completes, and at add time for a library item. */
  readonly asset?: MediaAssetView
  /** Staff-only library metadata (library source only). */
  readonly uploadedAtScenario?: string
  /** User-facing failure text, set only when `status === 'failed'`. */
  readonly error?: string
}

/** What the library picker should be told (the frozen `MediaLibraryPicker` props). */
export interface LibraryPickerLimits {
  /** Restrict the picker to this kind; `undefined` while the tray is empty. */
  readonly kind: MediaKind | undefined
  /** How many library items may still be selected (library ids already selected count). */
  readonly max: number
}

/** What {@link useAttachmentTray} returns. */
export interface UseAttachmentTrayResult {
  readonly items: readonly TrayItem[]
  /** The kind of the tray (every item shares it), or `undefined` when empty. */
  readonly kind: MediaKind | undefined
  /** Why the last attach was refused (cleared by the next accepted attach). */
  readonly attachError: string | undefined
  /** Library asset ids currently in the tray, in tray order (the picker's `selectedIds`). */
  readonly libraryIds: string[]
  readonly libraryLimits: LibraryPickerLimits
  /** Items still uploading / failed / without a usable alt. */
  readonly uploadingCount: number
  readonly failedCount: number
  readonly missingAltCount: number
  /** Why the tray blocks Fire, in words; `undefined` when it does not. */
  readonly blocker: string | undefined
  /**
   * The request's `media[]`: `[]` for an empty tray, the described items when every
   * one is ready, `undefined` while the tray is NOT ready to send.
   */
  readonly media: CreatePostMedia[] | undefined
  /** Adds picked files as uploading rows. Returns false (and sets `attachError`) when refused. */
  addFiles(files: readonly File[]): boolean
  /**
   * Makes the tray's library items equal `ids` (adding the new ones via `lookup`,
   * dropping the deselected ones). A selection the rules refuse leaves the tray
   * untouched and sets `attachError`.
   */
  setLibrarySelection(
    ids: readonly string[],
    lookup: (id: string) => StaffMediaAssetView | undefined,
  ): void
  setAlt(key: string, alt: string): void
  markUploaded(key: string, asset: MediaAssetView): void
  markFailed(key: string, message: string): void
  remove(key: string): void
  clearAttachError(): void
  /** Empties the tray (after a successful post). */
  clear(): void
}

/** The tray's state machine. See the module header. */
export function useAttachmentTray(): UseAttachmentTrayResult {
  const [items, setItems] = useState<readonly TrayItem[]>([])
  const [attachError, setAttachError] = useState<string | undefined>(undefined)
  const keySeq = useRef(0)

  const nextKey = useCallback((prefix: string) => {
    keySeq.current += 1
    return `${prefix}-${keySeq.current}`
  }, [])

  const addFiles = useCallback(
    (files: readonly File[]): boolean => {
      if (files.length === 0) return true
      const result = validateAttachBatch(files, items.map(item => item.kind))
      if (!result.ok) {
        setAttachError(result.error)
        return false
      }
      const added: TrayItem[] = []
      files.forEach((file, index) => {
        const kind = result.kinds[index]
        if (kind === undefined) return
        added.push({
          key: nextKey('upload'),
          source: 'upload',
          kind,
          name: file.name,
          status: 'uploading',
          alt: '',
          file,
        })
      })
      setAttachError(undefined)
      setItems(current => [...current, ...added])
      return true
    },
    [items, nextKey],
  )

  const setLibrarySelection = useCallback(
    (ids: readonly string[], lookup: (id: string) => StaffMediaAssetView | undefined): void => {
      const kept = items.filter(item => item.source === 'upload' || ids.includes(item.asset?.id ?? ''))
      const keptLibraryIds = new Set(
        kept.filter(item => item.source === 'library').map(item => item.asset?.id),
      )
      const added: TrayItem[] = []
      for (const id of ids) {
        if (keptLibraryIds.has(id)) continue
        const asset = lookup(id)
        if (asset === undefined) continue
        added.push({
          key: nextKey('library'),
          source: 'library',
          kind: asset.kind,
          name: asset.fileName,
          status: 'ready',
          alt: '',
          asset,
          uploadedAtScenario: asset.uploadedAtScenario,
        })
      }
      const next = [...kept, ...added]
      const refusal = checkKinds(next.map(item => item.kind))
      if (refusal !== undefined) {
        setAttachError(refusal)
        return
      }
      setAttachError(undefined)
      setItems(next)
    },
    [items, nextKey],
  )

  const setAlt = useCallback((key: string, alt: string) => {
    setItems(current => current.map(item => (item.key === key ? { ...item, alt } : item)))
  }, [])

  const markUploaded = useCallback((key: string, asset: MediaAssetView) => {
    setItems(current =>
      current.map(item => (item.key === key ? { ...item, status: 'ready', asset } : item)),
    )
  }, [])

  const markFailed = useCallback((key: string, message: string) => {
    setItems(current =>
      current.map(item =>
        item.key === key ? { ...item, status: 'failed', error: message } : item,
      ),
    )
  }, [])

  const remove = useCallback((key: string) => {
    setItems(current => current.filter(item => item.key !== key))
    setAttachError(undefined)
  }, [])

  const clearAttachError = useCallback(() => setAttachError(undefined), [])

  const clear = useCallback(() => {
    setItems(current => (current.length === 0 ? current : []))
    setAttachError(undefined)
  }, [])

  return useMemo<UseAttachmentTrayResult>(() => {
    const kind = items[0]?.kind
    const uploadingCount = items.filter(item => item.status === 'uploading').length
    const failedCount = items.filter(item => item.status === 'failed').length
    const missingAltCount = items.filter(item => effectiveAlt(item.alt).length === 0).length

    let blocker: string | undefined
    if (failedCount > 0) {
      blocker = 'Remove the failed upload before posting.'
    } else if (uploadingCount > 0) {
      blocker = uploadingCount === 1
        ? 'Wait for the upload to finish.'
        : `Wait for ${uploadingCount} uploads to finish.`
    } else if (missingAltCount > 0) {
      blocker = 'Add alt text to every image or video.'
    }

    let media: CreatePostMedia[] | undefined
    if (blocker === undefined) {
      media = []
      for (const item of items) {
        if (item.asset === undefined) {
          media = undefined
          break
        }
        media.push({ mediaId: item.asset.id, alt: effectiveAlt(item.alt) })
      }
    }

    const libraryIds = items
      .filter(item => item.source === 'library')
      .flatMap(item => (item.asset !== undefined ? [item.asset.id] : []))
    const uploadsOfKind = items.filter(item => item.source === 'upload').length
    const libraryLimits: LibraryPickerLimits = {
      kind,
      max: kind === undefined ? MAX_IMAGES : Math.max(0, kindLimit(kind) - uploadsOfKind),
    }

    return {
      items,
      kind,
      attachError,
      libraryIds,
      libraryLimits,
      uploadingCount,
      failedCount,
      missingAltCount,
      blocker,
      media,
      addFiles,
      setLibrarySelection,
      setAlt,
      markUploaded,
      markFailed,
      remove,
      clearAttachError,
      clear,
    }
  }, [
    items,
    attachError,
    addFiles,
    setLibrarySelection,
    setAlt,
    markUploaded,
    markFailed,
    remove,
    clearAttachError,
    clear,
  ])
}
