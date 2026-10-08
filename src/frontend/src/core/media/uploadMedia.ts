/**
 * core/media/uploadMedia.ts
 * ---------------------------------------------------------------------------
 * The upload client (demo-polish F0, implementation.md §1.5.1 / §1.11 / §5).
 * World-neutral (`core/`): used by the participant composer (F4) and the
 * controller's composer + run sheet (C1/C3). No React, no theme, no UI.
 *
 *   uploadMedia(file, opts)         one file -> `MediaAssetView`
 *   uploadVideoWithPoster(file, …)  poster first, then the video carrying the
 *                                   poster's id as `posterMediaId`
 *   uploadPickedMedia(file, …)      the composer entry point: picks the right
 *                                   flow for the file's kind (image: read its
 *                                   size, upload; video: poster flow)
 *
 * ONE FLIP POINT, TWO ADAPTERS (`USE_MOCK_DATA` from `@/core/config/mockData`;
 * there is deliberately no second flag):
 *
 *   LIVE   `POST /api/media` as multipart/form-data via the shared axios client
 *          (`@/core/services/api` — bearer attach + silent refresh come free),
 *          with real upload progress and `AbortSignal` cancellation. A non-2xx
 *          rejects with a `MediaUploadError` whose text is mapped from the status
 *          (413/415/429/503 -> `mediaErrors.ts`); a network failure rejects with
 *          the generic `failed` text; an abort rejects with an `AbortError`.
 *          NOTHING is swallowed.
 *
 *   MOCK   `validateMediaFile` runs first (same text the server's 413/415 map
 *          to), then >= 4 simulated progress ticks (abortable), then the file is
 *          given a `URL.createObjectURL` URL and registered in the in-memory
 *          `mockMediaRegistry` (id `mock-media-<uuid>`). The mock `createPost`
 *          later resolves a post's `mediaId` through that registry. Object URLs
 *          are never revoked on unmount — they die with the page (§5).
 *
 * SCOPE (COR-001): the client NEVER sends an `exerciseId`, a persona id or an
 * acting-human id. The server stamps the exercise from the session and binds the
 * asset to the uploader (`UploadedByHumanId`); the only ids sent are the
 * optional `posterMediaId` of an asset the same actor just uploaded.
 *
 * SANITIZATION / CONTENT SECURITY (NFR-004): the file NAME is never used by the
 * client for typing and is not trusted by the server (it sniffs magic bytes). The
 * client's checks are size/MIME only and exist for fast feedback.
 *
 * SCENARIO TIME (COR-053): the mock stamps `uploadedAtScenario` from
 * `scenarioNow()`; nothing here reads the wall clock for display.
 */

