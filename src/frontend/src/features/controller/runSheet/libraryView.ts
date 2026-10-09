/**
 * features/controller/runSheet/libraryView.ts
 * ---------------------------------------------------------------------------
 * The run sheet's id -> asset VIEW of the exercise media library (demo-polish C3 + the
 * Wave 3 integration with C1's picker). STAFF world; pure, no React.
 *
 * WHY A VIEW AND NOT JUST A MAP. The panel FETCHES the "All" library (`useMediaLibrary()`,
 * newest 100) so beat thumbnails and "not in the library" notes resolve even if the picker
 * was never opened. But C1's `MediaLibraryPicker` also lets the controller narrow to
 * Images or Videos, and those are separate cache entries of the SAME key family
 * (`['staff','media',exerciseId,kind]`): an asset picked under the Videos filter may be
 * older than the newest 100 overall and so absent from the "All" list. Reading only the
 * "All" list would flag that beat's media "not in this exercise's library" and, worse,
 * mis-type a saved video beat as images when it is reopened in the editor
 * (`draftFromBeat` decides image-vs-video from the library's kinds).
 *
 * So the view is the "All" list PLUS a fallback lookup (`useLibraryAssetLookup()` in the
 * panel: it reads every cached kind variant of THIS exercise, and never makes a request):
 *
 *   - `get` / `has` ask the fallback for any id the list does not hold, at call time, so
 *     an asset the controller JUST picked in the editor resolves on the very next render;
 *   - the ids the saved beats reference are resolved up front and added as real entries,
 *     so ITERATING the view (the editor's kind map) sees them too.
 *
 * It is still a plain `ReadonlyMap`, so the editor and the rows are unchanged. The
 * fallback is exercise-scoped by construction (the lookup's cache prefix includes the
 * exercise id), so nothing from another exercise can resolve (COR-001).
 */

import type { StaffMediaAssetView } from '@/core/media'

/** The id -> asset map the run sheet's panel, rows and editor read. */
export type LibraryView = ReadonlyMap<string, StaffMediaAssetView>

/** Resolves an asset the primary list does not hold (the picker's cached kind variants). */
export type AssetFallback = (id: string) => StaffMediaAssetView | undefined

/** A Map whose misses fall through to the fallback lookup. Entries are the primary list. */
class FallbackMap extends Map<string, StaffMediaAssetView> {
  private readonly fallback: AssetFallback

  constructor(
    entries: Iterable<readonly [string, StaffMediaAssetView]>,
    fallback: AssetFallback,
  ) {
    super(entries)
    this.fallback = fallback
  }

  override get(id: string): StaffMediaAssetView | undefined {
    return super.get(id) ?? this.fallback(id)
  }

  override has(id: string): boolean {
    return super.has(id) || this.fallback(id) !== undefined
  }
}

/**
 * Builds the view: `assets` (the "All" list) as the entries, `referencedIds` (every media
 * id the saved beats use) resolved through `fallback` and added when found, and `fallback`
 * kept for lookups made later.
 */
export function buildLibraryView(
  assets: readonly StaffMediaAssetView[],
  referencedIds: Iterable<string>,
  fallback: AssetFallback,
): LibraryView {
  const view = new FallbackMap(assets.map(asset => [asset.id, asset] as const), fallback)
  for (const id of referencedIds) {
    // `Map.prototype.has` on purpose: the OVERRIDDEN `has` would consult the fallback and
    // report true for exactly the ids that still need adding.
    if (Map.prototype.has.call(view, id)) continue
    const found = fallback(id)
    if (found !== undefined) view.set(id, found)
  }
  return view
}
