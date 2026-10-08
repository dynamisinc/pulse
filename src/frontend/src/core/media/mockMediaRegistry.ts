/**
 * core/media/mockMediaRegistry.ts
 * ---------------------------------------------------------------------------
 * MOCK-MODE ONLY (`USE_MOCK_DATA`; demo-polish F0, implementation.md §5). The
 * in-memory registry the mock upload adapter writes to and everything else
 * reads from, so the no-backend dev loop behaves like the real pipeline:
 *
 *   upload (mock)  ->  registry  ->  mock `createPost` resolves
 *                                    `CreatePostMedia.mediaId` here to build the
 *                                    full `PostMedia` (id, url, size, poster)
 *                                 ->  mock `useMediaLibrary` lists it.
 *
 * It is seeded with FOUR CANNED library items (three photos + one video with a
 * poster, served from `public/mock-media/**`) so the controller's media picker
 * (C1) and the run sheet (C3) have content before anyone has uploaded anything.
 *
 * Object URLs minted by the mock upload adapter are deliberately NEVER revoked
 * when a component unmounts (the post still renders them); they die with the
 * page — documented in implementation.md §5.
 *
 * World-neutral (`core/`): plain data + three functions, no React, no theme. It
 * holds no provenance: `fileName` and `uploadedAtScenario` are the STAFF-library
 * members of the wire contract (`StaffMediaAssetView`) and never reach a
 * participant payload on their own — the participant shape is `MediaAssetView`.
 */

import type { MediaKind, StaffMediaAssetView } from './types'

/** Where the canned placeholder files live (served from Vite's `public/`). */
const BASE = '/mock-media'

/**
 * The four canned library items. Fixed instants in the Fairhaven scenario arc
 * (2033-09-04) — authored fixture data, never a wall-clock read.
 */
const CANNED_ASSETS: readonly StaffMediaAssetView[] = [
  {
    id: 'mock-media-canned-flood',
    kind: 'image',
    url: `${BASE}/photos/flood-main-street.svg`,
    width: 1600,
    height: 900,
    fileName: 'flood-main-street.svg',
    uploadedAtScenario: '2033-09-04T12:10:00.000Z',
  },
  {
    id: 'mock-media-canned-plant',
    kind: 'image',
    url: `${BASE}/photos/water-plant.svg`,
    width: 1200,
    height: 800,
    fileName: 'water-plant.svg',
    uploadedAtScenario: '2033-09-04T12:20:00.000Z',
  },
  {
    id: 'mock-media-canned-sign',
    kind: 'image',
    url: `${BASE}/photos/boil-advisory-sign.svg`,
    width: 1200,
    height: 800,
    fileName: 'boil-advisory-sign.svg',
    uploadedAtScenario: '2033-09-04T12:30:00.000Z',
  },
  {
    id: 'mock-media-canned-video',
    kind: 'video',
    url: `${BASE}/video/water-update.mp4`,
    posterUrl: `${BASE}/video/water-update.poster.svg`,
    width: 640,
    height: 360,
    durationSec: 4,
    fileName: 'water-update.mp4',
    uploadedAtScenario: '2033-09-04T12:40:00.000Z',
  },
]

interface RegistryEntry {
  readonly asset: StaffMediaAssetView
  /** True once a video uses this image as its poster (hidden from the library). */
  readonly isPoster: boolean
}

function seed(): Map<string, RegistryEntry> {
  return new Map(CANNED_ASSETS.map(asset => [asset.id, { asset, isPoster: false }]))
}

let registry: Map<string, RegistryEntry> = seed()

/** Looks an asset up by id (canned or uploaded this session). */
export function getMockMediaAsset(id: string): StaffMediaAssetView | undefined {
  return registry.get(id)?.asset
}

/** Registers an uploaded asset so posts and the library can resolve it. */
export function registerMockMedia(asset: StaffMediaAssetView): void {
  registry.set(asset.id, { asset, isPoster: false })
}

/**
 * Marks an already-registered image as some video's poster, which hides it from
 * the library listing (the real `GET /api/staff/media` excludes poster images).
 */
export function markMockMediaAsPoster(id: string): void {
  const entry = registry.get(id)
  if (entry !== undefined) registry.set(id, { asset: entry.asset, isPoster: true })
}

/**
 * The library listing: every non-poster asset, newest first by scenario upload
 * time, optionally narrowed to one kind (mirrors `GET /api/staff/media`).
 */
export function listMockMedia(kind?: MediaKind): StaffMediaAssetView[] {
  return [...registry.values()]
    .filter(entry => !entry.isPoster && (kind === undefined || entry.asset.kind === kind))
    .map(entry => entry.asset)
    .sort((a, b) => Date.parse(b.uploadedAtScenario) - Date.parse(a.uploadedAtScenario))
}

/** Test-only: restores the four canned items and drops everything uploaded. */
export function resetMockMediaRegistry(): void {
  registry = seed()
}