import { api } from '../services/api'
import { queryClient } from '../services/queryClient'
import { USE_MOCK_DATA } from '../config/mockData'
import { scenarioNow } from '../clock'
import { generateEventId } from '../telemetry'
import {
  MediaUploadError,
  MEDIA_ERROR_TEXT,
  createAbortError,
  isAbortError,
  mediaUploadErrorMessage,
} from './mediaErrors'
import { captureVideoPoster } from './captureVideoPoster'
import { readImageSize } from './readImageSize'
import { validateMediaFile } from './validateMediaFile'
import {
  getMockMediaAsset,
  markMockMediaAsPoster,
  registerMockMedia,
} from './mockMediaRegistry'
import { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'
import type { MediaAssetView, MediaKind } from './types'

/** Optional hints + callbacks for {@link uploadMedia}. */
export interface UploadMediaOptions {
  /** Videos only: the id of an image asset (this actor's) to use as the poster. */
  readonly posterMediaId?: string
  /** Client-measured size hints (the server validates 1..16384). */
  readonly width?: number
  readonly height?: number
  /** Videos only: seconds, 0 < x <= 3600. */
  readonly durationSec?: number
  /** Called with a MONOTONIC fraction in [0, 1]. */
  readonly onProgress?: (fraction: number) => void
  /** Aborting rejects the returned promise with an `AbortError`. */
  readonly signal?: AbortSignal
}

/** Callbacks for the composite flows. */
export interface UploadFlowHandlers {
  /** Called with a MONOTONIC fraction in [0, 1] across the whole flow. */
  readonly onProgress?: (fraction: number) => void
  readonly signal?: AbortSignal
}

/** Simulated progress ticks in the mock adapter (>= 4, see implementation.md §5). */
export const MOCK_PROGRESS_TICKS = 5

/** Delay between simulated ticks, in ms. */
export const MOCK_TICK_MS = 80

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

/** Wraps a progress callback so it only ever sees clamped, non-decreasing values. */
function monotonic(onProgress: ((fraction: number) => void) | undefined) {
  let last = -1
  return (fraction: number) => {
    if (onProgress === undefined || Number.isNaN(fraction)) return
    const next = Math.min(1, Math.max(0, fraction, last))
    if (next === last) return
    last = next
    onProgress(next)
  }
}

// ---------------------------------------------------------------------------
// Live adapter
// ---------------------------------------------------------------------------

function appendNumber(form: FormData, name: string, value: number | undefined): void {
  if (value !== undefined && Number.isFinite(value)) form.append(name, String(value))
}

/** The HTTP status carried by a failed request, if any (duck-typed: axios-agnostic). */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function isMediaAssetView(value: unknown): value is MediaAssetView {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    (v.kind === 'image' || v.kind === 'video') &&
    typeof v.url === 'string' && v.url.length > 0 &&
    (v.posterUrl === undefined || typeof v.posterUrl === 'string') &&
    (v.width === undefined || typeof v.width === 'number') &&
    (v.height === undefined || typeof v.height === 'number') &&
    (v.durationSec === undefined || typeof v.durationSec === 'number')
  )
}

async function liveUpload(
  file: File,
  kind: MediaKind,
  options: UploadMediaOptions,
): Promise<MediaAssetView> {
  const report = monotonic(options.onProgress)

  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  appendNumber(form, 'width', options.width)
  appendNumber(form, 'height', options.height)
  appendNumber(form, 'durationSec', options.durationSec)
  if (options.posterMediaId !== undefined) form.append('posterMediaId', options.posterMediaId)

  let data: unknown
  try {
    const response = await api.post<unknown>('/media', form, {
      // The shared client defaults to `application/json`; axios would then JSON-
      // serialize the FormData. Naming multipart here makes axios hand the form
      // to the browser, which writes the boundary itself.
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      onUploadProgress: event => {
        if (event.progress !== undefined) report(event.progress)
        else if (event.total) report(event.loaded / event.total)
      },
    })
    data = response.data
  } catch (error) {
    if (isAbortError(error)) throw createAbortError()
    const status = statusOf(error)
    throw new MediaUploadError(mediaUploadErrorMessage(status, kind), status)
  }

  if (!isMediaAssetView(data)) {
    throw new MediaUploadError(MEDIA_ERROR_TEXT.failed)
  }
  report(1)
  return data
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/** Resolves after the simulated ticks, reporting progress; rejects on abort. */
function simulateProgress(
  report: (fraction: number) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    let tick = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const step = () => {
      tick += 1
      report(tick / MOCK_PROGRESS_TICKS)
      if (tick >= MOCK_PROGRESS_TICKS) {
        signal?.removeEventListener('abort', onAbort)
        resolve()
        return
      }
      timer = setTimeout(step, MOCK_TICK_MS)
    }
    timer = setTimeout(step, MOCK_TICK_MS)
  })
}

