/**
 * core/media/mediaGuards.ts
 * ---------------------------------------------------------------------------
 * Runtime parsers for the media wire shapes (demo-polish F0, implementation.md
 * §1.5.1): `MediaAssetView` (the `POST /api/media` 201 body) and
 * `StaffMediaAssetView` (a `GET /api/staff/media` row). Shared by the upload
 * client and `useMediaLibrary` so the two can never disagree about what a valid
 * asset is.
 *
 * They FAIL CLOSED on a malformed required member (no id / kind / url, a
 * wrong-typed optional) and on a PRESENT optional number outside the frozen
 * contract's range: `width`/`height` are integers 1..{@link MEDIA_MAX_DIMENSION},
 * `durationSec` is a double (fractional seconds are valid) with
 * 0 < x <= {@link MEDIA_MAX_DURATION_SEC}. They treat `null` on an OPTIONAL member
 * (`posterUrl`, `width`, `height`, `durationSec`) as ABSENT — one backend member
 * that forgot `JsonIgnoreCondition.WhenWritingNull` must not fail-close a whole
 * upload or the whole library. The parsed result is REBUILT from the contract
 * keys, so a null (or any stray server-side key) never reaches a consumer.
 *
 * World-neutral (`core/`): pure functions, no React, no theme.
 */

import { MEDIA_MAX_DIMENSION, MEDIA_MAX_DURATION_SEC } from './mediaErrors'
import type { MediaAssetView, StaffMediaAssetView } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

/** Absent, or an integer pixel size in 1..{@link MEDIA_MAX_DIMENSION}. */
function isOptionalDimension(value: unknown): value is number | undefined | null {
  return (
    isAbsent(value) ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MEDIA_MAX_DIMENSION)
  )
}

/** Absent, or seconds with 0 < x <= {@link MEDIA_MAX_DURATION_SEC} (fractions allowed). */
function isOptionalDuration(value: unknown): value is number | undefined | null {
  return (
    isAbsent(value) ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= MEDIA_MAX_DURATION_SEC)
  )
}

/** The `MediaAssetView` in `value`, rebuilt from its contract keys, or `undefined`. */
export function parseMediaAssetView(value: unknown): MediaAssetView | undefined {
  if (!isRecord(value)) return undefined
  const { id, kind, url, posterUrl, width, height, durationSec } = value

  if (typeof id !== 'string' || id.length === 0) return undefined
  if (kind !== 'image' && kind !== 'video') return undefined
  if (typeof url !== 'string' || url.length === 0) return undefined
  if (!isAbsent(posterUrl) && typeof posterUrl !== 'string') return undefined
  if (!isOptionalDimension(width) || !isOptionalDimension(height)) return undefined
  if (!isOptionalDuration(durationSec)) return undefined

  return {
    id,
    kind,
    url,
    ...(typeof posterUrl === 'string' ? { posterUrl } : {}),
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
    ...(typeof durationSec === 'number' ? { durationSec } : {}),
  }
}

/** The `StaffMediaAssetView` in `value`, rebuilt from its contract keys, or `undefined`. */
export function parseStaffMediaAssetView(value: unknown): StaffMediaAssetView | undefined {
  const base = parseMediaAssetView(value)
  if (base === undefined || !isRecord(value)) return undefined
  const { fileName, uploadedAtScenario } = value

  if (typeof fileName !== 'string') return undefined
  if (typeof uploadedAtScenario !== 'string' || uploadedAtScenario.length === 0) return undefined

  return { ...base, fileName, uploadedAtScenario }
}