async function mockUpload(
  file: File,
  kind: MediaKind,
  options: UploadMediaOptions,
): Promise<MediaAssetView> {
  await simulateProgress(monotonic(options.onProgress), options.signal)

  const posterAsset =
    options.posterMediaId !== undefined ? getMockMediaAsset(options.posterMediaId) : undefined
  if (options.posterMediaId !== undefined) markMockMediaAsPoster(options.posterMediaId)

  const view: MediaAssetView = {
    id: `mock-media-${generateEventId()}`,
    kind,
    url: URL.createObjectURL(file),
    ...(posterAsset !== undefined ? { posterUrl: posterAsset.url } : {}),
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(kind === 'video' && options.durationSec !== undefined
      ? { durationSec: options.durationSec }
      : {}),
  }

  registerMockMedia({
    ...view,
    fileName: file.name,
    uploadedAtScenario: scenarioNow().toISOString(),
  })
  return view
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Uploads one file. Validates size/MIME first (rejects with a
 * `MediaUploadError` carrying the user-facing text), then runs the live or mock
 * adapter. Resolves with the created asset; rejects on any failure or abort.
 */
export async function uploadMedia(
  file: File,
  opts: UploadMediaOptions = {},
): Promise<MediaAssetView> {
  const check = validateMediaFile(file)
  if (!check.ok) throw new MediaUploadError(check.error)
  if (opts.signal?.aborted) throw createAbortError()

  const asset = USE_MOCK_DATA
    ? await mockUpload(file, check.kind, opts)
    : await liveUpload(file, check.kind, opts)

  // A new asset must show up in the staff library the next time it is opened
  // (the shared query client's default staleTime would otherwise hide it).
  void queryClient.invalidateQueries({ queryKey: MEDIA_LIBRARY_QUERY_KEY })
  return asset
}

/** Share of a video flow's progress bar that the (small) poster upload takes. */
const POSTER_PROGRESS_SHARE = 0.1

/**
 * The video flow: capture a poster frame in the browser, upload the POSTER
 * first, then upload the VIDEO carrying `posterMediaId`. Progress runs 0..1
 * across both uploads (the poster is the first 10%).
 *
 * If the browser cannot decode the video (so no poster/duration can be
 * captured) the video is uploaded on its own — the server accepts a poster-less
 * video and the player has a poster-less fallback — rather than blocking the
 * post. A failed poster UPLOAD, or a failed video upload, still rejects.
 */
export async function uploadVideoWithPoster(
  file: File,
  handlers: UploadFlowHandlers = {},
): Promise<MediaAssetView> {
  const check = validateMediaFile(file)
  if (!check.ok) throw new MediaUploadError(check.error)
  if (check.kind !== 'video') {
    throw new MediaUploadError(MEDIA_ERROR_TEXT.unsupported)
  }

  const report = monotonic(handlers.onProgress)
  const { signal } = handlers
  report(0)

  let captured: Awaited<ReturnType<typeof captureVideoPoster>> | undefined
  try {
    captured = await captureVideoPoster(file)
  } catch {
    captured = undefined
  }
  if (signal?.aborted) throw createAbortError()

  if (captured === undefined) {
    return uploadMedia(file, { onProgress: report, ...(signal ? { signal } : {}) })
  }

  const posterFile = new File([captured.poster], `${stripExtension(file.name)}.poster.jpg`, {
    type: 'image/jpeg',
  })
  const poster = await uploadMedia(posterFile, {
    width: captured.width,
    height: captured.height,
    onProgress: fraction => report(fraction * POSTER_PROGRESS_SHARE),
    ...(signal ? { signal } : {}),
  })

  return uploadMedia(file, {
    posterMediaId: poster.id,
    width: captured.width,
    height: captured.height,
    durationSec: captured.durationSec,
    onProgress: fraction => report(POSTER_PROGRESS_SHARE + fraction * (1 - POSTER_PROGRESS_SHARE)),
    ...(signal ? { signal } : {}),
  })
}

/**
 * The composer entry point: picks the flow for the picked file's kind. An image
 * has its natural size read first (best-effort — an undecodable image is still
 * uploaded, the server is the real gate); a video goes through
 * {@link uploadVideoWithPoster}.
 */
export async function uploadPickedMedia(
  file: File,
  handlers: UploadFlowHandlers = {},
): Promise<MediaAssetView> {
  const check = validateMediaFile(file)
  if (!check.ok) throw new MediaUploadError(check.error)

  if (check.kind === 'video') return uploadVideoWithPoster(file, handlers)

  let size: { width: number; height: number } | undefined
  try {
    size = await readImageSize(file)
  } catch {
    size = undefined
  }
  if (handlers.signal?.aborted) throw createAbortError()

  return uploadMedia(file, {
    ...(size ?? {}),
    ...(handlers.onProgress ? { onProgress: handlers.onProgress } : {}),
    ...(handlers.signal ? { signal: handlers.signal } : {}),
  })
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
